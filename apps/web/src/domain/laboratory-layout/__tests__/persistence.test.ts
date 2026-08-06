import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { loadDB } from '@/lib/db';
import { normalizeDatabase } from '@/lib/dbMigrations';
import { STORAGE_KEYS } from '@/lib/storage';
import {
  cloneLaboratoryLayout,
  createInitialLaboratoryDevices,
  createLaboratoryWithInitialLayout,
  deleteLaboratorySafely,
  getActiveLaboratoryLayout,
  layoutsEquivalent,
  moveLayoutElement,
  saveActiveLaboratoryLayout,
  validatePersistedLaboratoryLayouts,
} from '../index';

const MIGRATED_AT = '2026-08-06T00:00:00.000Z';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  readonly writeCounts = new Map<string, number>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writeCounts.set(key, (this.writeCounts.get(key) ?? 0) + 1);
  }
  writesFor(key: string): number { return this.writeCounts.get(key) ?? 0; }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function legacyDatabase() {
  const current = generateSeedData();
  const layoutByDevice = new Map(current.layouts.flatMap((layout) => layout.elements
    .filter((element) => element.referenceId)
    .map((element) => [element.referenceId!, element])));
  const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  delete legacy.schemaVersion;
  delete legacy.layouts;
  legacy.devices = current.devices.map((device) => {
    const element = layoutByDevice.get(device.id)!;
    return { ...device, row: element.row, col: element.column };
  });
  return legacy;
}

