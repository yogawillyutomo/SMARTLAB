import { describe, expect, it } from 'vitest';
import {
  canEditLayoutStructure,
  moveLayoutElement,
  placeLayoutElement,
  removeLayoutElement,
  validateLaboratoryLayout,
  type PalettePlaceableElementType,
} from '../index';
import { element, validLayout } from './fixtures';

const UPDATED_AT = '2026-08-11T09:00:00.000Z';

function place(type: PalettePlaceableElementType, target = { row: 2, column: 1 }, label?: string) {
  return placeLayoutElement({ layout: validLayout(), type, target, elementId: `palette-${type}`, updatedAt: UPDATED_AT, label });
}

describe('layout element palette operations', () => {
  it.each([
    ['teacher_desk'], ['printer'], ['network_switch'], ['access_point'], ['door'], ['window'], ['wall'], ['aisle'], ['label'],
  ] as const)('places %s into an explicit empty cell', (type) => {
    const result = place(type, { row: 2, column: 1 }, type === 'label' ? 'Zona Ujian' : undefined);
    expect(result).toMatchObject({ ok: true, operation: 'placed', elementId: `palette-${type}`, replacedElementId: 'empty-2-1' });
    if (!result.ok) return;
    const placed = result.layout.elements.find((element) => element.id === `palette-${type}`)!;
    expect(placed).toMatchObject({ type, row: 2, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0, fixed: false, movable: true, swappable: false });
    expect(placed.referenceId).toBeUndefined();
    expect(result.layout.elements.some((element) => element.id === 'empty-2-1')).toBe(false);
    expect(result.layout.elements).toHaveLength(4);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('requires a non-empty trimmed label and never mutates the source layout', () => {
    const source = validLayout();
    const before = JSON.stringify(source);
    expect(placeLayoutElement({ layout: source, type: 'label', target: { row: 2, column: 1 }, elementId: 'label-1', updatedAt: UPDATED_AT, label: '   ' })).toMatchObject({ ok: false, reason: 'invalid_label' });
    const result = placeLayoutElement({ layout: source, type: 'label', target: { row: 2, column: 1 }, elementId: 'label-1', updatedAt: UPDATED_AT, label: '  Zona Ujian  ' });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.layout.elements.find((element) => element.id === 'label-1')).toMatchObject({ label: 'Zona Ujian' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects occupied, out-of-bounds, and invalid-timestamp placement targets', () => {
    expect(placeLayoutElement({ layout: validLayout(), type: 'printer', target: { row: 1, column: 1 }, elementId: 'printer-1', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'target_occupied' });
    expect(placeLayoutElement({ layout: validLayout(), type: 'printer', target: { row: 3, column: 1 }, elementId: 'printer-1', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'invalid_target_coordinate' });
    expect(placeLayoutElement({ layout: validLayout(), type: 'printer', target: { row: 2, column: 1 }, elementId: 'printer-1', updatedAt: 'invalid' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' });
  });

  it('rejects device-managed PC palette creation without creating a reference', () => {
    expect(placeLayoutElement({ layout: validLayout(), type: 'student_pc', target: { row: 2, column: 1 }, elementId: 'fake-student', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'pc_element_managed' });
    expect(placeLayoutElement({ layout: validLayout(), type: 'teacher_pc', target: { row: 2, column: 1 }, elementId: 'fake-teacher', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'pc_element_managed' });
  });

  it.each(['grid-classic', 'custom'] as const)('allows structural palette editing for %s', (layoutType) => {
    const layout = { ...validLayout(), layoutType };
    expect(canEditLayoutStructure(layout)).toBe(true);
    expect(placeLayoutElement({ layout, type: 'printer', target: { row: 2, column: 1 }, elementId: 'printer-1', updatedAt: UPDATED_AT })).toMatchObject({ ok: true });
  });

  it.each(['perimeter-center-island', 'u-shape', 'facing-rows'] as const)('locks structural palette editing for %s', (layoutType) => {
    const layout = { ...validLayout(), layoutType };
    expect(canEditLayoutStructure(layout)).toBe(false);
    expect(placeLayoutElement({ layout, type: 'printer', target: { row: 2, column: 1 }, elementId: 'printer-1', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'palette_edit_not_allowed' });
  });

  it('replaces a removable non-PC element with one explicit empty cell immutably', () => {
    const placed = place('printer');
    if (!placed.ok) throw new Error('expected placement');
    const before = JSON.stringify(placed.layout);
    const removed = removeLayoutElement({ layout: placed.layout, elementId: 'palette-printer', emptyElementId: 'empty-restored', updatedAt: UPDATED_AT });
    expect(removed).toMatchObject({ ok: true, operation: 'removed', elementId: 'palette-printer', replacedElementId: 'empty-restored' });
    if (!removed.ok) return;
    expect(removed.layout.elements.find((element) => element.id === 'empty-restored')).toMatchObject({ type: 'empty', row: 2, column: 1, movable: false, swappable: false, fixed: false });
    expect(removed.layout.elements).toHaveLength(4);
    expect(validateLaboratoryLayout(removed.layout).valid).toBe(true);
    expect(JSON.stringify(placed.layout)).toBe(before);
  });

  it('rejects removal of managed PCs, fixed elements, and empty cells', () => {
    const source = validLayout();
    expect(removeLayoutElement({ layout: source, elementId: 'pc-1', emptyElementId: 'empty-new', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'pc_element_managed' });
    expect(removeLayoutElement({ layout: source, elementId: 'empty-2-1', emptyElementId: 'empty-new', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'element_not_removable' });
    const fixed = { ...source, elements: source.elements.map((item) => item.id === 'empty-2-1' ? element('fixed-door', 'door', 2, 1, { fixed: true, movable: false }) : item) };
    expect(removeLayoutElement({ layout: fixed, elementId: 'fixed-door', emptyElementId: 'empty-new', updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('allows a newly placed non-PC to move to empty while rejecting occupied targets', () => {
    const placed = place('network_switch');
    if (!placed.ok) throw new Error('expected placement');
    expect(moveLayoutElement(placed.layout, 'palette-network_switch', { row: 2, column: 2 }, { updatedAt: UPDATED_AT })).toMatchObject({ ok: true, operation: 'moved' });
    expect(moveLayoutElement(placed.layout, 'palette-network_switch', { row: 1, column: 1 }, { updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'occupied_target' });
  });

  it('preserves the student-PC swap contract', () => {
    expect(moveLayoutElement(validLayout(), 'pc-1', { row: 1, column: 2 }, { updatedAt: UPDATED_AT })).toMatchObject({ ok: true, operation: 'swapped' });
  });
});
