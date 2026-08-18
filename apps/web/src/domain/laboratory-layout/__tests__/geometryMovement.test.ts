import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import { moveLayoutElement, validateLaboratoryLayout } from '../index';

const UPDATED_AT = '2026-08-18T01:00:00.000Z';

function element(id: string, type: LayoutElementType, row: number, column: number, overrides: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id,
    layoutId: 'movement-layout',
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

function layoutWith(populated: LayoutElement[], rows = 4, columns = 5, layoutType: LaboratoryLayout['layoutType'] = 'custom'): LaboratoryLayout {
  const occupied = new Set(populated.flatMap((item) => Array.from(
    { length: item.rowSpan },
    (_, rowOffset) => Array.from({ length: item.columnSpan }, (_, columnOffset) => `${item.row + rowOffset}:${item.column + columnOffset}`),
  )).flat());
  const empties = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = (index % columns) + 1;
    return occupied.has(`${row}:${column}`) ? null : element(`empty-${row}-${column}`, 'empty', row, column, { movable: false });
  }).filter((item): item is LayoutElement => item !== null);
  return {
    id: 'movement-layout', laboratoryId: 'movement-lab', name: 'Movement Layout', layoutType, rows, columns,
    version: 1, status: 'active', isActive: true, elements: [...populated, ...empties],
    createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
  };
}

function move(layout: LaboratoryLayout, sourceElementId: string, row: number, column: number, prefix = 'move-empty') {
  return moveLayoutElement(layout, sourceElementId, { row, column }, { updatedAt: UPDATED_AT, emptyElementIdPrefix: prefix });
}

describe('multi-cell layout movement', () => {
  it('moves a 2x2 element to a separate empty footprint and reconciles every cell', () => {
    const source = element('desk', 'teacher_desk', 1, 1, { rowSpan: 2, columnSpan: 2, label: 'Meja', rotation: 90 });
    const layout = layoutWith([source]);
    const before = JSON.stringify(layout);
    const result = move(layout, source.id, 3, 4);
    expect(result).toMatchObject({ ok: true, operation: 'moved', sourceElementId: source.id });
    expect(JSON.stringify(layout)).toBe(before);
    if (!result.ok) return;
    expect(result.layout.elements.find((item) => item.id === source.id)).toMatchObject({ row: 3, column: 4, rowSpan: 2, columnSpan: 2, label: 'Meja', rotation: 90 });
    expect(result.layout.elements.filter((item) => item.type === 'empty' && item.row <= 2 && item.column <= 2)).toHaveLength(4);
    expect(result.layout.elements).toHaveLength(layout.elements.length);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('moves one column right with self-overlap and consumes only destination-only empties', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith([source]);
    const result = move(layout, source.id, 1, 2);
    if (!result.ok) throw new Error('expected self-overlap move');
    expect(result.layout.elements.find((item) => item.id === source.id)).toMatchObject({ row: 1, column: 2, rowSpan: 2, columnSpan: 2 });
    expect(result.layout.elements.filter((item) => item.type === 'empty' && item.column === 1 && item.row <= 2)).toHaveLength(2);
    expect(result.layout.elements.some((item) => item.type === 'empty' && item.column === 3 && item.row <= 2)).toBe(false);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('moves one row down with self-overlap', () => {
    const source = element('aisle', 'aisle', 1, 2, { rowSpan: 2, columnSpan: 2 });
    const result = move(layoutWith([source]), source.id, 2, 2);
    if (!result.ok) throw new Error('expected self-overlap move');
    expect(result.layout.elements.find((item) => item.id === source.id)).toMatchObject({ row: 2, column: 2, rowSpan: 2, columnSpan: 2 });
    expect(result.layout.elements.filter((item) => item.type === 'empty' && item.row === 1 && item.column >= 2 && item.column <= 3)).toHaveLength(2);
  });

  it('rejects out-of-bounds and occupied destinations atomically', () => {
    const source = element('desk', 'teacher_desk', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const blocker = element('printer', 'printer', 1, 3);
    const layout = layoutWith([source, blocker]);
    const before = JSON.stringify(layout);
    expect(move(layout, source.id, 1, 2)).toMatchObject({ ok: false, reason: 'occupied_target' });
    expect(move(layout, source.id, 4, 4)).toMatchObject({ ok: false, reason: 'invalid_target_coordinate' });
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('rejects fixed and neutral immovable multi-cell sources', () => {
    const fixed = element('fixed-wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2, fixed: true, movable: false });
    expect(move(layoutWith([fixed]), fixed.id, 1, 2)).toMatchObject({ ok: false, reason: 'source_fixed' });
    const neutral = element('neutral-wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2, fixed: false, movable: false });
    expect(move(layoutWith([neutral]), neutral.id, 1, 2)).toMatchObject({ ok: false, reason: 'source_not_movable' });
  });

  it('returns same-anchor no-op without timestamp or empty prefix', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith([source]);
    const result = moveLayoutElement(layout, source.id, { row: 1, column: 1 }, { updatedAt: 'invalid' });
    expect(result).toMatchObject({ ok: true, operation: 'noop', layout: { updatedAt: layout.updatedAt } });
    if (result.ok) expect(result.layout).not.toBe(layout);
  });

  it('requires a valid empty prefix for an actual multi-cell move', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    expect(moveLayoutElement(layoutWith([source]), source.id, { row: 1, column: 2 }, { updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'invalid_empty_element_id_prefix' });
  });

  it('fails when generated empty IDs collide with retained IDs', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith([source]);
    layout.elements.find((item) => item.row === 4 && item.column === 5)!.id = 'move:1:1';
    expect(move(layout, source.id, 1, 2, 'move')).toMatchObject({ ok: false, reason: 'invalid_empty_element_id_prefix' });
  });

  it('keeps multi-cell movement Custom-only', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    expect(move(layoutWith([source], 4, 5, 'grid-classic'), source.id, 1, 2)).toMatchObject({ ok: false, reason: 'spanning_move_not_supported' });
  });
});
