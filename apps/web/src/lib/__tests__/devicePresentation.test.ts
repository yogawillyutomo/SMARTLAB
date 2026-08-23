import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import {
  canonicalDeviceValuesEqual,
  changedDeviceFields,
  createDeviceInputFromForm,
  deviceFormFromDto,
  devicePresentationIssue,
  emptyDeviceForm,
  validateDeviceForm,
} from '@/lib/devicePresentation';
import type { DeviceDto } from '@/services/deviceApi';

const device: DeviceDto = {
  id: '01DEVICE',
  schoolId: '01SCHOOL',
  deviceCode: 'DEV-0001',
  qrPublicId: 'devq_abcdefghijklmnopqrstuv',
  deviceType: 'desktop_pc',
  lifecycleStatus: 'in_service',
  homeLaboratoryId: null,
  serialNumber: null,
  hostname: 'PC-01',
  brand: 'Example',
  model: 'M1',
  technicalProfileVersion: 1,
  technicalProfile: { processor: 'CPU', ramGB: 16 },
  version: 3,
  createdAt: '2026-08-23T01:00:00.000Z',
  updatedAt: '2026-08-23T01:00:00.000Z',
};

describe('Device form and no-op behavior', () => {
  it('normalizes the create allowlist without inventing ownership or legacy values', () => {
    const values = {
      ...emptyDeviceForm(),
      deviceCode: ' dev-100 ',
      deviceType: 'router' as const,
      hostname: ' RTR-01 ',
      technicalProfile: { wanPortCount: 1, wifiCapable: true },
    };
    const result = validateDeviceForm(values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(createDeviceInputFromForm(result.value)).toEqual({
      deviceCode: 'DEV-100',
      deviceType: 'router',
      homeLaboratoryId: null,
      lifecycleStatus: 'in_service',
      serialNumber: null,
      hostname: 'RTR-01',
      brand: null,
      model: null,
      technicalProfile: { wanPortCount: 1, wifiCapable: true },
    });
  });

  it('rejects malformed code, wrong typed profiles, and unsafe other JSON', () => {
    expect(validateDeviceForm({ ...emptyDeviceForm(), deviceCode: 'bad code' })).toMatchObject({ ok: false });
    expect(validateDeviceForm({
      ...emptyDeviceForm(),
      deviceCode: 'DEV-001',
      technicalProfile: { wanPortCount: 1 },
    })).toMatchObject({ ok: false, errors: { technicalProfile: expect.any(String) } });
    expect(validateDeviceForm({
      ...emptyDeviceForm(),
      deviceCode: 'DEV-001',
      deviceType: 'other',
      otherProfileJson: '{"nested":{"unsafe":true}}',
    })).toMatchObject({ ok: false, errors: { technicalProfile: expect.any(String) } });
  });

  it('treats technical-profile key ordering as an effective no-op', () => {
    expect(canonicalDeviceValuesEqual(
      { processor: 'CPU', ramGB: 16 },
      { ramGB: 16, processor: 'CPU' },
    )).toBe(true);
    const form = deviceFormFromDto(device);
    form.technicalProfile = { ramGB: 16, processor: 'CPU' };
    const validated = validateDeviceForm(form);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(changedDeviceFields(device, validated.value)).toEqual({});
  });

  it('allows initial home assignment but never builds established-home reassignment', () => {
    const initial = deviceFormFromDto(device);
    initial.homeLaboratoryId = '01LAB';
    const validatedInitial = validateDeviceForm(initial);
    expect(validatedInitial.ok).toBe(true);
    if (validatedInitial.ok) expect(changedDeviceFields(device, validatedInitial.value)).toEqual({ homeLaboratoryId: '01LAB' });

    const established = { ...device, homeLaboratoryId: '01LAB' };
    const moved = deviceFormFromDto(established);
    moved.homeLaboratoryId = '01OTHER';
    const validatedMoved = validateDeviceForm(moved);
    expect(validatedMoved.ok).toBe(true);
    if (validatedMoved.ok) expect(changedDeviceFields(established, validatedMoved.value)).toEqual({});
  });

  it('does not build generic lifecycle reactivation for terminal Devices', () => {
    const retired = { ...device, lifecycleStatus: 'retired' as const };
    const form = deviceFormFromDto(retired);
    form.lifecycleStatus = 'in_service';
    const validated = validateDeviceForm(form);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(changedDeviceFields(retired, validated.value)).toEqual({});
  });
});

describe('Device API issue presentation', () => {
  it('marks 412 as a reload-required conflict and never as an automatic retry', () => {
    const issue = devicePresentationIssue(new ApiClientError('stale', {
      kind: 'api', status: 412, code: 'DEVICE_VERSION_CONFLICT',
    }));
    expect(issue).toMatchObject({
      versionConflict: true,
      retryable: false,
      message: 'Data perangkat telah berubah di server. Data terbaru sudah dimuat; periksa kembali perubahan Anda sebelum menyimpan.',
    });
  });

  it('treats 428 as an implementation failure and maps nested 422 profile errors safely', () => {
    expect(devicePresentationIssue(new ApiClientError('missing', {
      kind: 'api', status: 428, code: 'PRECONDITION_REQUIRED',
    }))).toMatchObject({ preconditionFailure: true, retryable: false });

    const validation = devicePresentationIssue(new ApiClientError('invalid', {
      kind: 'api',
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: {
        'technicalProfile.ramGB': ['RAM harus positif.'],
        schoolId: ['Tidak boleh dikirim.'],
      },
    }));
    expect(validation.fieldErrors).toEqual({ technicalProfile: 'RAM harus positif.' });
  });

  it('distinguishes not-found, permissions, auth, transfer, network, and malformed responses', () => {
    expect(devicePresentationIssue(new ApiClientError('missing', { kind: 'api', status: 404, code: 'DEVICE_NOT_FOUND' })).notFound).toBe(true);
    expect(devicePresentationIssue(new ApiClientError('forbidden', { kind: 'api', status: 403, code: 'FORBIDDEN' })).retryable).toBe(false);
    expect(devicePresentationIssue(new ApiClientError('guest', { kind: 'api', status: 401, code: 'UNAUTHENTICATED' })).authBoundary).toBe(true);
    expect(devicePresentationIssue(new ApiClientError('transfer', { kind: 'api', status: 409, code: 'DEVICE_HOME_LABORATORY_TRANSFER_REQUIRED' })).message).toContain('Transfer');
    expect(devicePresentationIssue(new ApiClientError('offline', { kind: 'network' })).retryable).toBe(true);
    expect(devicePresentationIssue(new ApiClientError('bad', { kind: 'invalid_response' })).message).toContain('tidak valid');
  });
});
