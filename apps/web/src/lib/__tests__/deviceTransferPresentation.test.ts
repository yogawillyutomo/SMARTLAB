import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import {
  deviceTransferPresentationIssue,
  matchesTransferReconciliation,
  normalizeTransferReason,
  reconcileDeviceTransfer,
  validateTransferForm,
} from '@/lib/deviceTransferPresentation';
import type { DeviceDto } from '@/services/deviceApi';
import type { DeviceTransferDto } from '@/services/deviceTransferApi';

const transfer: DeviceTransferDto = {
  id: '01m0r8nsw938c2zcv44zyge824',
  deviceId: '01m0r8nsw938c2zcv44zyge820',
  deviceCode: 'DEV-0001',
  sourceLaboratory: { id: '01m0r8nsw938c2zcv44zyge821', code: 'LAB-A', name: 'Source Lab' },
  destinationLaboratory: { id: '01m0r8nsw938c2zcv44zyge822', code: 'LAB-B', name: 'Destination Lab' },
  reason: 'Move',
  actor: { id: '01m0r8nsw938c2zcv44zyge823', name: 'Operator' },
  deviceVersionBefore: 3,
  deviceVersionAfter: 4,
  createdAt: '2026-08-24T01:00:00.000Z',
};

const device: DeviceDto = {
  id: transfer.deviceId,
  schoolId: '01m0r8nsw938c2zcv44zyge825',
  deviceCode: transfer.deviceCode,
  qrPublicId: 'devq_abcdefghijklmnopqrstuv',
  deviceType: 'desktop_pc',
  lifecycleStatus: 'in_service',
  homeLaboratoryId: transfer.sourceLaboratory.id,
  serialNumber: null,
  hostname: null,
  brand: null,
  model: null,
  technicalProfileVersion: 1,
  technicalProfile: {},
  version: 3,
  createdAt: transfer.createdAt,
  updatedAt: transfer.createdAt,
};

const snapshot = {
  deviceId: device.id,
  submittedVersion: 3,
  sourceLaboratoryId: transfer.sourceLaboratory.id,
  destinationLaboratoryId: transfer.destinationLaboratory.id,
  reason: 'Move',
};

function historyPage(data: DeviceTransferDto[] = [transfer]) {
  return { data, meta: { page: 1, perPage: 10, total: data.length, lastPage: 1 } };
}

describe('Device Transfer presentation and reconciliation', () => {
  it('normalizes and validates the constrained form', () => {
    expect(normalizeTransferReason('   ')).toBeNull();
    expect(validateTransferForm('', 'x')).toMatchObject({ destinationLaboratoryId: expect.any(String) });
    expect(validateTransferForm('01m0r8nsw938c2zcv44zyge822', 'x'.repeat(501))).toMatchObject({ reason: expect.any(String) });
  });

  it('matches only the submitted device/version/source/destination evidence', () => {
    expect(matchesTransferReconciliation(transfer, {
      deviceId: transfer.deviceId,
      submittedVersion: 3,
      sourceLaboratoryId: transfer.sourceLaboratory.id,
      destinationLaboratoryId: transfer.destinationLaboratory.id,
      reason: 'Move',
    })).toBe(true);
    expect(matchesTransferReconciliation(transfer, {
      deviceId: transfer.deviceId,
      submittedVersion: 2,
      sourceLaboratoryId: transfer.sourceLaboratory.id,
      destinationLaboratoryId: transfer.destinationLaboratory.id,
      reason: 'Move',
    })).toBe(false);
  });

  it('maps 412 without permitting automatic resubmission and marks network mutation ambiguous', () => {
    expect(deviceTransferPresentationIssue(new ApiClientError('stale', { kind: 'api', status: 412, code: 'DEVICE_VERSION_CONFLICT' }))).toMatchObject({ versionConflict: true, retryable: false });
    expect(deviceTransferPresentationIssue(new ApiClientError('offline', { kind: 'network' }))).toMatchObject({ ambiguous: true, retryable: false });
    expect(deviceTransferPresentationIssue(new ApiClientError('offline', { kind: 'network' }), 'history')).toMatchObject({ ambiguous: false, retryable: true });
  });

  it('maps the locked domain errors to controlled Indonesian presentation', () => {
    expect(deviceTransferPresentationIssue(new ApiClientError('same', { kind: 'api', status: 409, code: 'TRANSFER_SAME_LABORATORY' })).message).toContain('berbeda');
    expect(deviceTransferPresentationIssue(new ApiClientError('forbidden', { kind: 'api', status: 403, code: 'FORBIDDEN' })).retryable).toBe(false);
  });

  it('separates confirmed, unchanged, concurrent, unavailable, and stale reconciliation outcomes', async () => {
    const deviceGateway = { show: async () => ({ ...device, homeLaboratoryId: transfer.destinationLaboratory.id, version: 4 }) };
    const transferGateway = { history: async () => historyPage() };
    await expect(reconcileDeviceTransfer({ deviceId: device.id, snapshot, canViewHistory: true, deviceGateway, transferGateway, isCurrent: () => true })).resolves.toMatchObject({ status: 'confirmed' });

    const unchanged = await reconcileDeviceTransfer({ deviceId: device.id, snapshot, canViewHistory: true, deviceGateway: { show: async () => device }, transferGateway: { history: async () => historyPage([]) }, isCurrent: () => true });
    expect(unchanged.status).toBe('unconfirmed');

    const concurrent = await reconcileDeviceTransfer({ deviceId: device.id, snapshot, canViewHistory: true, deviceGateway: { show: async () => ({ ...device, version: 5, homeLaboratoryId: '01m0r8nsw938c2zcv44zyge826' }) }, transferGateway: { history: async () => historyPage([]) }, isCurrent: () => true });
    expect(concurrent.status).toBe('concurrent_change');

    const unavailable = await reconcileDeviceTransfer({ deviceId: device.id, snapshot, canViewHistory: false, deviceGateway: { show: async () => { throw new Error('offline'); } }, transferGateway, isCurrent: () => true });
    expect(unavailable.status).toBe('unavailable');

    let current = true;
    const stale = await reconcileDeviceTransfer({ deviceId: device.id, snapshot, canViewHistory: false, deviceGateway: { show: async () => { current = false; return device; } }, transferGateway, isCurrent: () => current });
    expect(stale.status).toBe('stale_route');
  });

  it('keeps Device evidence when history GET fails and treats valid 2xx parse failures as ambiguous mutation outcomes', async () => {
    const result = await reconcileDeviceTransfer({
      deviceId: device.id,
      snapshot,
      canViewHistory: true,
      deviceGateway: { show: async () => ({ ...device, homeLaboratoryId: transfer.destinationLaboratory.id, version: 4 }) },
      transferGateway: { history: async () => { throw new ApiClientError('history down', { kind: 'network' }); } },
      isCurrent: () => true,
    });
    expect(result.status).toBe('confirmed');
    if (result.status !== 'confirmed') throw new Error('Expected confirmed reconciliation.');
    expect(result.history?.status).toBe('unavailable');
    expect(deviceTransferPresentationIssue(new ApiClientError('bad 201', { kind: 'invalid_response', status: 201 }))).toMatchObject({ ambiguous: true, retryable: false });
    expect(deviceTransferPresentationIssue(new ApiClientError('bad history', { kind: 'invalid_response', status: 200 }), 'history')).toMatchObject({ ambiguous: false, retryable: false });
  });
});
