import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData, type SeedData } from '@/data/seed';
import { getAssetDeviceLink, validateAssetMutation, validateManagedDeviceInventory } from '@/domain/managed-device';
import { loadDB } from '@/lib/db';
import { CURRENT_STORAGE_VERSION } from '@/lib/dbSchema';
import { STORAGE_KEYS } from '@/lib/storage';
import { assetRepository } from '@/services/repositories';

const DB_KEY = 'smartlab_pplg_db';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  private writes = 0;

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); this.writes += 1; }
  seed(key: string, value: string): void { this.values.set(key, value); }
  resetWrites(): void { this.writes = 0; }
  writeCount(): number { return this.writes; }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedDatabase(db: SeedData): void {
  storage.seed(DB_KEY, JSON.stringify(db));
  storage.seed(STORAGE_KEYS.VERSION, CURRENT_STORAGE_VERSION);
  storage.resetWrites();
}

function linkedFixture(): { db: SeedData; assetId: string; deviceId: string } {
  const db = generateSeedData();
  const device = db.devices.find((candidate) => candidate.assetId)!;
  return { db, assetId: device.assetId!, deviceId: device.id };
}

function unlinkedFixture(): { db: SeedData; assetId: string; deviceId: string } {
  const fixture = linkedFixture();
  fixture.db.devices.find((device) => device.id === fixture.deviceId)!.assetId = undefined;
  return fixture;
}

function persistedDatabase(): SeedData {
  const loaded = loadDB();
  if (!loaded.ok) throw new Error('expected persisted database');
  return loaded.db;
}

function expectCanonical(db: SeedData): void {
  expect(validateManagedDeviceInventory(db)).toEqual({ valid: true, issues: [] });
}

