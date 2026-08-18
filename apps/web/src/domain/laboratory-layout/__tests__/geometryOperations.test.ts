import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import {
  getLayoutElementGeometryCapabilities,
  updateLayoutElementGeometry,
  validateLaboratoryLayout,
} from '../index';

const UPDATED_AT = '2026-08-18T00:00:00.000Z';

function makeElement(id: string, type: LayoutElementType, row: number, column: number, overrides: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id,
    layoutId: 'geometry-layout',
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

function customLayout(rows = 4, columns = 5, populated: LayoutElement[] = []): LaboratoryLayout {
  const occupied = new Set(populated.flatMap((element) => Array.from(
    { length: element.rowSpan },
    (_, rowOffset) => Array.from({ length: element.columnSpan }, (_, columnOffset) => `${element.row + rowOffset}:${element.column + columnOffset}`),
  )).flat());
  const empties = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = (index % columns) + 1;
    return occupied.has(`${row}:${column}`) ? null : makeElement(`empty-${row}-${column}`, 'empty', row, column, { movable: false });
  }).filter((element): element is LayoutElement => element !== null);
  return {
    id: 'geometry-layout',
    laboratoryId: 'geometry-lab',
    name: 'Geometry Layout',
    layoutType: 'custom',
    rows,
    columns,
    version: 1,
    status: 'active',
    isActive: true,
    elements: [...populated, ...empties],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  };
}

function update(layout: LaboratoryLayout, elementId: string, rowSpan: number, columnSpan: number, prefix = 'geometry-empty') {
  return updateLayoutElementGeometry({ layout, elementId, rowSpan, columnSpan, updatedAt: UPDATED_AT, emptyElementIdPrefix: prefix });
}

describe('layout element geometry capabilities', () => {
  it.each(['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'] as const)('allows Custom %s geometry', (type) => {
    expect(getLayoutElementGeometryCapabilities({ layoutType: 'custom' }, { type })).toEqual({ editable: true, resizable: true });
  });

  it.each(['student_pc', 'teacher_pc', 'printer', 'network_switch', 'access_point', 'empty', 'projector'] as const)('keeps Custom %s at 1x1', (type) => {
    expect(getLayoutElementGeometryCapabilities({ layoutType: 'custom' }, { type })).toMatchObject({ editable: false, resizable: false });
  });

  it.each(['grid-classic', 'perimeter-center-island', 'u-shape', 'facing-rows'] as const)('blocks geometry mutation for %s', (layoutType) => {
    expect(getLayoutElementGeometryCapabilities({ layoutType }, { type: 'wall' })).toMatchObject({ editable: false, resizable: false, reason: 'geometry_not_custom' });
  });
});

