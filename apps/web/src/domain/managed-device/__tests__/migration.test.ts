import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { loadDB } from '@/lib/db';
import { normalizeDatabase } from '@/lib/dbMigrations';
import { CURRENT_DB_SCHEMA_VERSION, CURRENT_STORAGE_VERSION } from '@/lib/dbSchema';
import { STORAGE_KEYS } from '@/lib/storage';
import type { Device } from '@/types';

const DB_KEY = 'smartlab_pplg_db';
const MIGRATED_AT = '2026-08-19T08:00:00.000Z';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly writes = new Map<string, number>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writes.set(key, (this.writes.get(key) ?? 0) + 1);
  }
  seed(key: string, value: string): void { this.values.set(key, value); }
  writesFor(key: string): number { return this.writes.get(key) ?? 0; }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  let sequence = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `00000000-0000-4000-8000-${String(sequence += 1).padStart(12, '0')}`,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function legacyTechnicalDevice(device: Device) {
  const cloned = structuredClone(device);
  if (cloned.technicalProfile.kind !== 'desktop_pc') throw new Error('expected desktop seed');
  const { technicalProfile, ...common } = cloned;
  const { kind: _kind, ...technical } = technicalProfile;
  void _kind;
  return { ...common, ...technical };
}

function withoutManagedIdentity(device: ReturnType<typeof legacyTechnicalDevice>) {
  const { deviceType, lifecycleStatus, qrPublicId, assetId, ...legacy } = device;
  void deviceType;
  void lifecycleStatus;
  void qrPublicId;
  void assetId;
  return legacy;
}

function versionThreeDatabase() {
  const current = generateSeedData();
  return { ...structuredClone(current), schemaVersion: 3, devices: current.devices.map(legacyTechnicalDevice) };
}

function versionTwoDatabase() {
  const versionThree = versionThreeDatabase();
  return { ...versionThree, schemaVersion: 2, devices: versionThree.devices.map(withoutManagedIdentity) };
}

function versionOneDatabase() {
  const versionTwo = versionTwoDatabase();
  const placements = new Map(versionTwo.layouts.flatMap((layout) => layout.elements
    .filter((element) => element.referenceId)
    .map((element) => [element.referenceId!, element])));
  const legacy = { ...versionTwo } as Record<string, unknown>;
  delete legacy.schemaVersion;
  delete legacy.layouts;
  legacy.devices = versionTwo.devices.map((device) => {
    const element = placements.get(device.id)!;
    return { ...device, row: element.row, col: element.column };
  });
  return legacy;
}

function qrFactory() {
  let sequence = 0;
  return () => `qr_${String(sequence += 1).padStart(32, '0')}`;
}

