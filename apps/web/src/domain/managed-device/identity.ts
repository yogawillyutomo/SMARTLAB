import type {
  Asset,
  Device,
  DeviceLifecycleStatus,
  ID,
  ManagedDeviceType,
} from '@/types';
import { validateCanonicalDeviceTechnicalProfile, type DeviceTechnicalProfileIssueCode } from './technicalProfiles';

export const MANAGED_DEVICE_TYPES = [
  'desktop_pc',
  'laptop',
  'server',
  'network_switch',
  'router',
  'access_point',
  'printer',
  'projector',
  'ups',
  'other',
] as const satisfies readonly ManagedDeviceType[];

export const DEVICE_LIFECYCLE_STATUSES = [
  'in_service',
  'spare',
  'retired',
  'decommissioned',
] as const satisfies readonly DeviceLifecycleStatus[];

const QR_PUBLIC_ID_PATTERN = /^qr_[A-Za-z0-9_-]{16,}$/;
const QR_GENERATION_ATTEMPTS = 32;

export type QrPublicIdFactory = () => string;

export type ManagedDeviceIntegrityIssueCode =
  | 'invalid-device-type'
  | 'invalid-device-lifecycle'
  | 'invalid-qr-public-id'
  | 'duplicate-qr-public-id'
  | 'missing-device-asset'
  | 'ambiguous-device-asset'
  | 'duplicate-device-asset-link'
  | 'device-asset-code-mismatch'
  | 'device-asset-laboratory-mismatch'
  | DeviceTechnicalProfileIssueCode;

export interface ManagedDeviceIntegrityIssue {
  code: ManagedDeviceIntegrityIssueCode;
  message: string;
  deviceId?: ID;
  assetId?: ID;
}

export type ManagedDeviceMigrationIssue = {
  code: 'qr-generation-failed';
  message: string;
  deviceId: ID;
};

export type ManagedDeviceMigrationResult =
  | { ok: true; devices: LegacyManagedDeviceWithIdentity[] }
  | { ok: false; issues: ManagedDeviceMigrationIssue[] };

export type DeviceQrResolutionResult =
  | { ok: true; device: Device }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'integrity_failure'; deviceIds: ID[] };

export type DeviceInventoryLinkStatus =
  | { status: 'linked'; asset: Asset }
  | { status: 'unlinked' }
  | { status: 'invalid'; reason: string };

export type AssetDeviceLinkStatus =
  | { status: 'linked'; asset: Asset; device: Device }
  | { status: 'unlinked'; asset: Asset }
  | { status: 'invalid'; message: string; asset?: Asset; deviceIds?: ID[] };

export type AssetMutationRequest =
  | { operation: 'update'; assetId: ID; changes: Partial<Asset> }
  | { operation: 'delete'; assetId: ID }
  | { operation: 'transfer'; assetId: ID; toLaboratoryId: ID };

export type AssetMutationPolicyResult =
  | { ok: true; link: Extract<AssetDeviceLinkStatus, { status: 'linked' | 'unlinked' }> }
  | {
    ok: false;
    reason:
      | 'asset_link_invalid'
      | 'linked_asset_code_change_not_allowed'
      | 'linked_asset_laboratory_change_not_allowed'
      | 'linked_asset_brand_change_not_allowed'
      | 'linked_asset_model_change_not_allowed'
      | 'linked_asset_serial_number_change_not_allowed'
      | 'linked_asset_delete_not_allowed'
      | 'linked_asset_transfer_not_allowed';
    message: string;
    link: AssetDeviceLinkStatus;
  };

type LegacyManagedDevice = Omit<Device, 'deviceType' | 'lifecycleStatus' | 'qrPublicId' | 'assetId' | 'technicalProfile'>
  & {
    processor?: string;
    ramGB?: number;
    storageGB?: number;
    gpu?: string;
    monitor?: string;
    os?: string;
    peripherals?: {
      monitor: boolean;
      keyboard: boolean;
      mouse: boolean;
      headset: boolean;
      network: boolean;
      ups: boolean;
    };
  }
  & Partial<Pick<Device, 'deviceType' | 'lifecycleStatus' | 'qrPublicId' | 'assetId'>>;

