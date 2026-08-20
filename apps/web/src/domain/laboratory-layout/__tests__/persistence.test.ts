import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { loadDB } from '@/lib/db';
import { normalizeDatabase } from '@/lib/dbMigrations';
import { STORAGE_KEYS, readStorageJSON } from '@/lib/storage';
import {
  cloneLaboratoryLayout,
  convertLayoutToCustom,
  createInitialLaboratoryDevices,
  createLaboratoryWithInitialLayout,
  deleteLaboratorySafely,
  getActiveLaboratoryLayout,
  layoutsEquivalent,
  moveLayoutElement,
  placeLayoutElement,
  removeLayoutElement,
  resizeCustomLayout,
  saveActiveLaboratoryLayout,
  updateLayoutElementGeometry,
  updateLayoutElementProperties,
  validateLaboratoryLayout,
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

function createPropertySaveFixture() {
  const seed = generateSeedData();
  const laboratory = { ...seed.labs[0], id: 'lab-properties', code: 'PROPERTIES', name: 'Lab Properties', pcCount: 1, layoutRows: 2, layoutCols: 3 };
  const created = createLaboratoryWithInitialLayout({
    db: seed,
    laboratory,
    devices: createInitialLaboratoryDevices(laboratory, MIGRATED_AT),
    createdAt: MIGRATED_AT,
    layoutId: 'layout:lab-properties:v1',
  });
  if (!created.ok) throw new Error('expected laboratory creation');
  const active = getActiveLaboratoryLayout(created.db, laboratory.id);
  if (!active.ok) throw new Error('expected active layout');
  const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
  if (!converted.ok) throw new Error('expected Custom conversion');
  const printerTarget = converted.layout.elements.find((element) => element.type === 'empty')!;
  const printer = placeLayoutElement({
    layout: converted.layout,
    type: 'printer',
    target: { row: printerTarget.row, column: printerTarget.column },
    elementId: 'property-printer',
    updatedAt: MIGRATED_AT,
  });
  if (!printer.ok) throw new Error('expected printer placement');
  const doorTarget = printer.layout.elements.find((element) => element.type === 'empty')!;
  const door = placeLayoutElement({
    layout: printer.layout,
    type: 'door',
    target: { row: doorTarget.row, column: doorTarget.column },
    elementId: 'property-door',
    updatedAt: MIGRATED_AT,
    label: 'Pintu',
  });
  if (!door.ok) throw new Error('expected door placement');
  const saved = saveActiveLaboratoryLayout({
    db: created.db,
    laboratoryId: laboratory.id,
    draft: door.layout,
    actor: { name: 'Admin', role: 'Admin Lab' },
    savedAt: MIGRATED_AT,
    auditId: 'audit-property-fixture',
  });
  if (!saved.ok) throw new Error('expected property fixture save');
  return { db: saved.db, laboratory, layout: saved.layout };
}

function createGeometrySaveFixture() {
  const seed = generateSeedData();
  const laboratory = { ...seed.labs[0], id: 'lab-geometry', code: 'GEOMETRY', name: 'Lab Geometry', pcCount: 1, layoutRows: 3, layoutCols: 4 };
  const created = createLaboratoryWithInitialLayout({
    db: seed,
    laboratory,
    devices: createInitialLaboratoryDevices(laboratory, MIGRATED_AT),
    createdAt: MIGRATED_AT,
    layoutId: 'layout:lab-geometry:v1',
  });
  if (!created.ok) throw new Error('expected laboratory creation');
  const active = getActiveLaboratoryLayout(created.db, laboratory.id);
  if (!active.ok) throw new Error('expected active layout');
  const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
  if (!converted.ok) throw new Error('expected Custom conversion');
  const target = converted.layout.elements.find((element) => element.type === 'empty')!;
  const door = placeLayoutElement({
    layout: converted.layout,
    type: 'door',
    target: { row: target.row, column: target.column },
    elementId: 'geometry-door',
    updatedAt: MIGRATED_AT,
    label: 'Pintu Geometri',
  });
  if (!door.ok) throw new Error('expected door placement');
  const saved = saveActiveLaboratoryLayout({
    db: created.db,
    laboratoryId: laboratory.id,
    draft: door.layout,
    actor: { name: 'Admin', role: 'Admin Lab' },
    savedAt: MIGRATED_AT,
    auditId: 'audit-geometry-fixture',
  });
  if (!saved.ok) throw new Error('expected geometry fixture save');
  return { db: saved.db, laboratory, layout: saved.layout };
}

describe('layout persistence integration', () => {
  it('creates deterministic version-3 seed layouts without Device coordinates', () => {
    const first = generateSeedData();
    const second = generateSeedData();
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(3);
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

  it('is idempotent for a valid version-3 database and preserves timestamps', () => {
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

  it('rejects a version-3 database containing stale Device coordinates', () => {
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
    expect(saved.db.auditLogs[0].newValue).toContain('repositioned=2; added=0; removed=0');
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
  });

  it('persists placed and removed palette elements with one audit per save and exact device coverage', () => {
    const seed = generateSeedData();
    const laboratory = { ...seed.labs[0], id: 'lab-palette', code: 'PALETTE', name: 'Lab Palette', pcCount: 1, layoutRows: 2, layoutCols: 2 };
    const created = createLaboratoryWithInitialLayout({ db: seed, laboratory, devices: createInitialLaboratoryDevices(laboratory, MIGRATED_AT), createdAt: MIGRATED_AT, layoutId: 'layout:lab-palette:v1' });
    if (!created.ok) throw new Error('expected laboratory creation');
    const db = created.db;
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const target = active.layout.elements.find((element) => element.type === 'empty')!;
    const placed = placeLayoutElement({ layout: active.layout, type: 'printer', target: { row: target.row, column: target.column }, elementId: 'palette-printer', updatedAt: MIGRATED_AT });
    if (!placed.ok) throw new Error('expected placement');
    const savedPlaced = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: placed.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-palette-place' });
    expect(savedPlaced).toMatchObject({ ok: true, changed: true });
    if (!savedPlaced.ok) return;
    expect(savedPlaced.db.auditLogs).toHaveLength(db.auditLogs.length + 1);
    expect(savedPlaced.db.auditLogs[0].newValue).toContain('repositioned=0; added=1; removed=0');
    expect(validatePersistedLaboratoryLayouts(savedPlaced.db).valid).toBe(true);

    const savedActive = getActiveLaboratoryLayout(savedPlaced.db, laboratory.id);
    if (!savedActive.ok) throw new Error('expected saved active layout');
    const removed = removeLayoutElement({ layout: savedActive.layout, elementId: 'palette-printer', emptyElementId: 'empty-after-printer', updatedAt: MIGRATED_AT });
    if (!removed.ok) throw new Error('expected removal');
    const savedRemoved = saveActiveLaboratoryLayout({ db: savedPlaced.db, laboratoryId: laboratory.id, draft: removed.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-palette-remove' });
    expect(savedRemoved).toMatchObject({ ok: true, changed: true });
    if (!savedRemoved.ok) return;
    expect(savedRemoved.db.auditLogs[0].newValue).toContain('repositioned=0; added=0; removed=1');
    expect(validatePersistedLaboratoryLayouts(savedRemoved.db).valid).toBe(true);
  });

  it('audits a moved palette element without counting its swapped empty cell', () => {
    const seed = generateSeedData();
    const laboratory = { ...seed.labs[0], id: 'lab-palette-move', code: 'PMOVE', name: 'Lab Palette Move', pcCount: 1, layoutRows: 2, layoutCols: 2 };
    const created = createLaboratoryWithInitialLayout({ db: seed, laboratory, devices: createInitialLaboratoryDevices(laboratory, MIGRATED_AT), createdAt: MIGRATED_AT, layoutId: 'layout:lab-palette-move:v1' });
    if (!created.ok) throw new Error('expected laboratory creation');
    const db = created.db;
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const firstEmpty = active.layout.elements.find((element) => element.type === 'empty')!;
    const placed = placeLayoutElement({ layout: active.layout, type: 'network_switch', target: { row: firstEmpty.row, column: firstEmpty.column }, elementId: 'palette-switch', updatedAt: MIGRATED_AT });
    if (!placed.ok) throw new Error('expected placement');
    const savedPlaced = saveActiveLaboratoryLayout({
      db,
      laboratoryId: laboratory.id,
      draft: placed.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: MIGRATED_AT,
      auditId: 'audit-palette-before-move',
    });
    if (!savedPlaced.ok) throw new Error('expected placed layout save');

    const savedActive = getActiveLaboratoryLayout(savedPlaced.db, laboratory.id);
    if (!savedActive.ok) throw new Error('expected saved active layout');
    const secondEmpty = savedActive.layout.elements.find((element) => element.type === 'empty')!;
    const moved = moveLayoutElement(savedActive.layout, 'palette-switch', { row: secondEmpty.row, column: secondEmpty.column }, { updatedAt: MIGRATED_AT });
    if (!moved.ok) throw new Error('expected palette move');
    const saved = saveActiveLaboratoryLayout({ db: savedPlaced.db, laboratoryId: laboratory.id, draft: moved.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-palette-move' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (saved.ok) expect(saved.db.auditLogs[0].newValue).toContain('repositioned=1; added=0; removed=0');
  });

  it('saves one element property change atomically with one audit and unchanged dimensions and Device coverage', () => {
    const fixture = createPropertySaveFixture();
    const updated = updateLayoutElementProperties({
      layout: fixture.layout,
      elementId: 'property-door',
      patch: { label: 'Pintu Darurat', rotation: 90, locked: true },
      updatedAt: '2026-08-07T00:00:00.000Z',
    });
    if (!updated.ok) throw new Error('expected property update');
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: updated.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-07T00:00:00.000Z',
      auditId: 'audit-property-one',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.auditLogs).toHaveLength(fixture.db.auditLogs.length + 1);
    expect(saved.db.auditLogs[0].newValue).toContain('repositioned=0; added=0; removed=0; propertiesChanged=1');
    expect(saved.db.labs.find((laboratory) => laboratory.id === fixture.laboratory.id)).toMatchObject({ layoutRows: 2, layoutCols: 3 });
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
    const references = saved.layout.elements.filter((element) => element.referenceId).map((element) => element.referenceId);
    expect(references).toEqual(fixture.db.devices.filter((device) => device.laboratoryId === fixture.laboratory.id).map((device) => device.id));
  });

  it('counts each changed non-empty element once and excludes technical empty cells', () => {
    const fixture = createPropertySaveFixture();
    const printer = updateLayoutElementProperties({
      layout: fixture.layout,
      elementId: 'property-printer',
      patch: { label: 'Printer Utama', locked: true },
      updatedAt: '2026-08-07T00:00:00.000Z',
    });
    if (!printer.ok) throw new Error('expected printer update');
    const door = updateLayoutElementProperties({
      layout: printer.layout,
      elementId: 'property-door',
      patch: { rotation: 180 },
      updatedAt: '2026-08-07T00:00:01.000Z',
    });
    if (!door.ok) throw new Error('expected door update');
    const technicalEmpty = door.layout.elements.find((element) => element.type === 'empty')!;
    technicalEmpty.rotation = 90;
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: door.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-07T00:00:02.000Z',
      auditId: 'audit-property-two',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (saved.ok) expect(saved.db.auditLogs[0].newValue).toContain('propertiesChanged=2');
  });

  it('reports movement and property changes together in one layout-save audit', () => {
    const fixture = createPropertySaveFixture();
    const updated = updateLayoutElementProperties({
      layout: fixture.layout,
      elementId: 'property-printer',
      patch: { label: 'Printer Bergerak' },
      updatedAt: '2026-08-07T00:00:00.000Z',
    });
    if (!updated.ok) throw new Error('expected printer update');
    const target = updated.layout.elements.find((element) => element.type === 'empty')!;
    const moved = moveLayoutElement(updated.layout, 'property-printer', { row: target.row, column: target.column }, { updatedAt: '2026-08-07T00:00:01.000Z' });
    if (!moved.ok) throw new Error('expected printer move');
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: moved.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-07T00:00:02.000Z',
      auditId: 'audit-property-move',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.auditLogs).toHaveLength(fixture.db.auditLogs.length + 1);
    expect(saved.db.auditLogs[0].newValue).toContain('repositioned=1; added=0; removed=0; propertiesChanged=1');
  });

  it('saves a geometry-only change with one audit and unchanged laboratory dimensions and Devices', () => {
    const fixture = createGeometrySaveFixture();
    const devicesBefore = structuredClone(fixture.db.devices);
    const updated = updateLayoutElementGeometry({
      layout: fixture.layout,
      elementId: 'geometry-door',
      rowSpan: 2,
      columnSpan: 2,
      updatedAt: '2026-08-08T00:00:00.000Z',
      emptyElementIdPrefix: 'geometry-only',
    });
    if (!updated.ok) throw new Error('expected geometry update');
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: updated.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-08T00:00:01.000Z',
      auditId: 'audit-geometry-only',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.auditLogs).toHaveLength(fixture.db.auditLogs.length + 1);
    expect(saved.db.auditLogs[0].newValue).toContain('repositioned=0; added=0; removed=0; propertiesChanged=0; geometryChanged=1');
    expect(saved.db.labs.find((laboratory) => laboratory.id === fixture.laboratory.id)).toMatchObject({ layoutRows: 3, layoutCols: 4 });
    expect(saved.db.devices).toEqual(devicesBefore);
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
  });

  it('counts one element once when its span changes multiple times before Save', () => {
    const fixture = createGeometrySaveFixture();
    const first = updateLayoutElementGeometry({
      layout: fixture.layout,
      elementId: 'geometry-door',
      rowSpan: 2,
      columnSpan: 1,
      updatedAt: '2026-08-08T00:00:00.000Z',
      emptyElementIdPrefix: 'geometry-first',
    });
    if (!first.ok) throw new Error('expected first geometry update');
    const second = updateLayoutElementGeometry({
      layout: first.layout,
      elementId: 'geometry-door',
      rowSpan: 2,
      columnSpan: 2,
      updatedAt: '2026-08-08T00:00:01.000Z',
      emptyElementIdPrefix: 'geometry-second',
    });
    if (!second.ok) throw new Error('expected second geometry update');
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: second.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-08T00:00:02.000Z',
      auditId: 'audit-geometry-twice',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (saved.ok) expect(saved.db.auditLogs[0].newValue).toContain('geometryChanged=1');
  });

  it('treats geometry reverted to its baseline as equivalent and audit-free despite regenerated empty IDs', () => {
    const fixture = createGeometrySaveFixture();
    const expanded = updateLayoutElementGeometry({
      layout: fixture.layout,
      elementId: 'geometry-door',
      rowSpan: 2,
      columnSpan: 2,
      updatedAt: '2026-08-08T00:00:00.000Z',
      emptyElementIdPrefix: 'geometry-expand',
    });
    if (!expanded.ok) throw new Error('expected geometry expansion');
    const reverted = updateLayoutElementGeometry({
      layout: expanded.layout,
      elementId: 'geometry-door',
      rowSpan: 1,
      columnSpan: 1,
      updatedAt: '2026-08-08T00:00:01.000Z',
      emptyElementIdPrefix: 'geometry-revert',
    });
    if (!reverted.ok) throw new Error('expected geometry revert');
    expect(layoutsEquivalent(fixture.layout, reverted.layout)).toBe(true);
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: reverted.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-08T00:00:02.000Z',
      auditId: 'unused-geometry-revert',
    });
    expect(saved).toMatchObject({ ok: true, changed: false });
    if (saved.ok) {
      expect(saved.db).toBe(fixture.db);
      expect(saved.db.auditLogs).toHaveLength(fixture.db.auditLogs.length);
    }
  });

  it('reports property, movement, and geometry changes independently without counting technical empty cells', () => {
    const fixture = createGeometrySaveFixture();
    const property = updateLayoutElementProperties({
      layout: fixture.layout,
      elementId: 'geometry-door',
      patch: { label: 'Pintu Geometri Baru' },
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
    if (!property.ok) throw new Error('expected property update');
    const geometry = updateLayoutElementGeometry({
      layout: property.layout,
      elementId: 'geometry-door',
      rowSpan: 2,
      columnSpan: 1,
      updatedAt: '2026-08-08T00:00:01.000Z',
      emptyElementIdPrefix: 'geometry-combined',
    });
    if (!geometry.ok) throw new Error('expected geometry update');
    const moved = moveLayoutElement(
      geometry.layout,
      'geometry-door',
      { row: 1, column: 3 },
      { updatedAt: '2026-08-08T00:00:02.000Z', emptyElementIdPrefix: 'geometry-move' },
    );
    if (!moved.ok) throw new Error('expected geometry move');
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: moved.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-08T00:00:03.000Z',
      auditId: 'audit-geometry-combined',
    });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.auditLogs[0].newValue).toContain('repositioned=1; added=0; removed=0; propertiesChanged=1; geometryChanged=1');
    expect(saved.db.auditLogs[0].newValue).not.toContain('geometryChanged=2');
  });

  it('keeps equivalent property updates and their subsequent save audit-free', () => {
    const fixture = createPropertySaveFixture();
    const door = fixture.layout.elements.find((element) => element.id === 'property-door')!;
    const updated = updateLayoutElementProperties({
      layout: fixture.layout,
      elementId: door.id,
      patch: { label: door.label, rotation: door.rotation, locked: door.fixed },
      updatedAt: 'not-consumed-for-noop',
    });
    expect(updated).toMatchObject({ ok: true, operation: 'noop' });
    if (!updated.ok) return;
    const saved = saveActiveLaboratoryLayout({
      db: fixture.db,
      laboratoryId: fixture.laboratory.id,
      draft: updated.layout,
      actor: { name: 'Admin', role: 'Admin Lab' },
      savedAt: '2026-08-07T00:00:00.000Z',
      auditId: 'unused-property-noop',
    });
    expect(saved).toMatchObject({ ok: true, changed: false });
    if (saved.ok) {
      expect(saved.db).toBe(fixture.db);
      expect(saved.db.auditLogs).toHaveLength(fixture.db.auditLogs.length);
    }
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

  it('saves Custom conversion and expansion atomically while preserving exact device coverage', () => {
    const db = generateSeedData();
    const laboratory = db.labs[0];
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
    if (!converted.ok) throw new Error('expected conversion');
    const expanded = resizeCustomLayout({ layout: converted.layout, rows: active.layout.rows + 1, columns: active.layout.columns + 1, updatedAt: MIGRATED_AT, emptyElementIdPrefix: 'custom-expand' });
    if (!expanded.ok) throw new Error('expected expansion');

    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: expanded.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-custom-expand' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.labs.find((item) => item.id === laboratory.id)).toMatchObject({ layoutRows: 7, layoutCols: 7 });
    expect(saved.layout).toMatchObject({ layoutType: 'custom', rows: 7, columns: 7 });
    expect(saved.db.auditLogs[0]).toMatchObject({
      oldValue: expect.stringContaining('layoutType=grid-classic; dimensions=6x6'),
      newValue: expect.stringContaining('layoutType=custom; dimensions=7x7'),
    });
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
    expect(saved.layout.elements.filter((element) => element.referenceId).map((element) => element.referenceId).sort()).toEqual(db.devices.filter((device) => device.laboratoryId === laboratory.id).map((device) => device.id).sort());
    expect(db.labs.find((item) => item.id === laboratory.id)).toMatchObject({ layoutRows: 6, layoutCols: 6 });
  });

  it('allows a safe Custom shrink, but rejects direct grid-classic dimensions and invalid Custom device references without writes', () => {
    const db = generateSeedData();
    const laboratory = db.labs[0];
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
    if (!converted.ok) throw new Error('expected conversion');
    const expanded = resizeCustomLayout({ layout: converted.layout, rows: 7, columns: 6, updatedAt: MIGRATED_AT, emptyElementIdPrefix: 'custom-safe-expand' });
    if (!expanded.ok) throw new Error('expected expansion');
    const initiallySaved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: expanded.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-custom-before-shrink' });
    if (!initiallySaved.ok) throw new Error('expected initial Custom save');
    const shrunk = resizeCustomLayout({ layout: initiallySaved.layout, rows: 6, columns: 6, updatedAt: MIGRATED_AT, emptyElementIdPrefix: 'custom-safe-shrink' });
    if (!shrunk.ok) throw new Error('expected safe shrink');
    const saved = saveActiveLaboratoryLayout({ db: initiallySaved.db, laboratoryId: laboratory.id, draft: shrunk.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-custom-shrink' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (saved.ok) expect(saved.db.labs.find((item) => item.id === laboratory.id)).toMatchObject({ layoutRows: 6, layoutCols: 6 });

    const directGridResize = { ...expanded.layout, layoutType: 'grid-classic' as const };
    const beforeGrid = JSON.stringify(db);
    expect(saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: directGridResize, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-grid-resize' })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'unsupported-layout-dimension-change' })] });
    expect(JSON.stringify(db)).toBe(beforeGrid);

    const invalidCustom = cloneLaboratoryLayout(converted.layout);
    invalidCustom.elements.find((element) => element.type === 'student_pc')!.referenceId = 'missing-device';
    const beforeInvalid = JSON.stringify(db);
    expect(saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: invalidCustom, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-invalid-custom' })).toMatchObject({ ok: false });
    expect(JSON.stringify(db)).toBe(beforeInvalid);
  });

  it('saves a conversion-only Custom draft with one explanatory audit and keeps Custom no-ops audit-free', () => {
    const db = generateSeedData();
    const laboratory = db.labs[0];
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
    if (!converted.ok) throw new Error('expected conversion');
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: converted.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-custom-conversion' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.auditLogs[0]).toMatchObject({ oldValue: expect.stringContaining('layoutType=grid-classic'), newValue: expect.stringContaining('layoutType=custom; dimensions=6x6') });
    const noOp = saveActiveLaboratoryLayout({ db: saved.db, laboratoryId: laboratory.id, draft: saved.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-custom-noop' });
    expect(noOp).toMatchObject({ ok: true, changed: false });
    if (noOp.ok) expect(noOp.db.auditLogs).toHaveLength(saved.db.auditLogs.length);
  });

  it('rejects an otherwise valid oversized Custom draft without changing the database or audit history', () => {
    const db = generateSeedData();
    const laboratory = db.labs[0];
    const active = getActiveLaboratoryLayout(db, laboratory.id);
    if (!active.ok) throw new Error('expected active layout');
    const converted = convertLayoutToCustom({ layout: active.layout, updatedAt: MIGRATED_AT });
    if (!converted.ok) throw new Error('expected conversion');
    const oversized = {
      ...converted.layout,
      rows: 51,
      columns: 1,
      elements: [
        ...converted.layout.elements.map((element, index) => ({ ...element, row: index + 1, column: 1 })),
        ...Array.from({ length: 15 }, (_, index) => ({
          id: `oversized-empty-${index + 37}`,
          layoutId: converted.layout.id,
          type: 'empty' as const,
          row: index + 37,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          rotation: 0 as const,
          movable: false,
          swappable: false,
          fixed: false,
        })),
      ],
    };
    expect(validateLaboratoryLayout(oversized).valid).toBe(true);
    const before = JSON.stringify(db);
    const beforeAuditCount = db.auditLogs.length;
    const result = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: oversized, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: MIGRATED_AT, auditId: 'audit-oversized-custom' });
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'custom-layout-dimension-out-of-bounds' })] });
    expect(JSON.stringify(db)).toBe(before);
    expect(db.labs.find((item) => item.id === laboratory.id)).toMatchObject({ layoutRows: 6, layoutCols: 6 });
    expect(db.auditLogs).toHaveLength(beforeAuditCount);
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
    expect(loaded.db.schemaVersion).toBe(3);
    expect(storage.writesFor('smartlab_pplg_db')).toBe(1);
    expect(storage.getItem(STORAGE_KEYS.VERSION)).toBe('3.0.0');
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
    expect(fallback.db.schemaVersion).toBe(3);
    expect(storage.getItem('smartlab_pplg_db')).toBe(raw);
    expect(storage.writesFor('smartlab_pplg_db')).toBe(0);
  });

  it('does not rewrite a valid version-3 database or alter layout timestamps when loaded repeatedly', () => {
    const db = generateSeedData();
    storage.setItem('smartlab_pplg_db', JSON.stringify(db));
    storage.setItem(STORAGE_KEYS.VERSION, '3.0.0');
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

  it('distinguishes missing, parsed, malformed, and failed database storage reads', () => {
    expect(readStorageJSON('db')).toMatchObject({ ok: true, status: 'missing', value: null });
    storage.setItem('smartlab_pplg_db', '{"valid":true}');
    expect(readStorageJSON<{ valid: boolean }>('db')).toMatchObject({ ok: true, status: 'parsed', value: { valid: true } });
    storage.setItem('smartlab_pplg_db', '{broken');
    expect(readStorageJSON('db')).toMatchObject({ ok: false, status: 'malformed', raw: '{broken' });
  });
});
