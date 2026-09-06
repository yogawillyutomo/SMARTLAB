import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  AssetContractError,
  assetIfMatch,
  assetPath,
  buildAssetListPath,
  createAssetGateway,
  parseAssetCollectionResponse,
  parseAssetResponse,
  type AssetDto,
} from '@/services/assetApi';

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    assetCode: 'AST-0001',
    name: 'Desktop Lab',
    category: 'Komputer',
    brand: null,
    model: null,
    serialNumber: null,
    homeLaboratoryId: null,
    condition: 'unknown',
    lifecycleStatus: 'active',
    acquisitionDate: null,
    acquisitionYear: null,
    fundingSource: null,
    purchasePrice: null,
    supplierName: null,
    warrantyUntil: null,
    notes: null,
    linkedDeviceId: null,
    version: 1,
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  const current = asset();
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: current })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: current })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: current })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: current })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Asset API contract', () => {
  it('parses canonical nullable fields and pagination strictly', () => {
    expect(parseAssetResponse({ data: asset() })).toEqual(asset());
    const page = parseAssetCollectionResponse({
      data: [asset()],
      meta: { page: 1, perPage: 25, total: 1, lastPage: 1 },
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta.total).toBe(1);
  });

  it.each([
    ['assetCode', 'bad code'],
    ['condition', 'Maintenance'],
    ['lifecycleStatus', 'Dipinjam'],
    ['version', 0],
    ['purchasePrice', -1],
    ['acquisitionYear', 1899],
    ['linkedDeviceId', 'not-ulid'],
    ['createdAt', 'not-a-date'],
  ])('rejects malformed field %s', (field, value) => {
    expect(() => parseAssetResponse({ data: asset({ [field]: value } as Partial<AssetDto>) })).toThrow(AssetContractError);
  });

  it('rejects unknown DTO and envelope fields', () => {
    expect(() => parseAssetResponse({ data: { ...asset(), status: 'Aktif' } })).toThrow(AssetContractError);
    expect(() => parseAssetResponse({ data: asset(), legacy: true })).toThrow(AssetContractError);
    expect(() => parseAssetCollectionResponse({ data: [], meta: { page: 1, perPage: 0, total: 0, lastPage: 1 } })).toThrow(AssetContractError);
  });

  it('builds encoded filters and strong If-Match', () => {
    expect(buildAssetListPath({ page: 2, perPage: 50, search: ' PC 01 ', condition: 'good' }))
      .toBe('/assets?page=2&perPage=50&search=PC+01&condition=good');
    expect(assetPath('asset/id')).toBe('/assets/asset%2Fid');
    expect(assetIfMatch(3)).toBe('"3"');
    expect(() => assetIfMatch(0)).toThrow(AssetContractError);
  });

  it('uses explicit action endpoints and never exposes hard delete', async () => {
    const current = asset();
    const get = vi.fn(async (path: string) => path.includes('?')
      ? { data: [current], meta: { page: 1, perPage: 500, total: 1, lastPage: 1 } }
      : { data: current });
    const post = vi.fn(async () => ({ data: current }));
    const patch = vi.fn(async () => ({ data: current }));
    const gateway = createAssetGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.listAll();
    await gateway.show('asset/id');
    await gateway.create({ assetCode: 'AST-1', name: 'A', category: 'C' });
    await gateway.update('asset/id', 2, { condition: 'good' });
    await gateway.linkDevice('asset/id', 3, 'device/id');
    await gateway.unlinkDevice('asset/id', 4, 'Correction');
    await gateway.retire('asset/id', 5, 'End of life');
    await gateway.dispose('asset/id', 6, 'Approved disposal');

    expect(get.mock.calls.map(([path]) => path)).toEqual(['/assets?page=1&perPage=500', '/assets/asset%2Fid']);
    expect(patch).toHaveBeenCalledWith('/assets/asset%2Fid', { condition: 'good' }, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith('/assets/asset%2Fid/device-link', { deviceId: 'device/id' }, { ifMatch: '"3"' });
    expect(post).toHaveBeenCalledWith('/assets/asset%2Fid/device-unlink', { reason: 'Correction' }, { ifMatch: '"4"' });
    expect(post).toHaveBeenCalledWith('/assets/asset%2Fid/retire', { reason: 'End of life' }, { ifMatch: '"5"' });
    expect(post).toHaveBeenCalledWith('/assets/asset%2Fid/dispose', { reason: 'Approved disposal' }, { ifMatch: '"6"' });
    expect('remove' in gateway).toBe(false);
  });
});
