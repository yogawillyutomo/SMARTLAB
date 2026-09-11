import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import { AssetQrPublicContractError, createAssetQrPublicGateway } from '@/services/assetQrPublicApi';

const PUBLIC_ID = '123e4567-e89b-12d3-a456-426614174000';
const ASSET_ID = '01J8Y2N7W9B3H6K4M5P8Q1R2ST';

function clientWithGet(get: (path: string) => Promise<unknown>): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: get as ApiClient['get'],
    post: vi.fn() as unknown as ApiClient['post'],
    put: vi.fn() as unknown as ApiClient['put'],
    patch: vi.fn() as unknown as ApiClient['patch'],
    delete: vi.fn() as unknown as ApiClient['delete'],
  };
}

describe('Asset QR public gateway', () => {
  it('accepts only the locked anonymous safe-minimal projection', async () => {
    const get = vi.fn(async () => ({
      data: {
        school: { code: 'SMKN1PWT', name: 'SMK Negeri 1 Purwokerto' },
        asset: {
          assetCode: 'AST-001',
          name: 'PC Praktikum 1',
          category: 'Komputer',
          condition: 'good',
          lifecycleStatus: 'active',
          homeLaboratory: { code: 'RPL1', name: 'Lab RPL 1' },
        },
      },
    }));
    const gateway = createAssetQrPublicGateway(clientWithGet(get));

    await expect(gateway.resolvePublic(PUBLIC_ID)).resolves.toEqual({
      school: { code: 'SMKN1PWT', name: 'SMK Negeri 1 Purwokerto' },
      asset: {
        assetCode: 'AST-001',
        name: 'PC Praktikum 1',
        category: 'Komputer',
        condition: 'good',
        lifecycleStatus: 'active',
        homeLaboratory: { code: 'RPL1', name: 'Lab RPL 1' },
      },
    });
    expect(get).toHaveBeenCalledWith(`/public/assets/qr/${PUBLIC_ID}`);
  });

  it('rejects any unexpected anonymous field instead of silently accepting sensitive expansion', async () => {
    const gateway = createAssetQrPublicGateway(clientWithGet(vi.fn(async () => ({
      data: {
        school: { code: 'S', name: 'School' },
        asset: {
          assetCode: 'AST-001',
          name: 'PC',
          category: 'Komputer',
          condition: 'good',
          lifecycleStatus: 'active',
          homeLaboratory: null,
          serialNumber: 'SECRET',
        },
      },
    }))));

    await expect(gateway.resolvePublic(PUBLIC_ID)).rejects.toBeInstanceOf(AssetQrPublicContractError);
  });

  it('uses the authenticated resolver only to obtain the canonical internal Asset target', async () => {
    const get = vi.fn(async () => ({ data: { assetId: ASSET_ID } }));
    const gateway = createAssetQrPublicGateway(clientWithGet(get));

    await expect(gateway.resolveAuthenticated(PUBLIC_ID)).resolves.toEqual({ assetId: ASSET_ID });
    expect(get).toHaveBeenCalledWith(`/asset-qr/${PUBLIC_ID}`);
  });

  it('rejects malformed public identifiers before sending a request', async () => {
    const get = vi.fn(async () => ({}));
    const gateway = createAssetQrPublicGateway(clientWithGet(get));

    await expect(gateway.resolvePublic('asset-01')).rejects.toBeInstanceOf(AssetQrPublicContractError);
    expect(get).not.toHaveBeenCalled();
  });
});
