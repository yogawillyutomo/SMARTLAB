import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import {
  getLayoutElementPropertyCapabilities,
  moveLayoutElement,
  updateLayoutElementProperties,
  validateLaboratoryLayout,
} from '../index';

const AT = '2026-08-17T00:00:00.000Z';

function element(id: string, type: LayoutElementType, row: number, column: number, overrides: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id,
    layoutId: 'layout-properties',
    type,
    ...(type === 'student_pc' || type === 'teacher_pc' ? { referenceId: `device-${id}` } : {}),
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: type !== 'empty',
    swappable: type === 'student_pc',
    fixed: false,
    ...overrides,
  };
}

function layoutWith(source: LayoutElement, layoutType: LaboratoryLayout['layoutType'] = 'custom'): LaboratoryLayout {
  const occupied = new Set(Array.from({ length: source.rowSpan }, (_, rowOffset) => Array.from({ length: source.columnSpan }, (_, columnOffset) => `${source.row + rowOffset}:${source.column + columnOffset}`)).flat());
  const empties = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3) + 1;
    const column = (index % 3) + 1;
    return occupied.has(`${row}:${column}`) ? null : element(`empty-${row}-${column}`, 'empty', row, column, { movable: false });
  }).filter((candidate): candidate is LayoutElement => candidate !== null);
  return {
    id: 'layout-properties', laboratoryId: 'lab-properties', name: 'Property Layout', layoutType, rows: 3, columns: 3,
    version: 1, status: 'active', isActive: true, elements: [source, ...empties],
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
  };
}

describe('layout element property capabilities', () => {
  it.each([
    ['teacher_desk', true, true, true],
    ['printer', true, false, true],
    ['network_switch', true, false, true],
    ['access_point', true, false, true],
    ['door', true, true, true],
    ['window', true, true, true],
    ['wall', true, true, true],
    ['aisle', false, true, true],
    ['label', true, true, true],
  ] as const)('centralizes Custom %s label=%s rotation=%s lock=%s policy', (type, labelEditable, rotationEditable, lockEditable) => {
    expect(getLayoutElementPropertyCapabilities({ layoutType: 'custom' }, { type })).toEqual({ editable: true, labelEditable, rotationEditable, lockEditable });
  });

  it.each([
    ['student_pc', 'device_element_managed'],
    ['teacher_pc', 'device_element_managed'],
    ['empty', 'empty_element_not_editable'],
  ] as const)('keeps %s read-only', (type, reason) => {
    expect(getLayoutElementPropertyCapabilities({ layoutType: 'custom' }, { type })).toMatchObject({ editable: false, reason });
  });

  it('blocks property capabilities until the layout is explicitly Custom', () => {
    expect(getLayoutElementPropertyCapabilities({ layoutType: 'grid-classic' }, { type: 'door' })).toMatchObject({ editable: false, reason: 'property_edit_not_custom' });
  });
});