describe('layout element geometry updates', () => {
  it.each([[1, 1, 2, 2], [1, 1, 2, 3], [2, 3, 1, 2], [2, 2, 3, 1]] as const)(
    'reconciles a %ix%i to %ix%i footprint',
    (fromRows, fromColumns, toRows, toColumns) => {
      const source = makeElement('desk', 'teacher_desk', 1, 1, {
        referenceId: 'reference-desk',
        rowSpan: fromRows,
        columnSpan: fromColumns,
        label: 'Meja Instruktur',
        rotation: 90,
        fixed: true,
        movable: false,
        swappable: false,
      });
      const layout = customLayout(4, 5, [source]);
      const before = JSON.stringify(layout);
      const result = update(layout, source.id, toRows, toColumns);
      expect(result).toMatchObject({
        ok: true,
        operation: 'updated',
        element: {
          id: source.id,
          type: source.type,
          row: 1,
          column: 1,
          rowSpan: toRows,
          columnSpan: toColumns,
          referenceId: 'reference-desk',
          label: source.label,
          rotation: 90,
          fixed: true,
          movable: false,
          swappable: false,
        },
      });
      expect(JSON.stringify(layout)).toBe(before);
      if (!result.ok) return;
      expect(result.layout.elements.filter((element) => element.type === 'empty')).toHaveLength(20 - (toRows * toColumns));
      expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])('rejects invalid row span %s immutably', (rowSpan) => {
    const source = makeElement('wall', 'wall', 1, 1);
    const layout = customLayout(3, 3, [source]);
    const before = JSON.stringify(layout);
    expect(update(layout, source.id, rowSpan, 1)).toMatchObject({ ok: false, reason: 'invalid_span' });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('rejects invalid column span and out-of-bounds footprints', () => {
    const source = makeElement('wall', 'wall', 3, 3);
    const layout = customLayout(3, 3, [source]);
    expect(update(layout, source.id, 1, 0)).toMatchObject({ ok: false, reason: 'invalid_span' });
    expect(update(layout, source.id, 2, 1)).toMatchObject({ ok: false, reason: 'geometry_out_of_bounds' });
    expect(update(layout, source.id, 1, 2)).toMatchObject({ ok: false, reason: 'geometry_out_of_bounds' });
  });

  it.each([
    ['student_pc', {}],
    ['printer', {}],
    ['wall', { rowSpan: 2, columnSpan: 1 }],
  ] as const)('rejects growth into a blocking %s atomically', (type, overrides) => {
    const source = makeElement('desk', 'teacher_desk', 1, 1);
    const blocker = makeElement('blocker', type, 1, 2, overrides);
    const layout = customLayout(3, 4, [source, blocker]);
    const before = JSON.stringify(layout);
    const result = update(layout, source.id, 1, 3);
    expect(result).toMatchObject({ ok: false, reason: 'geometry_collision', collisions: [expect.objectContaining({ elementId: blocker.id, type })] });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('returns an immutable no-op without requiring timestamp or empty prefix', () => {
    const source = makeElement('door', 'door', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = customLayout(3, 3, [source]);
    const result = updateLayoutElementGeometry({ layout, elementId: source.id, rowSpan: 2, columnSpan: 2, updatedAt: 'invalid' });
    expect(result).toMatchObject({ ok: true, operation: 'noop', layout: { updatedAt: layout.updatedAt } });
    if (result.ok) expect(result.layout).not.toBe(layout);
  });

  it('rejects non-Custom, unsupported, missing, invalid-prefix, and invalid-timestamp mutations', () => {
    const wall = makeElement('wall', 'wall', 1, 1);
    const layout = customLayout(3, 3, [wall]);
    expect(update({ ...layout, layoutType: 'grid-classic' }, wall.id, 2, 1)).toMatchObject({ ok: false, reason: 'geometry_not_custom' });
    const printer = makeElement('printer', 'printer', 1, 1);
    expect(update(customLayout(3, 3, [printer]), printer.id, 2, 1)).toMatchObject({ ok: false, reason: 'geometry_not_supported' });
    expect(update(layout, 'missing', 2, 1)).toMatchObject({ ok: false, reason: 'element_not_found' });
    expect(updateLayoutElementGeometry({ layout, elementId: wall.id, rowSpan: 2, columnSpan: 1, updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'invalid_empty_element_id_prefix' });
    expect(updateLayoutElementGeometry({ layout, elementId: wall.id, rowSpan: 2, columnSpan: 1, updatedAt: 'invalid', emptyElementIdPrefix: 'empty' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' });
  });

  it('fails atomically when a generated empty ID collides with a retained element', () => {
    const source = makeElement('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = customLayout(3, 3, [source]);
    layout.elements.find((element) => element.row === 3 && element.column === 3)!.id = 'released:1:2';
    expect(update(layout, source.id, 1, 1, 'released')).toMatchObject({ ok: false, reason: 'invalid_empty_element_id_prefix' });
  });

  it('does not change Device references or PC geometry while resizing another element', () => {
    const pc = makeElement('pc', 'student_pc', 1, 1);
    const wall = makeElement('wall', 'wall', 2, 1);
    const layout = customLayout(4, 4, [pc, wall]);
    const result = update(layout, wall.id, 2, 2);
    if (!result.ok) throw new Error('expected geometry update');
    expect(result.layout.elements.find((element) => element.id === pc.id)).toEqual(pc);
    expect(result.layout.elements.find((element) => element.id === wall.id)?.referenceId).toBeUndefined();
  });
});
