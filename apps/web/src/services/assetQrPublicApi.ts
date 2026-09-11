import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import {
  ASSET_CONDITIONS,
  ASSET_LIFECYCLE_STATUSES,
  type AssetCondition,
  type AssetLifecycleStatus,
} from '@/services/assetApi';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicAssetQrView {
  school: {
    code: string;
    name: string;
  };
  asset: {
    assetCode: string;
    name: string;
    category: string;
    condition: AssetCondition;
    lifecycleStatus: AssetLifecycleStatus;
    homeLaboratory: {
      code: string;
      name: string;
    } | null;
  };
}

export interface AuthenticatedAssetQrTarget {
  assetId: string;
}

export interface AssetQrPublicGateway {
  resolvePublic: (publicId: string) => Promise<PublicAssetQrView>;
  resolveAuthenticated: (publicId: string) => Promise<AuthenticatedAssetQrTarget>;
}

export class AssetQrPublicContractError extends Error {
  constructor(message = 'Respons public Asset QR tidak sesuai kontrak API.') {
    super(message);
    this.name = 'AssetQrPublicContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !keys.includes(key))) {
    throw new AssetQrPublicContractError();
  }
}

function requiredString(record: Record<string, unknown>, field: string, max = 255): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new AssetQrPublicContractError();
  return value;
}

function encodePublicId(publicId: string): string {
  if (!UUID_PATTERN.test(publicId)) throw new AssetQrPublicContractError('Public Asset QR identifier tidak valid.');
  return encodeURIComponent(publicId.toLowerCase());
}

function parseLaboratory(value: unknown): PublicAssetQrView['asset']['homeLaboratory'] {
  if (value === null) return null;
  if (!isRecord(value)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value, ['code', 'name']);
  return {
    code: requiredString(value, 'code', 100),
    name: requiredString(value, 'name'),
  };
}

function parsePublicEnvelope(value: unknown): PublicAssetQrView {
  if (!isRecord(value)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value, ['data']);
  if (!isRecord(value.data)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value.data, ['school', 'asset']);
  if (!isRecord(value.data.school) || !isRecord(value.data.asset)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value.data.school, ['code', 'name']);
  assertOnlyKeys(value.data.asset, ['assetCode', 'name', 'category', 'condition', 'lifecycleStatus', 'homeLaboratory']);

  if (!(ASSET_CONDITIONS as readonly unknown[]).includes(value.data.asset.condition)
    || !(ASSET_LIFECYCLE_STATUSES as readonly unknown[]).includes(value.data.asset.lifecycleStatus)) {
    throw new AssetQrPublicContractError();
  }

  return {
    school: {
      code: requiredString(value.data.school, 'code', 100),
      name: requiredString(value.data.school, 'name'),
    },
    asset: {
      assetCode: requiredString(value.data.asset, 'assetCode', 100),
      name: requiredString(value.data.asset, 'name'),
      category: requiredString(value.data.asset, 'category', 120),
      condition: value.data.asset.condition as AssetCondition,
      lifecycleStatus: value.data.asset.lifecycleStatus as AssetLifecycleStatus,
      homeLaboratory: parseLaboratory(value.data.asset.homeLaboratory),
    },
  };
}

function parseAuthenticatedEnvelope(value: unknown): AuthenticatedAssetQrTarget {
  if (!isRecord(value)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value, ['data']);
  if (!isRecord(value.data)) throw new AssetQrPublicContractError();
  assertOnlyKeys(value.data, ['assetId']);
  const assetId = requiredString(value.data, 'assetId', 64);
  if (!isUlid(assetId)) throw new AssetQrPublicContractError();
  return { assetId };
}

export function createAssetQrPublicGateway(client: ApiClient): AssetQrPublicGateway {
  return {
    async resolvePublic(publicId) {
      return parsePublicEnvelope(await client.get<unknown>(`/public/assets/qr/${encodePublicId(publicId)}`));
    },
    async resolveAuthenticated(publicId) {
      return parseAuthenticatedEnvelope(await client.get<unknown>(`/asset-qr/${encodePublicId(publicId)}`));
    },
  };
}

export const assetQrPublicGateway = createAssetQrPublicGateway(apiClient);