describe('layout persistence integration', () => {
  it('creates deterministic version-2 seed layouts without Device coordinates', () => {
    const first = generateSeedData();
    const second = generateSeedData();
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(2);
    expect(first.layouts).toHaveLength(first.labs.length);
    expect(first.devices.every((device) => !Object.prototype.hasOwnProperty.call(device, 'row') && !Object.prototype.hasOwnProperty.call(device, 'col'))).toBe(true);
    expect(validatePersistedLaboratoryLayouts(first).valid).toBe(true);
  });

  it('migrates a legacy database atomically and preserves every device placement', () => {
    const legacy = legacyDatabase();
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    expect(result).toMatchObject({ ok: true, changed: true, migratedFromVersion: 1 });
    if (!result.ok) return;
    expect(result.db.layouts).toHaveLength(result.db.labs.length);
    expect(result.db.devices.every((device) => !Object.prototype.hasOwnProperty.call(device, 'row') && !Object.prototype.hasOwnProperty.call(device, 'col'))).toBe(true);
    const original = legacy.devices as Array<{ id: string; row: number; col: number }>;
    original.forEach((device) => {
      const element = result.db.layouts.flatMap((layout) => layout.elements).find((candidate) => candidate.referenceId === device.id);
      expect(element).toMatchObject({ row: device.row, column: device.col });
    });
  });

  it('is idempotent for a valid version-2 database and preserves timestamps', () => {
    const first = normalizeDatabase(legacyDatabase(), { migratedAt: MIGRATED_AT });
    if (!first.ok) throw new Error('expected migration success');
    const second = normalizeDatabase(first.db, { migratedAt: '2030-01-01T00:00:00.000Z' });
    expect(second).toMatchObject({ ok: true, changed: false, migratedFromVersion: null });
    if (second.ok) expect(second.db.layouts.map((layout) => layout.updatedAt)).toEqual(first.db.layouts.map((layout) => layout.updatedAt));
  });

  it('creates an all-empty active layout for a legacy laboratory with zero devices', () => {
    const legacy = legacyDatabase();
    const labId = (legacy.labs as Array<{ id: string }>)[0].id;
    legacy.devices = (legacy.devices as Array<{ laboratoryId: string }>).filter((device) => device.laboratoryId !== labId);
    const result = normalizeDatabase(legacy, { migratedAt: MIGRATED_AT });
    if (!result.ok) throw new Error('expected migration success');
    const layout = result.db.layouts.find((candidate) => candidate.laboratoryId === labId)!;
    expect(layout.elements.every((element) => element.type === 'empty')).toBe(true);
  });

  it('rejects duplicate legacy coordinates without returning a partial database', () => {
    const legacy = legacyDatabase();
    const devices = legacy.devices as Array<{ row: number; col: number }>;
    devices[1].row = devices[0].row;
    devices[1].col = devices[0].col;
    expect(normalizeDatabase(legacy, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'legacy-layout-migration-failed' })] });
  });

  it('rejects out-of-bounds or incomplete legacy coordinates without a partial database', () => {
    const outOfBounds = legacyDatabase();
    (outOfBounds.devices as Array<{ row: number }>)[0].row = 99;
    expect(normalizeDatabase(outOfBounds, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ validationIssueCode: 'invalid-device-coordinate' })] });

    const missingCoordinate = legacyDatabase();
    delete (missingCoordinate.devices as Array<Record<string, unknown>>)[0].row;
    expect(normalizeDatabase(missingCoordinate, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'legacy-layout-migration-failed' })] });

    const invalidDimensions = legacyDatabase();
    (invalidDimensions.labs as Array<{ layoutRows: number }>)[0].layoutRows = 0;
    expect(normalizeDatabase(invalidDimensions, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false });
  });

  it('rejects a version-2 database containing stale Device coordinates', () => {
    const invalid = generateSeedData() as unknown as { devices: Array<Record<string, unknown>> };
    invalid.devices[0].row = 1;
    expect(normalizeDatabase(invalid, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ validationIssueCode: 'legacy-device-coordinate' })] });
  });

  it('returns structured integrity issues for orphan, missing, cross-laboratory, duplicate, and absent device references', () => {
    const orphan = generateSeedData();
    orphan.layouts[0].laboratoryId = 'missing-lab';
    expect(validatePersistedLaboratoryLayouts(orphan).issues.map((issue) => issue.code)).toContain('orphan-layout');

    const missing = generateSeedData();
    missing.layouts[0].elements.find((element) => element.type === 'student_pc')!.referenceId = 'missing-device';
    expect(validatePersistedLaboratoryLayouts(missing).issues.map((issue) => issue.code)).toContain('missing-device-reference');

    const crossLaboratory = generateSeedData();
    crossLaboratory.layouts[0].elements.find((element) => element.type === 'student_pc')!.referenceId = crossLaboratory.devices.find((device) => device.laboratoryId === 'lab-rpl-2')!.id;
    expect(validatePersistedLaboratoryLayouts(crossLaboratory).issues.map((issue) => issue.code)).toContain('cross-laboratory-device-reference');

    const duplicated = generateSeedData();
    const firstReference = duplicated.layouts[0].elements.find((element) => element.type === 'student_pc')!.referenceId!;
    duplicated.layouts[0].elements.filter((element) => element.type === 'student_pc')[1].referenceId = firstReference;
    expect(validatePersistedLaboratoryLayouts(duplicated).issues.map((issue) => issue.code)).toContain('duplicate-device-reference');

    const absent = generateSeedData();
    const absentElement = absent.layouts[0].elements.find((element) => element.type === 'student_pc')!;
    absentElement.type = 'empty';
    delete absentElement.referenceId;
    expect(validatePersistedLaboratoryLayouts(absent).issues.map((issue) => issue.code)).toContain('device-missing-from-active-layout');
  });

  it('reports missing and duplicate active layouts through structured integrity issues', () => {
    const missing = generateSeedData();
    missing.layouts = missing.layouts.slice(1);
    expect(validatePersistedLaboratoryLayouts(missing).issues.map((issue) => issue.code)).toContain('missing-active-layout');
    const duplicate = generateSeedData();
    duplicate.layouts.push(cloneLaboratoryLayout(duplicate.layouts[0]));
    expect(validatePersistedLaboratoryLayouts(duplicate).issues.map((issue) => issue.code)).toContain('multiple-active-layouts');
    const statusMismatch = generateSeedData();
    statusMismatch.layouts[0].status = 'draft';
    expect(validatePersistedLaboratoryLayouts(statusMismatch).issues.map((issue) => issue.code)).toContain('active-layout-status-mismatch');
  });

  it('saves a changed draft atomically with one audit entry and leaves the source untouched', () => {
    const db = generateSeedData();
    const active = getActiveLaboratoryLayout(db, db.labs[0].id);
    if (!active.ok) throw new Error('expected active layout');
    const source = active.layout.elements.find((element) => element.type === 'student_pc')!;
    const target = active.layout.elements.find((element) => element.type === 'student_pc' && element.id !== source.id)!;
    const moved = moveLayoutElement(active.layout, source.id, { row: target.row, column: target.column }, { updatedAt: MIGRATED_AT });
    if (!moved.ok) throw new Error('expected move');
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: db.labs[0].id, draft: moved.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-layout-save' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(db.auditLogs).toHaveLength(3);
    expect(saved.db.auditLogs).toHaveLength(4);
    expect(saved.db.auditLogs[0]).toMatchObject({ action: 'layout.save' });
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
  });

  it('treats an equivalent draft as a no-op regardless of element ordering or updatedAt', () => {
    const db = generateSeedData();
    const active = getActiveLaboratoryLayout(db, db.labs[0].id);
    if (!active.ok) throw new Error('expected active layout');
    const draft = cloneLaboratoryLayout(active.layout);
    draft.elements.reverse();
    draft.updatedAt = MIGRATED_AT;
    expect(layoutsEquivalent(active.layout, draft)).toBe(true);
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: db.labs[0].id, draft, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'unused' });
    expect(saved).toMatchObject({ ok: true, changed: false });
    if (saved.ok) expect(saved.db).toBe(db);
  });

  it('clones layouts deeply and treats only meaningful coordinate changes as dirty', () => {
    const original = generateSeedData().layouts[0];
    const clone = cloneLaboratoryLayout(original);
    clone.elements[0].row = 2;
    expect(original.elements[0].row).not.toBe(2);
    expect(layoutsEquivalent(original, { ...original, updatedAt: MIGRATED_AT })).toBe(true);
    expect(layoutsEquivalent(original, clone)).toBe(false);
  });

  it('rejects invalid saves without modifying the source database or creating audit data', () => {
    const db = generateSeedData();
    const active = getActiveLaboratoryLayout(db, db.labs[0].id);
    if (!active.ok) throw new Error('expected active layout');
    const invalid = cloneLaboratoryLayout(active.layout);
    invalid.laboratoryId = 'lab-rpl-2';
    const result = saveActiveLaboratoryLayout({ db, laboratoryId: 'lab-rpl-1', draft: invalid, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-invalid' });
    expect(result.ok).toBe(false);
    expect(db.auditLogs).toHaveLength(3);
    expect(db.layouts[0].laboratoryId).toBe('lab-rpl-1');
  });

  it('creates a laboratory, devices, and a complete initial layout without coordinates', () => {
    const db = generateSeedData();
    const laboratory = { ...db.labs[0], id: 'lab-new', code: 'NEW', name: 'Lab Baru', pcCount: 2, layoutRows: 2, layoutCols: 2 };
    const result = createLaboratoryWithInitialLayout({ db, laboratory, devices: createInitialLaboratoryDevices(laboratory, MIGRATED_AT), createdAt: MIGRATED_AT, layoutId: 'layout:lab-new:v1' });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.db.devices.filter((device) => device.laboratoryId === laboratory.id)).toHaveLength(2);
    expect(result.layout?.elements.filter((element) => element.type === 'empty')).toHaveLength(2);
    expect(validatePersistedLaboratoryLayouts(result.db).valid).toBe(true);
  });

  it('rejects over-capacity creation without changing the source database', () => {
    const db = generateSeedData();
    const laboratory = { ...db.labs[0], id: 'lab-too-many', code: 'FULL', name: 'Lab Penuh', pcCount: 5, layoutRows: 2, layoutCols: 2 };
    const result = createLaboratoryWithInitialLayout({ db, laboratory, devices: [], createdAt: MIGRATED_AT, layoutId: 'layout:lab-too-many:v1' });
    expect(result.ok).toBe(false);
    expect(db.labs.some((item) => item.id === laboratory.id)).toBe(false);
  });

  it('rejects invalid structural creation and duplicate generated device IDs atomically', () => {
    const db = generateSeedData();
    const invalidRows = { ...db.labs[0], id: 'lab-invalid-rows', code: 'ROWS', name: 'Baris Salah', pcCount: 0, layoutRows: 0, layoutCols: 2 };
    expect(createLaboratoryWithInitialLayout({ db, laboratory: invalidRows, devices: [], createdAt: MIGRATED_AT, layoutId: 'layout:invalid:v1' }).ok).toBe(false);
    const duplicates = { ...db.labs[0], id: 'lab-duplicates', code: 'DUP', name: 'Duplikat', pcCount: 2, layoutRows: 2, layoutCols: 2 };
    const devices = createInitialLaboratoryDevices(duplicates, MIGRATED_AT);
    devices[1].id = devices[0].id;
    expect(createLaboratoryWithInitialLayout({ db, laboratory: duplicates, devices, createdAt: MIGRATED_AT, layoutId: 'layout:duplicates:v1' }).ok).toBe(false);
    expect(db.labs).toHaveLength(3);
  });

  it('blocks deletion with dependencies and removes only an unreferenced laboratory layout', () => {
    const blocked = deleteLaboratorySafely({ db: generateSeedData(), laboratoryId: 'lab-rpl-1', deletedAt: MIGRATED_AT });
    expect(blocked.ok).toBe(false);
    const db = generateSeedData();
    const laboratory = { ...db.labs[0], id: 'lab-empty', code: 'EMPTY', name: 'Lab Kosong', pcCount: 0, layoutRows: 2, layoutCols: 2 };
    const created = createLaboratoryWithInitialLayout({ db, laboratory, devices: [], createdAt: MIGRATED_AT, layoutId: 'layout:lab-empty:v1' });
    if (!created.ok) throw new Error('expected creation success');
    const removed = deleteLaboratorySafely({ db: created.db, laboratoryId: laboratory.id, deletedAt: MIGRATED_AT });
    expect(removed).toMatchObject({ ok: true });
    if (removed.ok) {
      expect(removed.db.labs.some((item) => item.id === laboratory.id)).toBe(false);
      expect(removed.db.layouts.some((layout) => layout.laboratoryId === laboratory.id)).toBe(false);
    }
  });

  it('keeps blocked deletion immutable and preserves unrelated laboratories after a safe deletion', () => {
    const blockedDb = generateSeedData();
    const blocked = deleteLaboratorySafely({ db: blockedDb, laboratoryId: 'lab-rpl-1', deletedAt: MIGRATED_AT });
    expect(blocked.ok).toBe(false);
    expect(blockedDb.layouts).toHaveLength(3);

    const db = generateSeedData();
    const laboratory = { ...db.labs[0], id: 'lab-empty-2', code: 'EMPTY2', name: 'Lab Kosong 2', pcCount: 0, layoutRows: 2, layoutCols: 2 };
    const created = createLaboratoryWithInitialLayout({ db, laboratory, devices: [], createdAt: MIGRATED_AT, layoutId: 'layout:lab-empty-2:v1' });
    if (!created.ok) throw new Error('expected creation success');
    created.db.schedules.push({ ...created.db.schedules[0], id: 'schedule-empty-2', laboratoryId: laboratory.id });
    const scheduleBlocked = deleteLaboratorySafely({ db: created.db, laboratoryId: laboratory.id, deletedAt: MIGRATED_AT });
    expect(scheduleBlocked.ok).toBe(false);
    expect(created.db.labs.some((item) => item.id === 'lab-rpl-2')).toBe(true);
  });

  it('writes a successful legacy migration once and preserves an invalid legacy raw database', () => {
    const legacy = legacyDatabase();
    storage.setItem('smartlab_pplg_db', JSON.stringify(legacy));
    storage.writeCounts.clear();
    const loaded = loadDB();
    expect(loaded.db.schemaVersion).toBe(2);
    expect(storage.writesFor('smartlab_pplg_db')).toBe(1);
    expect(storage.getItem(STORAGE_KEYS.VERSION)).toBe('2.0.0');
    expect(JSON.parse(storage.getItem('smartlab_pplg_db')!).devices.every((device: Record<string, unknown>) => !Object.prototype.hasOwnProperty.call(device, 'row') && !Object.prototype.hasOwnProperty.call(device, 'col'))).toBe(true);

    const invalid = legacyDatabase();
    const invalidDevices = invalid.devices as Array<{ row: number; col: number }>;
    invalidDevices[1].row = invalidDevices[0].row;
    invalidDevices[1].col = invalidDevices[0].col;
    const raw = JSON.stringify(invalid);
    storage.clear();
    storage.writeCounts.clear();
    storage.setItem('smartlab_pplg_db', raw);
    storage.writeCounts.clear();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fallback = loadDB();
    error.mockRestore();
    expect(fallback.db.schemaVersion).toBe(2);
    expect(storage.getItem('smartlab_pplg_db')).toBe(raw);
    expect(storage.writesFor('smartlab_pplg_db')).toBe(0);
  });

  it('does not rewrite a valid version-2 database or alter layout timestamps when loaded repeatedly', () => {
    const db = generateSeedData();
    storage.setItem('smartlab_pplg_db', JSON.stringify(db));
    storage.setItem(STORAGE_KEYS.VERSION, '2.0.0');
    storage.writeCounts.clear();
    const first = loadDB();
    const second = loadDB();
    expect(first.db.layouts.map((layout) => layout.updatedAt)).toEqual(second.db.layouts.map((layout) => layout.updatedAt));
    expect(storage.writesFor('smartlab_pplg_db')).toBe(0);
    expect(storage.writesFor(STORAGE_KEYS.VERSION)).toBe(0);
  });

  it('returns recovery mode without overwriting invalid raw data', () => {
    const legacy = legacyDatabase();
    const devices = legacy.devices as Array<{ row: number; col: number }>;
    devices[1].row = devices[0].row;
    devices[1].col = devices[0].col;
    const raw = JSON.stringify(legacy);
    storage.setItem('smartlab_pplg_db', raw);
    storage.writeCounts.clear();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loaded = loadDB();
    error.mockRestore();
    expect(loaded).toMatchObject({ ok: false, mode: 'recovery', rawPreserved: true });
    expect(storage.getItem('smartlab_pplg_db')).toBe(raw);
    expect(storage.writesFor('smartlab_pplg_db')).toBe(0);
  });

  it('rejects missing required collections and strips unknown top-level values', () => {
    const missing = generateSeedData() as unknown as Record<string, unknown>;
    delete missing.auditLogs;
    expect(normalizeDatabase(missing, { migratedAt: MIGRATED_AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'missing-collection', path: 'auditLogs' })] });
    const unknown = { ...generateSeedData(), unexpected: 'discarded' };
    const normalized = normalizeDatabase(unknown, { migratedAt: MIGRATED_AT });
    if (!normalized.ok) throw new Error('expected canonical success');
    expect(normalized.db).not.toHaveProperty('unexpected');
  });
});
