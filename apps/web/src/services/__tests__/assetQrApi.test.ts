import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  AssetQrContractError,
  buildAssetQrCandidatePath,
  createAssetQrGateway,
  parseAssetQrLabelBatch,
  parseAssetQrLabelCandidate,
  type AssetQrLabelBatch,
  type AssetQrLabelCandidate,
} from '@/services/assetQrApi';

const ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const LAB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const BATCH_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const QR_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const PUBLIC_ID = '550e8400-e29b-41d4-a716-446655440000';

function candidate(overrides: Partial<AssetQrLabelCandidate> = {}): AssetQrLabelCandidate {
  return {
    id: ASSET_ID,
    assetCode: 'AST-0001',
    name: 'Desktop RPL 01',
    category: 'Komputer',
    condition: 'good',
    lifecycleStatus: 'active',
    linked: true,
    laboratory: { id: LAB_ID, code: 'RPL1', name: 'Lab RPL 1' },
    qr: { status: 'active', tokenVersion: 2, printed: false },
    ...overrides,
  };
}

function batch(overrides: Partial<AssetQrLabelBatch> = {}): AssetQrLabelBatch {
  return {
    id: BATCH_ID,
    templateKey: '50x30',
    filters: {},
    assetCount: 1,
    laboratory: null,
    generatedByName: 'Operator Lab',
    generatedAt: '2026-09-10T13:00:00.000Z',
    items: [{
      ordinal: 1,
      assetId: ASSET_ID,
      assetCode: 'AST-0001',
      assetName: 'Desktop RPL 01',
      laboratory: { id: LAB_ID, code: 'RPL1', name: 'Lab RPL 1' },
      publicId: PUBLIC_ID,
      tokenVersion: 2,
      scanPath: `/api/v1/public/assets/qr/${PUBLIC_ID}`,
    }],
    events: [{
      type: 'generated',
      actorName: 'Operator Lab',
      payload: { assetCount: 1 },
      createdAt: '2026-09-10T13:00:00.000Z',
    }],
    ...overrides,
  };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: [] })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: batch() })) as ApiClient['post'],
    put: vi.fn(async () => undefined) as ApiClient['put'],
    patch: vi.fn(async () => undefined) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Asset QR / label API contract', () => {
  it('parses only the safe candidate projection and rejects sensitive expansion', () => {
    expect(parseAssetQrLabelCandidate(candidate())).toEqual(candidate());
    expect(() => parseAssetQrLabelCandidate({ ...candidate(), serialNumber: 'SECRET-SERIAL' }))
      .toThrow(AssetQrContractError);
    expect(() => parseAssetQrLabelCandidate({ ...candidate(), purchasePrice: 20_000_000 }))
      .toThrow(AssetQrContractError);
    expect(() => parseAssetQrLabelCandidate({ ...candidate(), supplierName: 'Sensitive Supplier' }))
      .toThrow(AssetQrContractError);
  });

  it('builds canonical server-side candidate filters', () => {
    expect(buildAssetQrCandidatePath({
      laboratoryId: LAB_ID,
      search: ' AST 01 ',
      category: ' Komputer ',
      condition: 'good',
      lifecycleStatus: 'active',
      linkStatus: 'linked',
      qrStatus: 'missing',
      printedStatus: 'unprinted',
      page: 2,
      perPage: 50,
    })).toBe(
      `/asset-qr-label-candidates?laboratoryId=${LAB_ID}&category=Komputer&condition=good&lifecycleStatus=active&linkStatus=linked&qrStatus=missing&printedStatus=unprinted&search=AST+01&page=2&perPage=50`,
    );
  });

  it('sends exact Asset IDs plus the filter snapshot when generating a batch', async () => {
    const post = vi.fn(async () => ({ data: batch() }));
    const gateway = createAssetQrGateway(clientWith({ post: post as ApiClient['post'] }));

    await gateway.generateBatch({
      templateKey: '50x30',
      assetIds: [ASSET_ID],
      selection: { laboratoryId: LAB_ID, search: ' Desktop ' },
    });

    expect(post).toHaveBeenCalledWith('/asset-qr-label-batches', {
      templateKey: '50x30',
      assetIds: [ASSET_ID],
      selection: { laboratoryId: LAB_ID, search: 'Desktop' },
    });
    await expect(gateway.generateBatch({ templateKey: '50x30', assetIds: [ASSET_ID, ASSET_ID] }))
      .rejects.toThrow(AssetQrContractError);
  });

  it('uses QR tokenVersion as a strong If-Match for rotate and revoke', async () => {
    const identity = {
      id: QR_ID,
      assetId: ASSET_ID,
      publicId: PUBLIC_ID,
      tokenVersion: 3,
      status: 'active' as const,
      issuedAt: '2026-09-10T13:00:00.000Z',
      revokedReason: null,
      revokedAt: null,
    };
    const post = vi.fn(async () => ({ data: identity }));
    const gateway = createAssetQrGateway(clientWith({ post: post as ApiClient['post'] }));

    await gateway.rotate(ASSET_ID, 2, 'Sticker rusak');
    await gateway.revoke(ASSET_ID, 3, 'Asset dihapuskan');

    expect(post).toHaveBeenNthCalledWith(
      1,
      `/assets/${ASSET_ID}/qr-identities/rotate`,
      { reason: 'Sticker rusak' },
      { ifMatch: '"2"' },
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      `/assets/${ASSET_ID}/qr-identities/revoke`,
      { reason: 'Asset dihapuskan' },
      { ifMatch: '"3"' },
    );
  });

  it('accepts an empty filter object but rejects a mismatched public scan path', () => {
    expect(parseAssetQrLabelBatch(batch()).filters).toEqual({});
    expect(() => parseAssetQrLabelBatch(batch({
      items: [{
        ...batch().items![0],
        scanPath: '/api/v1/public/assets/qr/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }],
    }))).toThrow(AssetQrContractError);
  });
});