describe('managed Device technical-profile schema migration', () => {
  it('migrates a v3 desktop losslessly into a canonical v4 technicalProfile', () => {
    const legacy = versionThreeDatabase();
    const source = legacy.devices[0];
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    expect(result).toMatchObject({ ok: true, changed: true, migratedFromVersion: 3 });
    if (!result.ok) return;
    const migrated = result.db.devices[0];
    expect(result.db.schemaVersion).toBe(4);
    expect(migrated.technicalProfile).toEqual({
      kind: 'desktop_pc', processor: source.processor, ramGB: source.ramGB, storageGB: source.storageGB,
      gpu: source.gpu, monitor: source.monitor, os: source.os, peripherals: source.peripherals,
    });
    expect(migrated.technicalProfile.kind === 'desktop_pc' && migrated.technicalProfile.peripherals).not.toBe(source.peripherals);
    ['processor', 'ramGB', 'storageGB', 'gpu', 'monitor', 'os', 'peripherals'].forEach((field) => {
      expect(Object.prototype.hasOwnProperty.call(migrated, field)).toBe(false);
    });
  });

  it('preserves identity, lifecycle, Asset link, status, telemetry, layouts, and unrelated collections', () => {
    const legacy = versionThreeDatabase();
    const source = legacy.devices[0];
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    if (!result.ok) throw new Error('expected successful migration');
    expect(result.db.devices[0]).toMatchObject({
      id: source.id, deviceType: source.deviceType, lifecycleStatus: source.lifecycleStatus,
      qrPublicId: source.qrPublicId, assetId: source.assetId, assetCode: source.assetCode, status: source.status,
      cpuUsage: source.cpuUsage, ramUsage: source.ramUsage, diskUsage: source.diskUsage,
      temperature: source.temperature, uptimeHours: source.uptimeHours, network: source.network,
      lastHeartbeat: source.lastHeartbeat,
    });
    expect(result.db.layouts).toEqual(legacy.layouts);
    Object.keys(legacy).filter((key) => !['schemaVersion', 'devices'].includes(key)).forEach((key) => {
      expect((result.db as unknown as Record<string, unknown>)[key]).toEqual((legacy as unknown as Record<string, unknown>)[key]);
    });
  });

  it('persists v3 once and does not rerun migration or regenerate QR on the second read', () => {
    const legacy = versionThreeDatabase();
    storage.seed(DB_KEY, JSON.stringify(legacy));
    storage.seed(STORAGE_KEYS.VERSION, '3.0.0');
    const first = loadDB();
    expect(first).toMatchObject({ ok: true, mode: 'persisted', migrated: true });
    if (!first.ok) return;
    expect(first.db.devices.map((device) => device.qrPublicId)).toEqual(legacy.devices.map((device) => device.qrPublicId));
    expect(storage.writesFor(DB_KEY)).toBe(1);
    expect(storage.getItem(STORAGE_KEYS.VERSION)).toBe('4.0.0');
    const persisted = storage.getItem(DB_KEY);
    expect(loadDB()).toMatchObject({ ok: true, mode: 'persisted', migrated: false });
    expect(storage.getItem(DB_KEY)).toBe(persisted);
    expect(storage.writesFor(DB_KEY)).toBe(1);
  });

  it('round-trips canonical v4 profiles without rewriting storage', () => {
    const db = generateSeedData();
    storage.seed(DB_KEY, JSON.stringify(db));
    storage.seed(STORAGE_KEYS.VERSION, CURRENT_STORAGE_VERSION);
    const loaded = loadDB();
    expect(loaded).toMatchObject({ ok: true, mode: 'persisted', migrated: false });
    if (!loaded.ok) return;
    expect(loaded.db.devices.map((device) => device.technicalProfile)).toEqual(db.devices.map((device) => device.technicalProfile));
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('preserves malformed v4 profile source bytes in recovery', () => {
    const db = generateSeedData();
    (db.devices[0] as unknown as Record<string, unknown>).technicalProfile = { kind: 'desktop_pc', ramGB: -1 };
    const raw = JSON.stringify(db);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, CURRENT_STORAGE_VERSION);
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('preserves canonical v4 source bytes when a profile contains a foreign field', () => {
    const db = generateSeedData();
    db.devices[0].deviceType = 'network_switch';
    (db.devices[0] as unknown as Record<string, unknown>).technicalProfile = {
      kind: 'network_switch', processor: 'must not survive silently',
    };
    const raw = JSON.stringify(db);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, CURRENT_STORAGE_VERSION);
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('fails closed and atomically for an unexpected non-desktop v3 Device', () => {
    const legacy = versionThreeDatabase();
    legacy.devices[1].deviceType = 'router';
    const before = JSON.stringify(legacy);
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({
      code: 'managed-device-profile-migration-failed', validationIssueCode: 'unsupported-v3-device-profile-migration', deviceId: legacy.devices[1].id,
    })] });
    expect(JSON.stringify(legacy)).toBe(before);
    expect('db' in result).toBe(false);
  });

  it('keeps unexpected non-desktop v3 raw storage protected', () => {
    const legacy = versionThreeDatabase();
    legacy.devices[0].deviceType = 'network_switch';
    const raw = JSON.stringify(legacy);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, '3.0.0');
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('fails closed and atomically when a v3 Device already owns technicalProfile', () => {
    const legacy = versionThreeDatabase();
    (legacy.devices[0] as unknown as Record<string, unknown>).technicalProfile = { kind: 'desktop_pc' };
    const before = JSON.stringify(legacy);
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({
      code: 'managed-device-profile-migration-failed',
      validationIssueCode: 'unexpected-v3-technical-profile',
      deviceId: legacy.devices[0].id,
    })] });
    expect(JSON.stringify(legacy)).toBe(before);
    expect('db' in result).toBe(false);
  });

  it('keeps v3 storage with an unexpected technicalProfile byte-for-byte protected', () => {
    const legacy = versionThreeDatabase();
    (legacy.devices[0] as unknown as Record<string, unknown>).technicalProfile = { kind: 'desktop_pc' };
    const raw = JSON.stringify(legacy);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, '3.0.0');
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });

  it('migrates v2 through identity and profile directly to canonical v4', () => {
    const legacy = versionTwoDatabase();
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT, generateQrPublicId: qrFactory() });
    expect(result).toMatchObject({ ok: true, changed: true, migratedFromVersion: 2 });
    if (!result.ok) return;
    expect(result.db.schemaVersion).toBe(CURRENT_DB_SCHEMA_VERSION);
    result.db.devices.forEach((device, index) => {
      expect(device).toMatchObject({ id: legacy.devices[index].id, deviceType: 'desktop_pc', lifecycleStatus: 'in_service', technicalProfile: {
        kind: 'desktop_pc', processor: legacy.devices[index].processor, peripherals: legacy.devices[index].peripherals,
      } });
      expect(device.qrPublicId).toMatch(/^qr_[A-Za-z0-9_-]{16,}$/);
    });
    expect(result.db.layouts).toEqual(legacy.layouts);
  });

  it('migrates v1 layout, identity, and profile in one canonical result', () => {
    const result = normalizeDatabase(versionOneDatabase(), { migratedAt: MIGRATED_AT, generateQrPublicId: qrFactory() });
    expect(result).toMatchObject({ ok: true, changed: true, migratedFromVersion: 1 });
    if (!result.ok) return;
    expect(result.db.schemaVersion).toBe(4);
    expect(result.db.layouts.length).toBeGreaterThan(0);
    expect(result.db.devices.every((device) => device.technicalProfile.kind === 'desktop_pc')).toBe(true);
    expect(result.db.devices.every((device) => !Object.prototype.hasOwnProperty.call(device, 'row') && !Object.prototype.hasOwnProperty.call(device, 'col'))).toBe(true);
  });

  it('fails v2 QR migration atomically without returning a partial profile database', () => {
    const legacy = versionTwoDatabase();
    const before = JSON.stringify(legacy);
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT, generateQrPublicId: () => 'qr_samepublicidentifier000000000000' });
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'managed-device-migration-failed', validationIssueCode: 'qr-generation-failed' })] });
    expect(JSON.stringify(legacy)).toBe(before);
    expect('db' in result).toBe(false);
  });

  it('preserves malformed v2 source bytes and enters recovery', () => {
    const malformed = versionTwoDatabase() as unknown as Record<string, unknown>;
    delete malformed.devices;
    const raw = JSON.stringify(malformed);
    storage.seed(DB_KEY, raw);
    storage.seed(STORAGE_KEYS.VERSION, '2.0.0');
    expect(loadDB()).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem(DB_KEY)).toBe(raw);
    expect(storage.writesFor(DB_KEY)).toBe(0);
  });
});
