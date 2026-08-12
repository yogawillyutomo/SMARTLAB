import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import {
  CUSTOM_LAYOUT_MAX_COLUMNS,
  CUSTOM_LAYOUT_MAX_ROWS,
  analyzeCustomLayoutResize,
  convertLayoutToCustom,
  resizeCustomLayout,
  validateLaboratoryLayout,
} from '../index';

const UPDATED_AT = '2026-08-12T00:00:00.000Z';

function makeElement(id: string, type: LayoutElementType, row: number, column: number, overrides: Partial<LayoutElement> = {}): LayoutElement {
  const referenceId = type === 'student_pc' || type === 'teacher_pc' ? `device-${id}` : undefined;
  return {
    id,
    layoutId: 'custom-layout',
    type,
    ...(referenceId ? { referenceId } : {}),
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

function customLayout(rows = 3, columns = 3, populated: LayoutElement[] = []): LaboratoryLayout {
  const occupied = new Set(populated.flatMap((item) => Array.from({ length: item.rowSpan }, (_, rowOffset) => Array.from({ length: item.columnSpan }, (_, columnOffset) => `${item.row + rowOffset}:${item.column + columnOffset}`))).flat());
  const empties = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns) + 1;
    const column = (index % columns) + 1;
    return occupied.has(`${row}:${column}`) ? null : makeElement(`empty-${row}-${column}`, 'empty', row, column, { movable: false, swappable: false });
  }).filter((item): item is LayoutElement => item !== null);
  return {
    id: 'custom-layout', laboratoryId: 'lab-1', name: 'Custom Layout', layoutType: 'custom', rows, columns,
    version: 1, status: 'active', isActive: true, elements: [...populated, ...empties],
    createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  };
}

function templateLayout(type: Exclude<LaboratoryLayout['layoutType'], 'custom'>): LaboratoryLayout {
  return { ...customLayout(), layoutType: type };
}

