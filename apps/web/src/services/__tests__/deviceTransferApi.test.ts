import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  createDeviceTransferGateway,
  DeviceTransferContractError,
  parseDeviceTransferCollectionResponse,
  parseDeviceTransferResponse,
} from '@/services/deviceTransferApi';

const deviceId = '01m0r8nsw938c2zcv44zyge820';
const sourceId = '01m0r8nsw938c2zcv44zyge821';
const destinationId = '01m0r8nsw938c2zcv44zyge822';
const actorId = '01m0r8nsw938c2zcv44zyge823';

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    id: '01m0r8nsw938c2zcv44zyge824',
    deviceId,
    deviceCode: 'DEV-0001',
    sourceLaboratory: { id: sourceId, code: 'LAB-A', name: 'Source Lab' },
    destinationLaboratory: { id: destinationId, code: 'LAB-B', name: 'Destination Lab' },
    reason: null,
    actor: { id: actorId, name: 'Operator' },
    deviceVersionBefore: 3,
    deviceVersionAfter: 4,
    createdAt: '2026-08-24T01:00:00.000Z',
    ...overrides,
  };
}

function client(): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: [transfer()], meta: { page: 1, perPage: 10, total: 1, lastPage: 1 } })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: transfer() })) as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
  };
}

describe('Device Transfer contract parser', () => {
  it('accepts lowercase Laravel ULIDs and preserves snapshots', () => {
    expect(parseDeviceTransferResponse({ data: transfer() }).destinationLaboratory.code).toBe('LAB-B');
  });

  it.each([
    { ...transfer(), unexpected: true },
    { ...transfer(), deviceVersionAfter: 5 },
    { ...transfer(), reason: '' },
    { ...transfer(), createdAt: 'not-a-date' },
    { ...transfer(), createdAt: '2026-08-24' },
    { ...transfer(), actor: { id: actorId, name: 'Operator', role: 'admin' } },
  ])('rejects malformed or expanded DTOs', (value) => {
    expect(() => parseDeviceTransferResponse({ data: value })).toThrow(DeviceTransferContractError);
  });

  it('rejects invalid collection metadata and unknown envelope keys', () => {
    expect(() => parseDeviceTransferCollectionResponse({ data: [], meta: { page: 1, perPage: 10, total: 0, lastPage: 1, cursor: null } })).toThrow(DeviceTransferContractError);
    expect(() => parseDeviceTransferCollectionResponse({ data: [], meta: { page: 2, perPage: 10, total: 0, lastPage: 1 } })).toThrow(DeviceTransferContractError);
  });
});

describe('Device Transfer gateway boundary', () => {
  it('sends only the allowlisted body and strong If-Match, and paginates history with GET', async () => {
    const api = client();
    const gateway = createDeviceTransferGateway(api);
    await gateway.create(deviceId, 3, { destinationLaboratoryId: destinationId, reason: '  Move  ' });
    await gateway.history(deviceId, { page: 2, perPage: 10 });

    expect(api.post).toHaveBeenCalledWith(
      `/devices/${deviceId}/transfers`,
      { destinationLaboratoryId: destinationId, reason: 'Move' },
      { ifMatch: '"3"' },
    );
    expect(api.get).toHaveBeenCalledWith(`/devices/${deviceId}/transfers?page=2&perPage=10`);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('maps blank reason to null and never includes protected fields', async () => {
    const api = client();
    await createDeviceTransferGateway(api).create(deviceId, 3, { destinationLaboratoryId: destinationId, reason: '   ' });
    expect(api.post).toHaveBeenCalledWith(`/devices/${deviceId}/transfers`, { destinationLaboratoryId: destinationId, reason: null }, { ifMatch: '"3"' });
  });
});
