import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import type { Asset, Device } from '@/types';
import {
  findDeviceByQrPublicId,
  generateDeviceQrPublicId,
  getDeviceInventoryLinkStatus,
  isValidQrPublicId,
  migrateLegacyManagedDevices,
  validateManagedDeviceInventory,
} from '../index';

function token(character: string): string {
  return `qr_${character.repeat(32)}`;
}

function withoutManagedIdentity(device: Device) {
  const { deviceType, lifecycleStatus, qrPublicId, assetId, ...legacy } = device;
  void deviceType;
  void lifecycleStatus;
  void qrPublicId;
  void assetId;
  return legacy;
}

function oneDeviceFixture() {
  const db = generateSeedData();
  const device = db.devices[0];
  const asset = db.assets.find((candidate) => candidate.id === device.assetId)!;
  return { device, asset, legacy: withoutManagedIdentity(device) };
}

describe('managed Device QR identity', () => {
  it('generates an opaque URL-safe public ID independently from operational identifiers', () => {
    const qrPublicId = generateDeviceQrPublicId(() => '123e4567-e89b-12d3-a456-426614174000');
    expect(qrPublicId).toBe('qr_123e4567e89b12d3a456426614174000');
    expect(isValidQrPublicId(qrPublicId)).toBe(true);
    expect(qrPublicId).not.toBe('device-1');
    expect(qrPublicId).not.toBe('AST-001');
    expect(qrPublicId).not.toBe('SERIAL-001');
  });

  it('resolves exactly one Device by qrPublicId', () => {
    const db = generateSeedData();
    const device = db.devices[0];
    expect(findDeviceByQrPublicId(db, device.qrPublicId)).toEqual({ ok: true, device });
  });

  it('returns not found for an unknown exact QR identifier', () => {
    expect(findDeviceByQrPublicId(generateSeedData(), token('z'))).toEqual({ ok: false, reason: 'not_found' });
  });

  it('never resolves an arbitrary first Device when corrupted data duplicates a QR', () => {
    const db = generateSeedData();
    db.devices[1].qrPublicId = db.devices[0].qrPublicId;
    expect(findDeviceByQrPublicId(db, db.devices[0].qrPublicId)).toEqual({
      ok: false,
      reason: 'integrity_failure',
      deviceIds: [db.devices[0].id, db.devices[1].id],
    });
  });

  it('rejects duplicate qrPublicId in canonical validation', () => {
    const db = generateSeedData();
    db.devices[1].qrPublicId = db.devices[0].qrPublicId;
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('duplicate-qr-public-id');
  });

  it('retries a generated QR collision without overwriting another Device identity', () => {
    const { legacy } = oneDeviceFixture();
    const second = { ...legacy, id: 'device-second', assetCode: 'UNLINKED-SECOND', serialNumber: 'SECOND' };
    const values = [token('a'), token('a'), token('b')];
    const migrated = migrateLegacyManagedDevices({ devices: [legacy, second], assets: [], generateQrPublicId: () => values.shift()! });
    expect(migrated).toMatchObject({ ok: true });
    if (migrated.ok) expect(migrated.devices.map((device) => device.qrPublicId)).toEqual([token('a'), token('b')]);
  });

  it('fails atomically when unique QR generation is exhausted', () => {
    const { legacy } = oneDeviceFixture();
    const second = { ...legacy, id: 'device-second' };
    const before = JSON.stringify([legacy, second]);
    expect(migrateLegacyManagedDevices({ devices: [legacy, second], assets: [], generateQrPublicId: () => token('a') })).toMatchObject({
      ok: false,
      issues: [{ code: 'qr-generation-failed', deviceId: second.id }],
    });
    expect(JSON.stringify([legacy, second])).toBe(before);
  });
});

describe('legacy Asset to Device linking', () => {
  it('links exactly one matching assetCode in the same laboratory', () => {
    const { legacy, asset } = oneDeviceFixture();
    const migrated = migrateLegacyManagedDevices({ devices: [legacy], assets: [asset], generateQrPublicId: () => token('a') });
    expect(migrated).toMatchObject({ ok: true, devices: [{ assetId: asset.id }] });
  });

  it('leaves a Device unlinked and does not fabricate an Asset when no match exists', () => {
    const { legacy } = oneDeviceFixture();
    const assets: Asset[] = [];
    const migrated = migrateLegacyManagedDevices({ devices: [legacy], assets, generateQrPublicId: () => token('a') });
    expect(migrated).toMatchObject({ ok: true, devices: [{ assetId: undefined }] });
    expect(assets).toEqual([]);
  });

  it('does not link the same assetCode from a different laboratory', () => {
    const { legacy, asset } = oneDeviceFixture();
    const migrated = migrateLegacyManagedDevices({ devices: [legacy], assets: [{ ...asset, laboratoryId: 'other-lab' }], generateQrPublicId: () => token('a') });
    expect(migrated).toMatchObject({ ok: true, devices: [{ assetId: undefined }] });
  });

  it('never chooses the first of multiple matching Assets', () => {
    const { legacy, asset } = oneDeviceFixture();
    const migrated = migrateLegacyManagedDevices({ devices: [legacy], assets: [asset, { ...asset, id: 'duplicate-match' }], generateQrPublicId: () => token('a') });
    expect(migrated).toMatchObject({ ok: true, devices: [{ assetId: undefined }] });
  });

  it('derives linked, unlinked, and invalid inventory status without persistence fields', () => {
    const db = generateSeedData();
    const linked = db.devices[0];
    expect(getDeviceInventoryLinkStatus(db, linked)).toMatchObject({ status: 'linked', asset: { id: linked.assetId } });
    expect(getDeviceInventoryLinkStatus(db, { ...linked, assetId: undefined })).toEqual({ status: 'unlinked' });
    expect(getDeviceInventoryLinkStatus(db, { ...linked, assetCode: 'MISMATCH' })).toMatchObject({ status: 'invalid' });
  });
});

describe('canonical Device and Asset relationship validation', () => {
  it('rejects a missing linked Asset', () => {
    const db = generateSeedData();
    db.devices[0].assetId = 'missing-asset';
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('missing-device-asset');
  });

  it('rejects two Devices linked to one Asset', () => {
    const db = generateSeedData();
    db.devices[1].assetId = db.devices[0].assetId;
    db.devices[1].assetCode = db.devices[0].assetCode;
    db.devices[1].laboratoryId = db.devices[0].laboratoryId;
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('duplicate-device-asset-link');
  });

  it('rejects linked Device and Asset code mismatch', () => {
    const db = generateSeedData();
    db.devices[0].assetCode = 'MISMATCH';
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('device-asset-code-mismatch');
  });

  it('rejects linked Device and Asset laboratory mismatch', () => {
    const db = generateSeedData();
    db.devices[0].laboratoryId = 'other-lab';
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('device-asset-laboratory-mismatch');
  });

  it('keeps hardware type independent from student and teacher layout roles', () => {
    const db = generateSeedData();
    const references = db.layouts.flatMap((layout) => layout.elements.filter((element) => element.referenceId));
    expect(references.every((element) => element.type === 'student_pc' && db.devices.find((device) => device.id === element.referenceId)?.deviceType === 'desktop_pc')).toBe(true);
  });
});