type LegacyManagedDeviceWithIdentity = LegacyManagedDevice
  & Required<Pick<Device, 'deviceType' | 'lifecycleStatus' | 'qrPublicId'>>;

export function isManagedDeviceType(value: unknown): value is ManagedDeviceType {
  return typeof value === 'string' && (MANAGED_DEVICE_TYPES as readonly string[]).includes(value);
}

export function isDeviceLifecycleStatus(value: unknown): value is DeviceLifecycleStatus {
  return typeof value === 'string' && (DEVICE_LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

export function isValidQrPublicId(value: unknown): value is string {
  return typeof value === 'string' && QR_PUBLIC_ID_PATTERN.test(value);
}

export function generateDeviceQrPublicId(randomUUID: () => string = () => globalThis.crypto.randomUUID()): string {
  return `qr_${randomUUID().replace(/-/g, '')}`;
}

function generatedQrPublicId(
  device: Pick<LegacyManagedDevice, 'id' | 'assetCode' | 'serialNumber'>,
  used: Set<string>,
  factory: QrPublicIdFactory,
): string | null {
  for (let attempt = 0; attempt < QR_GENERATION_ATTEMPTS; attempt += 1) {
    let candidate: string;
    try {
      candidate = factory();
    } catch {
      continue;
    }
    if (!isValidQrPublicId(candidate)
      || used.has(candidate)
      || candidate === device.id
      || candidate === device.assetCode
      || candidate === device.serialNumber) continue;
    used.add(candidate);
    return candidate;
  }
  return null;
}

export function migrateLegacyManagedDevices(input: {
  devices: readonly LegacyManagedDevice[];
  assets: readonly Asset[];
  generateQrPublicId?: QrPublicIdFactory;
}): ManagedDeviceMigrationResult {
  const factory = input.generateQrPublicId ?? generateDeviceQrPublicId;
  const usedQrPublicIds = new Set<string>();
  const migrated: LegacyManagedDeviceWithIdentity[] = [];
  for (const source of input.devices) {
    const qrPublicId = generatedQrPublicId(source, usedQrPublicIds, factory);
    if (!qrPublicId) {
      return {
        ok: false,
        issues: [{ code: 'qr-generation-failed', message: 'QR publik perangkat tidak dapat dibuat secara unik.', deviceId: source.id }],
      };
    }
    const matchingAssets = input.assets.filter((asset) => asset.assetCode === source.assetCode && asset.laboratoryId === source.laboratoryId);
    migrated.push({
      ...source,
      deviceType: 'desktop_pc',
      lifecycleStatus: 'in_service',
      qrPublicId,
      ...(matchingAssets.length === 1 ? { assetId: matchingAssets[0].id } : { assetId: undefined }),
    });
  }
  return { ok: true, devices: migrated };
}

export function findDeviceByQrPublicId(
  db: Pick<{ devices: Device[] }, 'devices'>,
  qrPublicId: string,
): DeviceQrResolutionResult {
  const matches = db.devices.filter((device) => device.qrPublicId === qrPublicId);
  if (matches.length === 0) return { ok: false, reason: 'not_found' };
  if (matches.length > 1) return { ok: false, reason: 'integrity_failure', deviceIds: matches.map((device) => device.id) };
  return { ok: true, device: matches[0] };
}

export function getDeviceInventoryLinkStatus(
  db: Pick<{ devices: Device[]; assets: Asset[] }, 'devices' | 'assets'>,
  device: Device,
): DeviceInventoryLinkStatus {
  if (!device.assetId) return { status: 'unlinked' };
  const assets = db.assets.filter((asset) => asset.id === device.assetId);
  if (assets.length !== 1) return { status: 'invalid', reason: 'Asset perangkat tidak ditemukan secara unik.' };
  const asset = assets[0];
  if (db.devices.some((candidate) => candidate.id !== device.id && candidate.assetId === asset.id)) {
    return { status: 'invalid', reason: 'Asset digunakan oleh lebih dari satu perangkat.' };
  }
  if (asset.assetCode !== device.assetCode) return { status: 'invalid', reason: 'Kode aset perangkat dan inventaris berbeda.' };
  if (asset.laboratoryId !== device.laboratoryId) return { status: 'invalid', reason: 'Laboratorium perangkat dan inventaris berbeda.' };
  return { status: 'linked', asset };
}

export function getAssetDeviceLink(
  db: Pick<{ devices: Device[]; assets: Asset[] }, 'devices' | 'assets'>,
  assetId: ID,
): AssetDeviceLinkStatus {
  const assets = db.assets.filter((asset) => asset.id === assetId);
  if (assets.length !== 1) {
    return {
      status: 'invalid',
      message: assets.length === 0 ? 'Aset tidak ditemukan.' : 'ID aset tidak unik.',
    };
  }
  const asset = assets[0];
  const devices = db.devices.filter((device) => device.assetId === asset.id);
  if (devices.length === 0) return { status: 'unlinked', asset };
  if (devices.length > 1) {
    return {
      status: 'invalid',
      asset,
      deviceIds: devices.map((device) => device.id),
      message: 'Aset tertaut ke lebih dari satu perangkat.',
    };
  }
  const device = devices[0];
  const inventoryStatus = getDeviceInventoryLinkStatus(db, device);
  if (inventoryStatus.status !== 'linked' || inventoryStatus.asset.id !== asset.id) {
    return {
      status: 'invalid',
      asset,
      deviceIds: [device.id],
      message: inventoryStatus.status === 'invalid' ? inventoryStatus.reason : 'Relasi aset dan perangkat tidak konsisten.',
    };
  }
  return { status: 'linked', asset, device };
}

export function validateAssetMutation(
  db: Pick<{ devices: Device[]; assets: Asset[] }, 'devices' | 'assets'>,
  request: AssetMutationRequest,
): AssetMutationPolicyResult {
  const link = getAssetDeviceLink(db, request.assetId);
  if (link.status === 'invalid') {
    return { ok: false, reason: 'asset_link_invalid', message: `Relasi aset dan perangkat tidak valid: ${link.message}`, link };
  }
  if (link.status === 'unlinked') return { ok: true, link };

  if (request.operation === 'update') {
    if (request.changes.assetCode !== undefined && request.changes.assetCode !== link.asset.assetCode) {
      return {
        ok: false,
        reason: 'linked_asset_code_change_not_allowed',
        message: 'Kode aset tertaut tidak dapat diubah. Gunakan alur perangkat terkelola yang terkontrol.',
        link,
      };
    }
    if (request.changes.laboratoryId !== undefined && request.changes.laboratoryId !== link.asset.laboratoryId) {
      return {
        ok: false,
        reason: 'linked_asset_laboratory_change_not_allowed',
        message: 'Laboratorium aset tertaut tidak dapat diubah. Gunakan alur transfer perangkat terkontrol.',
        link,
      };
    }
    if (request.changes.brand !== undefined && request.changes.brand !== link.asset.brand) {
      return {
        ok: false,
        reason: 'linked_asset_brand_change_not_allowed',
        message: 'Brand aset tertaut tidak dapat diubah. Gunakan alur perangkat terkelola yang terkontrol.',
        link,
      };
    }
    if (request.changes.model !== undefined && request.changes.model !== link.asset.model) {
      return {
        ok: false,
        reason: 'linked_asset_model_change_not_allowed',
        message: 'Model aset tertaut tidak dapat diubah. Gunakan alur perangkat terkelola yang terkontrol.',
        link,
      };
    }
    if (request.changes.serialNumber !== undefined && request.changes.serialNumber !== link.asset.serialNumber) {
      return {
        ok: false,
        reason: 'linked_asset_serial_number_change_not_allowed',
        message: 'Serial number aset tertaut tidak dapat diubah. Gunakan alur perangkat terkelola yang terkontrol.',
        link,
      };
    }
    return { ok: true, link };
  }
  if (request.operation === 'delete') {
    return {
      ok: false,
      reason: 'linked_asset_delete_not_allowed',
      message: 'Aset tertaut ke perangkat terkelola dan tidak dapat dihapus.',
      link,
    };
  }
  return {
    ok: false,
    reason: 'linked_asset_transfer_not_allowed',
    message: 'Aset tertaut ke perangkat terkelola. Gunakan alur transfer perangkat terkontrol.',
    link,
  };
}

export function validateManagedDeviceInventory(
  db: Pick<{ devices: Device[]; assets: Asset[] }, 'devices' | 'assets'>,
): { valid: boolean; issues: ManagedDeviceIntegrityIssue[] } {
  const issues: ManagedDeviceIntegrityIssue[] = [];
  const qrOwners = new Map<string, ID>();
  const assetOwners = new Map<ID, ID>();
  for (const device of db.devices) {
    if (!isManagedDeviceType(device.deviceType)) {
      issues.push({ code: 'invalid-device-type', message: 'Jenis perangkat terkelola tidak valid.', deviceId: device.id });
    }
    if (!isDeviceLifecycleStatus(device.lifecycleStatus)) {
      issues.push({ code: 'invalid-device-lifecycle', message: 'Status lifecycle perangkat tidak valid.', deviceId: device.id });
    }
    const profileValidation = validateCanonicalDeviceTechnicalProfile(device);
    profileValidation.issues.forEach((issue) => {
      issues.push({ code: issue.code, message: issue.message, deviceId: device.id });
    });
    if (!isValidQrPublicId(device.qrPublicId)) {
      issues.push({ code: 'invalid-qr-public-id', message: 'QR publik perangkat tidak valid.', deviceId: device.id });
    } else if (qrOwners.has(device.qrPublicId)) {
      issues.push({ code: 'duplicate-qr-public-id', message: 'QR publik perangkat tidak boleh duplikat.', deviceId: device.id });
    } else {
      qrOwners.set(device.qrPublicId, device.id);
    }
    if (!device.assetId) continue;
    const linkedAssets = db.assets.filter((asset) => asset.id === device.assetId);
    if (linkedAssets.length === 0) {
      issues.push({ code: 'missing-device-asset', message: 'Asset tertaut tidak ditemukan.', deviceId: device.id, assetId: device.assetId });
      continue;
    }
    if (linkedAssets.length > 1) {
      issues.push({ code: 'ambiguous-device-asset', message: 'Asset tertaut tidak unik.', deviceId: device.id, assetId: device.assetId });
      continue;
    }
    const existingOwner = assetOwners.get(device.assetId);
    if (existingOwner) {
      issues.push({ code: 'duplicate-device-asset-link', message: 'Satu Asset tidak boleh tertaut ke lebih dari satu Device.', deviceId: device.id, assetId: device.assetId });
    } else {
      assetOwners.set(device.assetId, device.id);
    }
    const asset = linkedAssets[0];
    if (asset.assetCode !== device.assetCode) {
      issues.push({ code: 'device-asset-code-mismatch', message: 'Kode Asset dan Device tertaut harus sama.', deviceId: device.id, assetId: asset.id });
    }
    if (asset.laboratoryId !== device.laboratoryId) {
      issues.push({ code: 'device-asset-laboratory-mismatch', message: 'Laboratorium Asset dan Device tertaut harus sama.', deviceId: device.id, assetId: asset.id });
    }
  }
  return { valid: issues.length === 0, issues };
}
