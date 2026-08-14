import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { normalizeDatabase } from '@/lib/dbMigrations';
import type { Device, LayoutElement } from '@/types';
import {
  PHYSICAL_LAYOUT_TEMPLATE_REGISTRY,
  PHYSICAL_TEMPLATE_AISLE_SLOTS,
  RPL_PERIMETER_CENTER_ISLAND_36,
  generatePhysicalLayoutTemplateDraft,
  moveLayoutElement,
  placeLayoutElement,
  saveActiveLaboratoryLayout,
  validateLaboratoryLayout,
  validatePersistedLaboratoryLayouts,
  validatePhysicalLayoutTemplateStructure,
} from '../index';

const AT = '2026-08-07T00:00:00.000Z';

function physicalFixture() {
  const db = generateSeedData();
  const lab = db.labs[0];
  const original = db.devices.find((device) => device.laboratoryId === lab.id)!;
  const baseDevices = db.devices.filter((device) => device.laboratoryId === lab.id).slice(0, 36);
  const teacher: Device = { ...original, id: `${original.id}-37`, positionCode: 'PC-37', hostname: 'PC-RPL1-37', assetCode: 'AST-RPL1-037', ipAddress: '10.10.99.37', macAddress: '02:00:99:37:38:39', serialNumber: 'SNRPL10372026' };
  db.devices = [...db.devices.filter((device) => device.laboratoryId !== lab.id), ...baseDevices, teacher];
  db.labs[0] = { ...lab, pcCount: 37, layoutRows: 7, layoutCols: 6 };
  const devices = db.devices.filter((device) => device.laboratoryId === lab.id);
  const layout = db.layouts.find((candidate) => candidate.laboratoryId === lab.id)!;
  const elements: LayoutElement[] = Array.from({ length: 42 }, (_, index) => {
    const row = Math.floor(index / 6) + 1; const column = (index % 6) + 1;
    const device = devices[index];
    return device
      ? { id: `${layout.id}:legacy:${device.id}`, layoutId: layout.id, type: 'student_pc', referenceId: device.id, row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: true, swappable: true, fixed: false }
      : { id: `${layout.id}:empty:${row}:${column}`, layoutId: layout.id, type: 'empty', row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: false, swappable: false, fixed: false };
  });
  db.layouts[db.layouts.findIndex((candidate) => candidate.id === layout.id)] = { ...layout, rows: 7, columns: 6, elements };
  const activeLayout = db.layouts.find((candidate) => candidate.id === layout.id)!;
  return { db, laboratory: db.labs[0], activeLayout, devices, teacher };
}

function generated() {
  const fixture = physicalFixture();
  const result = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices, teacherDeviceId: fixture.teacher.id, updatedAt: AT });
  if (!result.ok) throw new Error(result.issues[0]?.message);
  return { ...fixture, layout: result.layout };
}