describe('linked Asset mutation integrity', () => {
  it('classifies linked, unlinked, and invalid relationships centrally', () => {
    const linked = linkedFixture();
    expect(getAssetDeviceLink(linked.db, linked.assetId)).toMatchObject({ status: 'linked', device: { id: linked.deviceId } });

    const unlinked = unlinkedFixture();
    expect(getAssetDeviceLink(unlinked.db, unlinked.assetId)).toMatchObject({ status: 'unlinked', asset: { id: unlinked.assetId } });

    const invalid = linkedFixture();
    invalid.db.devices[1].assetId = invalid.assetId;
    expect(getAssetDeviceLink(invalid.db, invalid.assetId)).toMatchObject({ status: 'invalid' });
    expect(validateAssetMutation(invalid.db, { operation: 'delete', assetId: invalid.assetId })).toMatchObject({ ok: false, reason: 'asset_link_invalid' });
  });

  it('allows a safe linked Asset edit and preserves the canonical Device relationship', async () => {
    const fixture = linkedFixture();
    seedDatabase(fixture.db);
    const sourceAsset = fixture.db.assets.find((asset) => asset.id === fixture.assetId)!;
    const sourceDevice = fixture.db.devices.find((device) => device.id === fixture.deviceId)!;

    const updated = await assetRepository.update(fixture.assetId, { price: sourceAsset.price + 500_000, condition: 'Rusak Ringan' });
    expect(updated).toMatchObject({ id: fixture.assetId, price: sourceAsset.price + 500_000, condition: 'Rusak Ringan' });
    const persisted = persistedDatabase();
    expect(persisted.devices.find((device) => device.id === fixture.deviceId)).toEqual(sourceDevice);
    expect(getAssetDeviceLink(persisted, fixture.assetId)).toMatchObject({ status: 'linked', device: { id: fixture.deviceId } });
    expectCanonical(persisted);
  });

  it('rejects a linked Asset code change with no mutation, audit, or persistence write', async () => {
    const fixture = linkedFixture();
    seedDatabase(fixture.db);
    await expect(assetRepository.update(fixture.assetId, { assetCode: 'CHANGED' })).rejects.toThrow('Kode aset tertaut tidak dapat diubah');
    expect(persistedDatabase()).toEqual(fixture.db);
    expect(storage.writeCount()).toBe(0);
  });

  it('rejects a linked Asset laboratory change without a partial mutation', async () => {
    const fixture = linkedFixture();
    seedDatabase(fixture.db);
    const targetLab = fixture.db.labs.find((laboratory) => laboratory.id !== fixture.db.assets.find((asset) => asset.id === fixture.assetId)!.laboratoryId)!;
    await expect(assetRepository.update(fixture.assetId, { laboratoryId: targetLab.id })).rejects.toThrow('Laboratorium aset tertaut tidak dapat diubah');
    expect(persistedDatabase()).toEqual(fixture.db);
    expect(storage.writeCount()).toBe(0);
  });

  it('rejects linked Asset deletion and preserves the Asset, Device link, and audit log', async () => {
    const fixture = linkedFixture();
    seedDatabase(fixture.db);
    await expect(assetRepository.remove(fixture.assetId)).rejects.toThrow('Aset tertaut ke perangkat terkelola');
    const persisted = persistedDatabase();
    expect(persisted.assets.some((asset) => asset.id === fixture.assetId)).toBe(true);
    expect(persisted.devices.find((device) => device.id === fixture.deviceId)?.assetId).toBe(fixture.assetId);
    expect(persisted.auditLogs).toEqual(fixture.db.auditLogs);
    expect(storage.writeCount()).toBe(0);
  });

  it('rejects linked Asset transfer with no Asset or Device movement and no audit', async () => {
    const fixture = linkedFixture();
    seedDatabase(fixture.db);
    const asset = fixture.db.assets.find((candidate) => candidate.id === fixture.assetId)!;
    const device = fixture.db.devices.find((candidate) => candidate.id === fixture.deviceId)!;
    const targetLab = fixture.db.labs.find((laboratory) => laboratory.id !== asset.laboratoryId)!;
    await expect(assetRepository.transfer(fixture.assetId, { toLabId: targetLab.id, toPosition: 'B-01', reason: 'UAT', by: 'Admin' })).rejects.toThrow('Gunakan alur transfer perangkat terkontrol');
    const persisted = persistedDatabase();
    expect(persisted.assets.find((candidate) => candidate.id === fixture.assetId)?.laboratoryId).toBe(asset.laboratoryId);
    expect(persisted.devices.find((candidate) => candidate.id === fixture.deviceId)?.laboratoryId).toBe(device.laboratoryId);
    expect(persisted.auditLogs).toEqual(fixture.db.auditLogs);
    expect(storage.writeCount()).toBe(0);
  });

  it('preserves existing unlinked Asset edit behavior', async () => {
    const fixture = unlinkedFixture();
    seedDatabase(fixture.db);
    const updated = await assetRepository.update(fixture.assetId, { assetCode: 'UNLINKED-UPDATED', price: 123_456 });
    expect(updated).toMatchObject({ assetCode: 'UNLINKED-UPDATED', price: 123_456 });
    expectCanonical(persistedDatabase());
  });

  it('preserves existing unlinked Asset deletion behavior', async () => {
    const fixture = unlinkedFixture();
    seedDatabase(fixture.db);
    await expect(assetRepository.remove(fixture.assetId)).resolves.toBeUndefined();
    const persisted = persistedDatabase();
    expect(persisted.assets.some((asset) => asset.id === fixture.assetId)).toBe(false);
    expectCanonical(persisted);
  });

  it('preserves existing unlinked Asset transfer behavior', async () => {
    const fixture = unlinkedFixture();
    seedDatabase(fixture.db);
    const asset = fixture.db.assets.find((candidate) => candidate.id === fixture.assetId)!;
    const targetLab = fixture.db.labs.find((laboratory) => laboratory.id !== asset.laboratoryId)!;
    const transferred = await assetRepository.transfer(fixture.assetId, { toLabId: targetLab.id, toPosition: 'B-02', reason: 'UAT', by: 'Admin' });
    expect(transferred).toMatchObject({ laboratoryId: targetLab.id, position: 'B-02' });
    const persisted = persistedDatabase();
    expect(persisted.auditLogs[0]).toMatchObject({ action: 'transfer', object: fixture.assetId });
    expectCanonical(persisted);
  });
});
