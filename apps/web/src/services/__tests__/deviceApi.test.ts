import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  DEVICE_TYPES,
  DeviceContractError,
  buildCreateDevicePayload,
  buildDeviceListPath,
  buildUpdateDevicePayload,
  createDeviceGateway,
  deviceIfMatch,
  devicePath,
  parseDeviceCollectionResponse,
  parseDeviceResponse,
  type CreateDeviceInput,
  type DeviceDto,
} from '@/services/deviceApi';

function device(overrides: Record<string, unknown> = {}): DeviceDto {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    deviceCode: 'DEV-0001',
    qrPublicId: 'devq_abcdefghijklmnopqrstuv',
    deviceType: 'desktop_pc',
    lifecycleStatus: 'in_service',
    homeLaboratoryId: null,
    serialNumber: null,
    hostname: null,
    brand: null,
    model: null,
    technicalProfileVersion: 1,
    technicalProfile: {},
    version: 1,
    createdAt: '2026-08-23T01:00:00.000Z',
    updatedAt: '2026-08-23T01:00:00.000Z',
    ...overrides,
  } as DeviceDto;
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  const current = device();
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async (path: string) => path.startsWith('/devices?')
      ? { data: [current], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } }
      : { data: current }) as ApiClient['get'],
    post: vi.fn(async () => ({ data: current })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: current })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: current })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Device response parser', () => {
  it('preserves exact canonical nullable fields and empty technical profiles', () => {
    expect(parseDeviceResponse({ data: device() })).toEqual(device());
  });

  it('accepts and preserves lowercase Laravel Device and ownership ULIDs', () => {
    const canonical = device({
      id: '01m0r8nsw938c2zcv44zyge820',
      schoolId: '01m0r8nsw938c2zcv44zyge821',
      homeLaboratoryId: '01m0r8nsw938c2zcv44zyge822',
    });

    expect(parseDeviceResponse({ data: canonical })).toEqual(canonical);
  });

  it.each(DEVICE_TYPES)('accepts the canonical %s discriminator with its empty profile', (deviceType) => {
    expect(parseDeviceResponse({ data: device({ deviceType, technicalProfile: {} }) }).deviceType).toBe(deviceType);
  });

  it('parses strict pagination metadata without discarding it', () => {
    const page = parseDeviceCollectionResponse({
      data: [device()],
      meta: { page: 2, perPage: 25, total: 26, lastPage: 2 },
    });
    expect(page.meta).toEqual({ page: 2, perPage: 25, total: 26, lastPage: 2 });
    expect(page.data).toHaveLength(1);
  });

  it.each([
    ['lifecycleStatus', 'Online'],
    ['version', 0],
    ['version', 1.5],
    ['technicalProfileVersion', Number.MAX_SAFE_INTEGER + 1],
    ['createdAt', 'not-a-date'],
    ['updatedAt', '2026-08-23'],
    ['id', 'not-a-ulid'],
    ['serialNumber', 42],
    ['model', 'x'.repeat(256)],
  ])('rejects malformed canonical field %s', (field, value) => {
    expect(() => parseDeviceResponse({ data: device({ [field]: value }) })).toThrow(DeviceContractError);
  });

  it('rejects profile/type mismatches, frontend kind, nested other values, and unknown DTO fields', () => {
    expect(() => parseDeviceResponse({ data: device({ technicalProfile: { wanPortCount: 1 } }) })).toThrow(DeviceContractError);
    expect(() => parseDeviceResponse({ data: device({ technicalProfile: { kind: 'desktop_pc' } }) })).toThrow(DeviceContractError);
    expect(() => parseDeviceResponse({ data: device({ deviceType: 'other', technicalProfile: { nested: { unsafe: true } } }) })).toThrow(DeviceContractError);
    expect(() => parseDeviceResponse({ data: { ...device(), assetId: 'legacy' } })).toThrow(DeviceContractError);
  });

  it.each([
    undefined,
    {},
    { data: null },
    { data: device(), unexpected: true },
  ])('fails closed for malformed single envelopes', (value) => {
    expect(() => parseDeviceResponse(value)).toThrow(DeviceContractError);
  });

  it.each([
    undefined,
    { data: [] },
    { data: [], meta: { page: 1, perPage: 0, total: 0, lastPage: 1 } },
    { data: [], meta: { page: 1, perPage: 25, total: -1, lastPage: 1 } },
    { data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1, cursor: null } },
  ])('fails closed for malformed collection envelopes', (value) => {
    expect(() => parseDeviceCollectionResponse(value)).toThrow(DeviceContractError);
  });
});