describe('perimeter + center island physical template', () => {
  it('registers the exact 11 by 6, 36 student and one teacher definition', () => {
    expect(PHYSICAL_LAYOUT_TEMPLATE_REGISTRY).toContainEqual(RPL_PERIMETER_CENTER_ISLAND_36);
    expect(RPL_PERIMETER_CENTER_ISLAND_36).toMatchObject({ rows: 11, columns: 6, requiredStudentPcCount: 36, requiredTeacherPcCount: 1, requiredTotalDeviceCount: 37 });
  });

  it('generates deterministic real-device physical elements with the exact counts and structure', () => {
    const { layout, activeLayout, devices, teacher } = generated();
    expect(layout.elements).toHaveLength(66);
    expect(layout.elements.filter((element) => element.type === 'student_pc')).toHaveLength(36);
    expect(layout.elements.filter((element) => element.type === 'teacher_pc')).toHaveLength(1);
    expect(layout.elements.filter((element) => element.type === 'door')).toHaveLength(1);
    expect(layout.elements.filter((element) => element.type === 'aisle')).toHaveLength(28);
    expect(layout.elements.filter((element) => element.type === 'empty')).toHaveLength(0);
    expect(layout.elements.find((element) => element.type === 'teacher_pc')).toMatchObject({ row: 1, column: 1, label: 'PC Guru', referenceId: teacher.id, fixed: true, movable: false, swappable: false });
    expect(layout.elements.find((element) => element.type === 'door')).toMatchObject({ row: 1, column: 6, label: 'Pintu Masuk', fixed: true, movable: false, swappable: false });
    const aisleSlots = layout.elements.filter((element) => element.type === 'aisle').map((element) => `${element.row}:${element.column}`).sort();
    const expectedAisleSlots = [
      ...Array.from({ length: 4 }, (_, index) => `1:${index + 2}`),
      ...Array.from({ length: 6 }, (_, index) => `2:${index + 1}`),
      ...Array.from({ length: 9 }, (_, index) => `${index + 3}:2`),
      ...Array.from({ length: 9 }, (_, index) => `${index + 3}:5`),
    ].sort();
    expect(aisleSlots).toEqual(expectedAisleSlots);
    expect(new Set(layout.elements.filter((element) => element.referenceId).map((element) => element.referenceId)).size).toBe(37);
    expect(layout.elements.filter((element) => element.referenceId).every((element) => devices.some((device) => device.id === element.referenceId))).toBe(true);
    expect(validateLaboratoryLayout(layout).valid).toBe(true);
    expect(validatePhysicalLayoutTemplateStructure(layout).valid).toBe(true);
    expect(activeLayout.rows).toBe(7);
  });

  it('maps numeric student positions to the required banks without mutating source devices or layout', () => {
    const { layout, activeLayout, devices, teacher } = generated();
    const at = (row: number, column: number) => layout.elements.find((element) => element.row === row && element.column === column);
    expect(at(3, 6)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-01')?.id);
    expect(at(11, 6)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-09')?.id);
    expect(at(3, 4)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-18')?.id);
    expect(at(11, 4)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-10')?.id);
    expect(at(3, 3)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-19')?.id);
    expect(at(11, 3)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-27')?.id);
    expect(at(3, 1)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-36')?.id);
    expect(at(11, 1)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-28')?.id);
    expect(activeLayout.elements[0].row).toBe(1);
    expect(teacher.positionCode).toBe('PC-37');
  });

  it('rejects the previous complete 11 by 7 physical structure', () => {
    const { layout } = generated();
    const legacyAisle = (row: number, column: number): LayoutElement => ({ id: `${layout.id}:legacy-aisle:${row}:${column}`, layoutId: layout.id, type: 'aisle', row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: false, swappable: false, fixed: true });
    const oldStructure = {
      ...layout,
      columns: 7,
      elements: [
        ...layout.elements.map((element) => element.type === 'door' || (element.type === 'student_pc' && element.column === 6) ? { ...element, column: 7 } : { ...element }),
        legacyAisle(1, 6),
        legacyAisle(2, 7),
        ...Array.from({ length: 9 }, (_, index) => legacyAisle(index + 3, 6)),
      ],
    };
    expect(oldStructure.elements).toHaveLength(77);
    expect(validateLaboratoryLayout(oldStructure).valid).toBe(true);
    expect(validatePhysicalLayoutTemplateStructure(oldStructure).valid).toBe(false);
  });

  it('rejects missing, wrong-laboratory, and incompatible teacher/device bindings', () => {
    const fixture = physicalFixture();
    expect(generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices, updatedAt: AT })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'teacher-device-required' })] });
    const foreign = fixture.db.devices.find((device) => device.laboratoryId !== fixture.laboratory.id)!;
    const foreignTeacher = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.db.devices, teacherDeviceId: foreign.id, updatedAt: AT });
    expect(foreignTeacher.ok).toBe(false);
    if (!foreignTeacher.ok) expect(foreignTeacher.issues.map((issue) => issue.code)).toContain('teacher-device-wrong-laboratory');
    const fewerDevices = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices.slice(0, 36), teacherDeviceId: fixture.devices[0].id, updatedAt: AT });
    expect(fewerDevices.ok).toBe(false);
    if (!fewerDevices.ok) expect(fewerDevices.issues.map((issue) => issue.code)).toContain('invalid-device-count');
  });

  it('preserves Stage 3A student swaps while rejecting aisle, teacher, and fixed teacher movement', () => {
    const { layout } = generated();
    const student = layout.elements.find((element) => element.row === 3 && element.column === 6)!;
    const swapped = moveLayoutElement(layout, student.id, { row: 4, column: 6 }, { updatedAt: AT });
    expect(swapped).toMatchObject({ ok: true, operation: 'swapped' });
    if (swapped.ok) expect(validatePhysicalLayoutTemplateStructure(swapped.layout).valid).toBe(true);
    expect(moveLayoutElement(layout, student.id, { row: 3, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'incompatible_target' });
    expect(moveLayoutElement(layout, student.id, { row: 1, column: 1 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'incompatible_target' });
    const teacher = layout.elements.find((element) => element.type === 'teacher_pc')!;
    expect(moveLayoutElement(layout, teacher.id, { row: 2, column: 1 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('rejects palette structural placement before mutating the physical template draft', () => {
    const { layout } = generated();
    const before = JSON.stringify(layout);
    expect(placeLayoutElement({ layout, type: 'printer', target: { row: 2, column: 1 }, elementId: 'palette-printer', updatedAt: AT })).toMatchObject({ ok: false, reason: 'palette_edit_not_allowed' });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('saves a generated template with an atomic controlled dimension change and audit', () => {
    const { db, laboratory, layout } = generated();
    expect(validatePersistedLaboratoryLayouts(db).valid).toBe(true);
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-physical' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.labs.find((candidate) => candidate.id === laboratory.id)).toMatchObject({ layoutRows: 11, layoutCols: 6 });
    expect(saved.layout.layoutType).toBe('perimeter-center-island');
    expect(saved.db.auditLogs[0]).toMatchObject({ action: 'layout.save', newValue: expect.stringContaining('dimensions=11x6') });
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
    expect(db.labs.find((candidate) => candidate.id === laboratory.id)?.layoutRows).toBe(7);
    const normalized = normalizeDatabase(saved.db, { migratedAt: AT });
    expect(normalized).toMatchObject({ ok: true, changed: false });
  });

  it('rejects 38 devices, nonexistent teachers, invalid timestamps, and preserves deterministic source inputs', () => {
    const fixture = physicalFixture();
    const beforeDevices = JSON.stringify(fixture.devices);
    const beforeLayout = JSON.stringify(fixture.activeLayout);
    const extra = { ...fixture.devices[0], id: 'extra-device', positionCode: 'PC-38', laboratoryId: fixture.laboratory.id };
    const tooMany = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: [...fixture.devices, extra], teacherDeviceId: fixture.teacher.id, updatedAt: AT });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.issues.map((issue) => issue.code)).toContain('invalid-device-count');
    const missingTeacher = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices, teacherDeviceId: 'missing-device', updatedAt: AT });
    expect(missingTeacher).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'teacher-device-not-found' })] });
    expect(generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices, teacherDeviceId: fixture.teacher.id, updatedAt: 'invalid' })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'invalid-timestamp' })] });
    const first = generated().layout;
    const second = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: fixture.laboratory, activeLayout: fixture.activeLayout, devices: fixture.devices, teacherDeviceId: fixture.teacher.id, updatedAt: AT });
    expect(second).toMatchObject({ ok: true, layout: first });
    expect(JSON.stringify(fixture.devices)).toBe(beforeDevices);
    expect(JSON.stringify(fixture.activeLayout)).toBe(beforeLayout);
  });

  it('enforces all fixed aisle/student/teacher/door structure flags and keeps failed operations immutable', () => {
    const { layout } = generated();
    const at = (row: number, column: number) => layout.elements.find((element) => element.row === row && element.column === column)!;
    Array.from(PHYSICAL_TEMPLATE_AISLE_SLOTS).forEach((slot) => {
      const [row, column] = slot.split(':').map(Number);
      expect(at(row, column)).toMatchObject({ type: 'aisle', fixed: true, movable: false, swappable: false });
    });
    layout.elements.filter((element) => element.type === 'student_pc').forEach((element) => expect(element).toMatchObject({ fixed: false, movable: true, swappable: true }));
    expect(at(1, 1)).toMatchObject({ type: 'teacher_pc', fixed: true, movable: false, swappable: false });
    expect(at(1, 6)).toMatchObject({ type: 'door', fixed: true, movable: false, swappable: false });
    const student = at(3, 6); const source = JSON.stringify(layout);
    expect(moveLayoutElement(layout, student.id, { row: 3, column: 2 }, { updatedAt: AT }).ok).toBe(false);
    expect(JSON.stringify(layout)).toBe(source);
    expect(moveLayoutElement(layout, student.id, { row: 1, column: 1 }, { updatedAt: AT }).ok).toBe(false);
    expect(JSON.stringify(layout)).toBe(source);
    expect(moveLayoutElement(layout, at(1, 1).id, { row: 2, column: 1 }, { updatedAt: AT }).ok).toBe(false);
    expect(JSON.stringify(layout)).toBe(source);
  });

  it('rejects arbitrary and structurally invalid dimension changes without audit, while template no-ops remain audit-free', () => {
    const fixture = physicalFixture();
    const arbitrary = { ...fixture.activeLayout, rows: 3, columns: 14, elements: fixture.activeLayout.elements.map((element, index) => ({ ...element, row: Math.floor(index / 14) + 1, column: (index % 14) + 1 })) };
    const before = JSON.stringify(fixture.db);
    const rejected = saveActiveLaboratoryLayout({ db: fixture.db, laboratoryId: fixture.laboratory.id, draft: arbitrary, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-arbitrary' });
    expect(rejected).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'unsupported-layout-dimension-change' })] });
    expect(JSON.stringify(fixture.db)).toBe(before);
    const { db, laboratory, layout } = generated();
    const invalid = { ...layout, elements: layout.elements.map((element) => element.row === 3 && element.column === 2 ? { ...element, type: 'door' as const, label: 'Salah' } : { ...element }) };
    const beforeAudit = db.auditLogs.length;
    expect(saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: invalid, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-invalid-template' })).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'unsupported-layout-dimension-change' })] });
    expect(db.auditLogs).toHaveLength(beforeAudit);
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-template' });
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.db.auditLogs).toHaveLength(beforeAudit + 1);
    const noOp = saveActiveLaboratoryLayout({ db: saved.db, laboratoryId: laboratory.id, draft: saved.layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-noop' });
    expect(noOp).toMatchObject({ ok: true, changed: false });
    if (noOp.ok) expect(noOp.db.auditLogs).toHaveLength(beforeAudit + 1);
  });

  it('rejects a named-template direct resize until the user explicitly converts it to Custom', () => {
    const { db, laboratory, layout } = generated();
    const arbitraryNamedResize = {
      ...layout,
      rows: 3,
      columns: 22,
      elements: layout.elements.map((element, index) => ({ ...element, row: Math.floor(index / 22) + 1, column: (index % 22) + 1 })),
    };
    expect(validateLaboratoryLayout(arbitraryNamedResize).valid).toBe(true);
    const before = JSON.stringify(db);
    const beforeAuditCount = db.auditLogs.length;
    const result = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: arbitraryNamedResize, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-named-template-direct-resize' });
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'unsupported-layout-dimension-change' })] });
    expect(JSON.stringify(db)).toBe(before);
    expect(db.labs.find((candidate) => candidate.id === laboratory.id)).toMatchObject({ layoutRows: 7, layoutCols: 6 });
    expect(db.auditLogs).toHaveLength(beforeAuditCount);
  });
});
