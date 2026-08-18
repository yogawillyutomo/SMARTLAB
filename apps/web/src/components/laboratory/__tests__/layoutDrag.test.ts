import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import { moveLayoutElement, validateLaboratoryLayout } from '@/domain/laboratory-layout';
import {
  calculateElementDropAnchor,
  createLayoutElementDragPayload,
  resolveLayoutDropAction,
  resolveLogicalGridCoordinate,
  serializeLayoutElementDragPayload,
} from '../layoutDrag';

const UPDATED_AT = '2026-08-18T02:00:00.000Z';

function element(id: string, type: LayoutElementType, row: number, column: number, overrides: Partial<LayoutElement> = {}): LayoutElement {
  return {
    id,
    layoutId: 'drag-layout',
    type,
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

function layoutWith(source: LayoutElement, rows = 4, columns = 6): LaboratoryLayout {
  const occupied = new Set(Array.from(
    { length: source.rowSpan },
    (_, rowOffset) => Array.from({ length: source.columnSpan }, (_, columnOffset) => `${source.row + rowOffset}:${source.column + columnOffset}`),
  ).flat());
  const empties = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = (index % columns) + 1;
    return occupied.has(`${row}:${column}`) ? null : element(`empty-${row}-${column}`, 'empty', row, column, { movable: false });
  }).filter((item): item is LayoutElement => item !== null);
  return {
    id: 'drag-layout',
    laboratoryId: 'drag-lab',
    name: 'Drag Layout',
    layoutType: 'custom',
    rows,
    columns,
    version: 1,
    status: 'active',
    isActive: true,
    elements: [source, ...empties],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  };
}

function resolveMove(layout: LaboratoryLayout, source: LayoutElement, grabRow: number, grabColumn: number, dropRow: number, dropColumn: number) {
  const payload = createLayoutElementDragPayload(source, { row: grabRow, column: grabColumn });
  if (!payload) throw new Error('expected valid drag payload');
  return resolveLayoutDropAction({
    pointerCoordinate: { row: dropRow, column: dropColumn },
    paletteType: '',
    serializedElementPayload: serializeLayoutElementDragPayload(payload),
    elements: layout.elements,
  });
}

describe('logical layout drag coordinates', () => {
  it('resolves pointer pixels through the shared logical grid calculation', () => {
    expect(resolveLogicalGridCoordinate({
      clientX: 225,
      clientY: 125,
      bounds: { left: 100, top: 50, width: 420, height: 220 },
      rows: 2,
      columns: 4,
      rowGap: 20,
      columnGap: 20,
    })).toEqual({ row: 1, column: 2 });
  });

  it.each([
    ['top-left', 0, 0, 5, 6, 5, 6],
    ['top-right', 0, 1, 5, 6, 5, 5],
    ['bottom-left', 1, 0, 5, 6, 4, 6],
    ['bottom-right', 1, 1, 5, 6, 4, 5],
  ] as const)('preserves a 2x2 %s grab offset', (_, grabRowOffset, grabColumnOffset, pointerRow, pointerColumn, anchorRow, anchorColumn) => {
    expect(calculateElementDropAnchor(
      { row: pointerRow, column: pointerColumn },
      { grabRowOffset, grabColumnOffset },
    )).toEqual({ row: anchorRow, column: anchorColumn });
  });

  it('preserves an interior 2x3 grab offset', () => {
    const source = element('desk', 'teacher_desk', 2, 3, { rowSpan: 2, columnSpan: 3 });
    expect(createLayoutElementDragPayload(source, { row: 3, column: 4 })).toEqual({
      elementId: source.id,
      grabRowOffset: 1,
      grabColumnOffset: 1,
    });
    expect(resolveMove(layoutWith(source, 5, 7), source, 3, 4, 5, 6)).toMatchObject({
      kind: 'move',
      target: { row: 4, column: 5 },
    });
  });

  it('does not clamp an anchor that falls outside the grid after offset subtraction', () => {
    expect(calculateElementDropAnchor(
      { row: 1, column: 1 },
      { grabRowOffset: 1, grabColumnOffset: 1 },
    )).toEqual({ row: 0, column: 0 });
  });

  it('keeps 1x1 movement at offset zero', () => {
    const source = element('student-pc', 'student_pc', 2, 2, { referenceId: 'device-student-pc' });
    expect(createLayoutElementDragPayload(source, { row: 2, column: 2 })).toEqual({ elementId: source.id, grabRowOffset: 0, grabColumnOffset: 0 });
    expect(resolveMove(layoutWith(source), source, 2, 2, 3, 4)).toMatchObject({ kind: 'move', target: { row: 3, column: 4 } });
  });

  it('moves a 2x2 element one cell right with self-overlap after a bottom-right grab', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith(source);
    const action = resolveMove(layout, source, 2, 2, 2, 3);
    expect(action).toMatchObject({ kind: 'move', target: { row: 1, column: 2 } });
    if (!action || action.kind !== 'move') return;
    const moved = moveLayoutElement(layout, action.elementId, action.target, { updatedAt: UPDATED_AT, emptyElementIdPrefix: 'right' });
    expect(moved).toMatchObject({ ok: true, operation: 'moved' });
    if (moved.ok) expect(validateLaboratoryLayout(moved.layout).valid).toBe(true);
  });

  it('moves a 2x2 element one row down with self-overlap after a bottom-right grab', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith(source);
    const action = resolveMove(layout, source, 2, 2, 3, 2);
    expect(action).toMatchObject({ kind: 'move', target: { row: 2, column: 1 } });
    if (!action || action.kind !== 'move') return;
    expect(moveLayoutElement(layout, action.elementId, action.target, { updatedAt: UPDATED_AT, emptyElementIdPrefix: 'down' })).toMatchObject({ ok: true, operation: 'moved' });
  });

  it('moves back from the right grid edge using the covered cell grab offset', () => {
    const source = element('desk', 'teacher_desk', 1, 5, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith(source);
    const action = resolveMove(layout, source, 2, 6, 2, 5);
    expect(action).toMatchObject({ kind: 'move', target: { row: 1, column: 4 } });
    if (!action || action.kind !== 'move') return;
    expect(moveLayoutElement(layout, action.elementId, action.target, { updatedAt: UPDATED_AT, emptyElementIdPrefix: 'edge' })).toMatchObject({ ok: true, operation: 'moved' });
  });

  it.each([
    'not-json',
    JSON.stringify({ elementId: 'wall', grabRowOffset: -1, grabColumnOffset: 0 }),
    JSON.stringify({ elementId: 'wall', grabRowOffset: 2, grabColumnOffset: 0 }),
    JSON.stringify({ elementId: 'missing', grabRowOffset: 0, grabColumnOffset: 0 }),
  ])('fails closed for malformed or invalid internal payload %s', (serializedElementPayload) => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    const layout = layoutWith(source);
    const before = JSON.stringify(layout);
    expect(resolveLayoutDropAction({
      pointerCoordinate: { row: 2, column: 2 },
      paletteType: '',
      serializedElementPayload,
      elements: layout.elements,
    })).toBeNull();
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('keeps palette placement direct and independent from an element grab payload', () => {
    const source = element('wall', 'wall', 1, 1, { rowSpan: 2, columnSpan: 2 });
    expect(resolveLayoutDropAction({
      pointerCoordinate: { row: 3, column: 4 },
      paletteType: 'door',
      serializedElementPayload: 'malformed-element-payload',
      elements: layoutWith(source).elements,
    })).toEqual({ kind: 'place', type: 'door', target: { row: 3, column: 4 } });
  });
});