describe('layout element property updates', () => {
  it('edits and trims a normal non-PC label without changing identity, geometry, reference, or swappable', () => {
    const source = element('desk', 'teacher_desk', 2, 2, { label: 'Meja', rowSpan: 1, columnSpan: 1, rotation: 90, swappable: false });
    const layout = layoutWith(source);
    const before = JSON.stringify(layout);
    const result = updateLayoutElementProperties({ layout, elementId: source.id, patch: { label: '  Meja Instruktur  ' }, updatedAt: AT });
    expect(result).toMatchObject({ ok: true, operation: 'updated', element: { id: source.id, type: source.type, label: 'Meja Instruktur', row: 2, column: 2, rowSpan: 1, columnSpan: 1, rotation: 90, swappable: false } });
    if (result.ok) expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('clears an optional custom label to undefined', () => {
    const source = element('printer', 'printer', 1, 1, { label: 'Printer Depan' });
    const result = updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { label: '   ' }, updatedAt: AT });
    expect(result).toMatchObject({ ok: true, operation: 'updated' });
    if (result.ok) expect(result.element.label).toBeUndefined();
  });

  it.each(['', '   '])('rejects required label text %j', (label) => {
    const source = element('label', 'label', 1, 1, { label: 'Informasi' });
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { label }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'invalid_label' });
  });

  it('accepts 60 label characters and rejects 61', () => {
    const source = element('label', 'label', 1, 1, { label: 'Informasi' });
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { label: 'a'.repeat(60) }, updatedAt: AT })).toMatchObject({ ok: true, operation: 'updated' });
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { label: 'a'.repeat(61) }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'invalid_label' });
  });

  it.each([[0, 90], [90, 180], [180, 270], [270, 0]] as const)('rotates %i to %i without changing geometry', (from, to) => {
    const source = element('door', 'door', 2, 2, { rotation: from });
    const result = updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { rotation: to }, updatedAt: AT });
    expect(result).toMatchObject({ ok: true, operation: 'updated', element: { rotation: to, row: 2, column: 2, rowSpan: 1, columnSpan: 1 } });
  });

  it('rejects unsupported rotations at runtime', () => {
    const source = element('door', 'door', 1, 1);
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { rotation: 45 }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'invalid_rotation' });
  });

  it('locks and unlocks semantically without changing swappable', () => {
    const source = element('door', 'door', 1, 1, { swappable: false });
    const locked = updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { locked: true }, updatedAt: AT });
    expect(locked).toMatchObject({ ok: true, element: { fixed: true, movable: false, swappable: false } });
    if (!locked.ok) return;
    const unlocked = updateLayoutElementProperties({ layout: locked.layout, elementId: source.id, patch: { locked: false }, updatedAt: AT });
    expect(unlocked).toMatchObject({ ok: true, element: { fixed: false, movable: true, swappable: false } });
  });

  it.each([
    ['student_pc', 'device_element_managed'],
    ['teacher_pc', 'device_element_managed'],
    ['empty', 'empty_element_not_editable'],
  ] as const)('rejects %s mutation with a typed reason', (type, reason) => {
    const source = element(type, type, 1, 1, { ...(type === 'empty' ? { movable: false } : {}) });
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { locked: true }, updatedAt: AT })).toMatchObject({ ok: false, reason });
  });

  it('rejects non-Custom mutation, missing elements, invalid layouts, and unsupported properties', () => {
    const door = element('door', 'door', 1, 1);
    expect(updateLayoutElementProperties({ layout: layoutWith(door, 'grid-classic'), elementId: door.id, patch: { locked: true }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'property_edit_not_custom' });
    expect(updateLayoutElementProperties({ layout: layoutWith(door), elementId: 'missing', patch: { locked: true }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'element_not_found' });
    const invalid = layoutWith(door); invalid.elements.pop();
    expect(updateLayoutElementProperties({ layout: invalid, elementId: door.id, patch: { locked: true }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'invalid_layout' });
    const printer = element('printer', 'printer', 1, 1);
    expect(updateLayoutElementProperties({ layout: layoutWith(printer), elementId: printer.id, patch: { rotation: 90 }, updatedAt: AT })).toMatchObject({ ok: false, reason: 'unsupported_property' });
  });

  it('returns an immutable noop without consuming updatedAt', () => {
    const source = element('door', 'door', 1, 1, { label: 'Pintu', rotation: 90, fixed: true, movable: false });
    const layout = layoutWith(source);
    const result = updateLayoutElementProperties({ layout, elementId: source.id, patch: { label: ' Pintu ', rotation: 90, locked: true }, updatedAt: 'invalid' });
    expect(result).toMatchObject({ ok: true, operation: 'noop', layout: { updatedAt: layout.updatedAt } });
    if (result.ok) expect(result.layout).not.toBe(layout);
  });

  it('rejects an invalid timestamp only for a real mutation', () => {
    const source = element('door', 'door', 1, 1);
    expect(updateLayoutElementProperties({ layout: layoutWith(source), elementId: source.id, patch: { rotation: 90 }, updatedAt: 'invalid' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' });
  });
});

describe('property lock movement regressions', () => {
  it('moves unlocked non-PC elements and rejects them immediately after lock', () => {
    const printer = element('printer', 'printer', 1, 1);
    const layout = layoutWith(printer);
    expect(moveLayoutElement(layout, printer.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: true, operation: 'moved' });
    const locked = updateLayoutElementProperties({ layout, elementId: printer.id, patch: { locked: true }, updatedAt: AT });
    if (!locked.ok) throw new Error('expected lock');
    expect(moveLayoutElement(locked.layout, printer.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('unlocks a template-derived Custom door for existing movement rules', () => {
    const door = element('door', 'door', 1, 1, { fixed: true, movable: false });
    const unlocked = updateLayoutElementProperties({ layout: layoutWith(door), elementId: door.id, patch: { locked: false }, updatedAt: AT });
    if (!unlocked.ok) throw new Error('expected unlock');
    expect(moveLayoutElement(unlocked.layout, door.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: true, operation: 'moved' });
  });

  it('retains fixed teacher and student swap rules while non-PC occupied targets remain blocked', () => {
    const teacher = element('teacher', 'teacher_pc', 1, 1, { fixed: true, movable: false });
    expect(moveLayoutElement(layoutWith(teacher), teacher.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'source_fixed' });
    const first = element('pc-1', 'student_pc', 1, 1);
    const second = element('pc-2', 'student_pc', 1, 2);
    const pcLayout = layoutWith(first); pcLayout.elements = [first, second, ...pcLayout.elements.filter((candidate) => candidate.type === 'empty' && !(candidate.row === 1 && candidate.column === 2))];
    expect(moveLayoutElement(pcLayout, first.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: true, operation: 'swapped' });
    const door = element('door', 'door', 1, 1);
    const printer = element('printer', 'printer', 1, 2);
    const occupied = layoutWith(door); occupied.elements = [door, printer, ...occupied.elements.filter((candidate) => candidate.type === 'empty' && !(candidate.row === 1 && candidate.column === 2))];
    expect(moveLayoutElement(occupied, door.id, { row: 1, column: 2 }, { updatedAt: AT })).toMatchObject({ ok: false, reason: 'occupied_target' });
  });
});