describe('Device mutation and URL boundary', () => {
  const createInput: CreateDeviceInput = {
    deviceCode: 'DEV-0001',
    deviceType: 'desktop_pc',
    homeLaboratoryId: null,
    lifecycleStatus: 'in_service',
    serialNumber: null,
    hostname: 'PC-01',
    brand: 'Example',
    model: 'M1',
    technicalProfile: { processor: 'CPU', ramGB: 16 },
  };

  it('allowlists create and update payloads and excludes every protected or legacy field', () => {
    const unsafe = {
      ...createInput,
      id: 'client-id',
      schoolId: 'client-school',
      qrPublicId: 'client-qr',
      technicalProfileVersion: 99,
      version: 99,
      createdAt: 'now',
      assetId: 'legacy',
      laboratoryId: 'legacy',
      ipAddress: '127.0.0.1',
      status: 'Online',
    };
    expect(buildCreateDevicePayload(unsafe)).toEqual(createInput);
    expect(buildUpdateDevicePayload(unsafe)).toEqual({
      serialNumber: null,
      hostname: 'PC-01',
      brand: 'Example',
      model: 'M1',
      homeLaboratoryId: null,
      technicalProfile: { processor: 'CPU', ramGB: 16 },
      lifecycleStatus: 'in_service',
    });
    expect(() => buildUpdateDevicePayload({})).toThrow(DeviceContractError);
  });

  it('builds only explicit, safely encoded list filters', () => {
    expect(buildDeviceListPath({
      page: 2,
      perPage: 50,
      homeLaboratoryId: 'lab/id with space',
      deviceType: 'router',
      lifecycleStatus: 'spare',
      search: ' ACME 100% ',
    })).toBe('/devices?page=2&perPage=50&homeLaboratoryId=lab%2Fid+with+space&deviceType=router&lifecycleStatus=spare&search=ACME+100%25');
    expect(buildDeviceListPath()).toBe('/devices');
    expect(() => buildDeviceListPath({ perPage: 101 })).toThrow(DeviceContractError);
  });

  it('encodes detail IDs and constructs a strong If-Match from a safe positive version', () => {
    expect(devicePath('device/id with space')).toBe('/devices/device%2Fid%20with%20space');
    expect(deviceIfMatch(3)).toBe('"3"');
    expect(() => deviceIfMatch(0)).toThrow(DeviceContractError);
    expect(() => devicePath('   ')).toThrow(DeviceContractError);
  });

  it('uses exact endpoints, passes version only through If-Match, and exposes no delete', async () => {
    const current = device();
    const get = vi.fn(async (path: string) => path.startsWith('/devices?')
      ? { data: [current], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } }
      : { data: current });
    const post = vi.fn(async () => ({ data: current }));
    const patch = vi.fn(async (_path: string, _body?: unknown, _options?: { ifMatch?: string }) => {
      void _path;
      void _body;
      void _options;
      return { data: current };
    });
    const gateway = createDeviceGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.list({ search: 'router', page: 1, perPage: 25 });
    await gateway.show('device/id');
    await gateway.create(createInput);
    await gateway.update('device/id', 3, { hostname: 'RTR-01' });

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/devices?page=1&perPage=25&search=router',
      '/devices/device%2Fid',
    ]);
    expect(post).toHaveBeenCalledWith('/devices', createInput);
    expect(patch).toHaveBeenCalledWith('/devices/device%2Fid', { hostname: 'RTR-01' }, { ifMatch: '"3"' });
    expect(patch.mock.calls[0][1]).not.toHaveProperty('version');
    expect('remove' in gateway).toBe(false);
  });
});