describe('custom layout conversion', () => {
  it.each(['grid-classic', 'perimeter-center-island', 'u-shape', 'facing-rows'] as const)('converts %s explicitly without changing geometry', (layoutType) => {
    const source = templateLayout(layoutType);
    const result = convertLayoutToCustom({ layout: source, updatedAt: UPDATED_AT });
    expect(result).toMatchObject({ ok: true, operation: 'converted' });
    if (!result.ok) return;
    expect(result.layout).toMatchObject({ layoutType: 'custom', rows: source.rows, columns: source.columns, updatedAt: UPDATED_AT });
    expect(result.layout.elements).toEqual(source.elements);
    expect(result.layout).not.toBe(source);
  });

  it('preserves IDs, device references, flags, spans, rotation, and source immutability', () => {
    const source = templateLayout('perimeter-center-island');
    source.elements = customLayout(3, 3, [
      makeElement('teacher', 'teacher_pc', 1, 1, { referenceId: 'device-teacher', fixed: true, movable: false, rowSpan: 1, columnSpan: 1, rotation: 90 }),
      makeElement('wall', 'wall', 2, 1, { fixed: true, movable: false, rowSpan: 1, columnSpan: 2, rotation: 180 }),
    ]).elements;
    const before = JSON.stringify(source);
    const result = convertLayoutToCustom({ layout: source, updatedAt: UPDATED_AT });
    if (!result.ok) throw new Error('expected conversion');
    expect(result.layout.elements).toEqual(source.elements);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('returns immutable noop for an existing custom layout without consuming updatedAt', () => {
    const source = customLayout();
    const result = convertLayoutToCustom({ layout: source, updatedAt: UPDATED_AT });
    expect(result).toMatchObject({ ok: true, operation: 'noop' });
    if (result.ok) {
      expect(result.layout.updatedAt).toBe(source.updatedAt);
      expect(result.layout).not.toBe(source);
      expect(result.layout.elements[0]).not.toBe(source.elements[0]);
    }
  });

  it('rejects invalid layouts and invalid timestamps', () => {
    const invalid = customLayout();
    invalid.elements.pop();
    expect(convertLayoutToCustom({ layout: invalid, updatedAt: UPDATED_AT })).toMatchObject({ ok: false, reason: 'invalid_layout' });
    expect(convertLayoutToCustom({ layout: templateLayout('grid-classic'), updatedAt: 'bad' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' });
  });
});

describe('custom layout resize', () => {
  it.each([
    [4, 3, 3], [3, 4, 3], [4, 5, 11],
  ])('expands safely to %i x %i with %i explicit new cells', (rows, columns, addedCellCount) => {
    const source = customLayout();
    const result = resizeCustomLayout({ layout: source, rows, columns, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'expanded' });
    expect(result).toMatchObject({ ok: true, operation: 'resized', analysis: { addedCellCount, removedCellCount: 0 } });
    if (!result.ok) return;
    expect(result.layout.elements).toHaveLength(rows * columns);
    expect(result.layout.elements.filter((element) => element.type === 'empty')).toHaveLength(rows * columns);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('safely shrinks empty-only areas and supports mixed shrink plus expand', () => {
    const source = customLayout(4, 4, [makeElement('pc', 'student_pc', 1, 1)]);
    const shrink = resizeCustomLayout({ layout: source, rows: 3, columns: 3, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'shrink' });
    expect(shrink).toMatchObject({ ok: true, operation: 'resized', analysis: { addedCellCount: 0, removedCellCount: 7 } });
    if (!shrink.ok) return;
    const mixed = resizeCustomLayout({ layout: source, rows: 3, columns: 5, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'mixed' });
    expect(mixed).toMatchObject({ ok: true, analysis: { addedCellCount: 3, removedCellCount: 4 } });
    if (mixed.ok) expect(validateLaboratoryLayout(mixed.layout).valid).toBe(true);
  });

  it('returns an immutable noop for equal dimensions', () => {
    const source = customLayout();
    const result = resizeCustomLayout({ layout: source, rows: 3, columns: 3, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'noop' });
    expect(result).toMatchObject({ ok: true, operation: 'noop' });
    if (result.ok) {
      expect(result.layout.updatedAt).toBe(source.updatedAt);
      expect(result.layout).not.toBe(source);
    }
  });

  it.each(['grid-classic', 'perimeter-center-island', 'u-shape', 'facing-rows'] as const)('rejects resize before %s is converted', (layoutType) => {
    expect(resizeCustomLayout({ layout: templateLayout(layoutType), rows: 4, columns: 3, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'reject' })).toMatchObject({ ok: false, reason: 'resize_not_custom' });
  });

  it.each([
    [0, 3], [3, 0], [-1, 3], [3, -1], [1.5, 3], [3, 1.5], [Number.NaN, 3], [3, Number.NaN], [CUSTOM_LAYOUT_MAX_ROWS + 1, 3], [3, CUSTOM_LAYOUT_MAX_COLUMNS + 1],
  ])('rejects invalid dimensions %i x %i', (rows, columns) => {
    expect(resizeCustomLayout({ layout: customLayout(), rows, columns, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'invalid' })).toMatchObject({ ok: false, reason: 'invalid_dimensions' });
  });

  it('creates single-cell explicit empties and preserves retained non-empty identity and coordinates', () => {
    const pc = makeElement('pc', 'student_pc', 1, 1, { referenceId: 'device-pc' });
    const source = customLayout(2, 2, [pc]);
    const result = resizeCustomLayout({ layout: source, rows: 3, columns: 4, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'new-empty' });
    if (!result.ok) throw new Error('expected resize');
    expect(result.layout.elements.find((element) => element.id === pc.id)).toEqual(pc);
    expect(result.layout.elements.filter((element) => element.id.startsWith('new-empty:')).every((element) => element.type === 'empty' && element.rowSpan === 1 && element.columnSpan === 1 && element.rotation === 0 && !element.movable && !element.swappable && !element.fixed && !element.referenceId)).toBe(true);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it.each(['student_pc', 'teacher_pc', 'printer', 'door', 'wall', 'aisle', 'label'] as const)('blocks shrink when a %s would be clipped', (type) => {
    const element = makeElement(`block-${type}`, type, 3, 3, {
      ...(type === 'student_pc' || type === 'teacher_pc' ? { referenceId: `device-${type}` } : {}),
      ...(type === 'door' || type === 'wall' || type === 'aisle' ? { fixed: true, movable: false } : {}),
    });
    const source = customLayout(3, 3, [element]);
    const result = resizeCustomLayout({ layout: source, rows: 2, columns: 2, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'blocked' });
    expect(result).toMatchObject({ ok: false, reason: 'resize_would_clip_elements', blockingElements: [expect.objectContaining({ id: element.id, type })] });
  });

  it('blocks partially clipped multi-cell elements and leaves the source immutable on every rejection', () => {
    const spanning = makeElement('wide-wall', 'wall', 2, 2, { rowSpan: 2, columnSpan: 2, fixed: true, movable: false });
    const source = customLayout(3, 3, [spanning]);
    const before = JSON.stringify(source);
    expect(analyzeCustomLayoutResize({ layout: source, rows: 3, columns: 2 })).toMatchObject({ valid: false, reason: 'resize_would_clip_elements', blockingElements: [expect.objectContaining({ id: 'wide-wall', rowSpan: 2, columnSpan: 2 })] });
    expect(resizeCustomLayout({ layout: source, rows: 3, columns: 2, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'blocked' })).toMatchObject({ ok: false, reason: 'resize_would_clip_elements' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects generated empty ID collisions and never silently deletes occupied elements', () => {
    const source = customLayout(2, 2, [makeElement('collision:3:3', 'printer', 1, 1)]);
    const before = JSON.stringify(source);
    expect(resizeCustomLayout({ layout: source, rows: 3, columns: 3, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'collision' })).toMatchObject({ ok: false, reason: 'invalid_result' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rejects invalid timestamps and invalid source layouts', () => {
    const invalid = customLayout();
    invalid.elements.pop();
    expect(resizeCustomLayout({ layout: invalid, rows: 4, columns: 3, updatedAt: UPDATED_AT, emptyElementIdPrefix: 'invalid' })).toMatchObject({ ok: false, reason: 'invalid_layout' });
    expect(resizeCustomLayout({ layout: customLayout(), rows: 4, columns: 3, updatedAt: 'bad', emptyElementIdPrefix: 'invalid' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' });
  });
});
