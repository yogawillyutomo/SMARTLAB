import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { normalizeDatabase } from '@/lib/dbMigrations';
import type { Device, LayoutElement } from '@/types';
import {
  PHYSICAL_LAYOUT_TEMPLATE_REGISTRY,
  RPL_PERIMETER_CENTER_ISLAND_36,
  generatePhysicalLayoutTemplateDraft,
  moveLayoutElement,
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
  db.labs[0] = { ...lab, pcCount: 37, layoutRows: 6, layoutCols: 7 };
  const devices = db.devices.filter((device) => device.laboratoryId === lab.id);
  const layout = db.layouts.find((candidate) => candidate.laboratoryId === lab.id)!;
  const elements: LayoutElement[] = Array.from({ length: 42 }, (_, index) => {
    const row = Math.floor(index / 7) + 1; const column = (index % 7) + 1;
    const device = devices[index];
    return device
      ? { id: `${layout.id}:legacy:${device.id}`, layoutId: layout.id, type: 'student_pc', referenceId: device.id, row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: true, swappable: true, fixed: false }
      : { id: `${layout.id}:empty:${row}:${column}`, layoutId: layout.id, type: 'empty', row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: false, swappable: false, fixed: false };
  });
  db.layouts[db.layouts.findIndex((candidate) => candidate.id === layout.id)] = { ...layout, rows: 6, columns: 7, elements };
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
  it('registers the exact 11 by 7, 36 student and one teacher definition', () => {
    expect(PHYSICAL_LAYOUT_TEMPLATE_REGISTRY).toContainEqual(RPL_PERIMETER_CENTER_ISLAND_36);
    expect(RPL_PERIMETER_CENTER_ISLAND_36).toMatchObject({ rows: 11, columns: 7, requiredStudentPcCount: 36, requiredTeacherPcCount: 1, requiredTotalDeviceCount: 37 });
  });

  it('generates deterministic real-device physical elements with the exact counts and structure', () => {
    const { layout, activeLayout, devices, teacher } = generated();
    expect(layout.elements).toHaveLength(77);
    expect(layout.elements.filter((element) => element.type === 'student_pc')).toHaveLength(36);
    expect(layout.elements.filter((element) => element.type === 'teacher_pc')).toHaveLength(1);
    expect(layout.elements.filter((element) => element.type === 'door')).toHaveLength(1);
    expect(layout.elements.filter((element) => element.type === 'aisle')).toHaveLength(39);
    expect(layout.elements.filter((element) => element.type === 'empty')).toHaveLength(0);
    expect(layout.elements.find((element) => element.type === 'teacher_pc')).toMatchObject({ row: 1, column: 1, referenceId: teacher.id, fixed: true, movable: false, swappable: false });
    expect(layout.elements.find((element) => element.type === 'door')).toMatchObject({ row: 1, column: 7, fixed: true, movable: false, swappable: false });
    expect(new Set(layout.elements.filter((element) => element.referenceId).map((element) => element.referenceId)).size).toBe(37);
    expect(layout.elements.filter((element) => element.referenceId).every((element) => devices.some((device) => device.id === element.referenceId))).toBe(true);
    expect(validateLaboratoryLayout(layout).valid).toBe(true);
    expect(validatePhysicalLayoutTemplateStructure(layout).valid).toBe(true);
    expect(activeLayout.rows).toBe(6);
  });

  it('maps numeric student positions to the required banks without mutating source devices or layout', () => {
    const { layout, activeLayout, devices, teacher } = generated();
    const at = (row: number, column: number) => layout.elements.find((element) => element.row === row && element.column === column);
    expect(at(3, 7)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-01')?.id);
    expect(at(11, 7)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-09')?.id);
    expect(at(3, 4)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-18')?.id);
    expect(at(11, 4)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-10')?.id);
    expect(at(3, 3)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-19')?.id);
    expect(at(11, 3)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-27')?.id);
    expect(at(3, 1)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-36')?.id);
    expect(at(11, 1)?.referenceId).toBe(devices.find((device) => device.positionCode === 'PC-28')?.id);
    expect(activeLayout.elements[0].row).toBe(1);
    expect(teacher.positionCode).toBe('PC-37');
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
    const student = layout.elements.find((element) => element.row === 3 && element.column === 7)!;
    const swapped = moveLayoutElement(layout, student.id, { row: 4, column: 7 }, { updatedAt: AT });
    expect(swapped).toMatchObject({ ok: true, operation: 'swapped' });
    if (swapped.ok) expect(validatePhysicalLayoutTemplateStructure(swapped.layout).valid).toBe(true);
    expect(moveLayoutElement(layout, student.id, { row: 3, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'incompatible_target' });
    expect(moveLayoutElement(layout, student.id, { row: 1, column: 1 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'incompatible_target' });
    const teacher = layout.elements.find((element) => element.type === 'teacher_pc')!;
    expect(moveLayoutElement(layout, teacher.id, { row: 2, column: 1 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('saves a generated template with an atomic controlled dimension change and audit', () => {
    const { db, laboratory, layout } = generated();
    expect(validatePersistedLaboratoryLayouts(db).valid).toBe(true);
    const saved = saveActiveLaboratoryLayout({ db, laboratoryId: laboratory.id, draft: layout, actor: { name: 'Admin', role: 'Admin Lab' }, savedAt: AT, auditId: 'audit-physical' });
    expect(saved).toMatchObject({ ok: true, changed: true });
    if (!saved.ok) return;
    expect(saved.db.labs.find((candidate) => candidate.id === laboratory.id)).toMatchObject({ layoutRows: 11, layoutCols: 7 });
    expect(saved.layout.layoutType).toBe('perimeter-center-island');
    expect(saved.db.auditLogs[0]).toMatchObject({ action: 'layout.save', newValue: expect.stringContaining('dimensions=11x7') });
    expect(validatePersistedLaboratoryLayouts(saved.db).valid).toBe(true);
    expect(db.labs.find((candidate) => candidate.id === laboratory.id)?.layoutRows).toBe(6);
    const normalized = normalizeDatabase(saved.db, { migratedAt: AT });
    expect(normalized).toMatchObject({ ok: true, changed: false });
  });
});
