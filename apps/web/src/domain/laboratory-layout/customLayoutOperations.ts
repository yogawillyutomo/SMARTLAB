import type { ID, LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import type { LayoutValidationIssue } from './types';
import { validateLaboratoryLayout } from './validation';

/** Bounds keep custom grids usable in the browser and local persisted store. */
export const CUSTOM_LAYOUT_MIN_ROWS = 1;
export const CUSTOM_LAYOUT_MIN_COLUMNS = 1;
export const CUSTOM_LAYOUT_MAX_ROWS = 50;
export const CUSTOM_LAYOUT_MAX_COLUMNS = 50;

export interface CustomLayoutBlockingElement {
  id: ID;
  type: LayoutElementType;
  label?: string;
  referenceId?: ID;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

export type CustomLayoutFailureReason =
  | 'invalid_layout'
  | 'invalid_timestamp'
  | 'resize_not_custom'
  | 'invalid_dimensions'
  | 'resize_would_clip_elements'
  | 'invalid_empty_element_id_prefix'
  | 'invalid_result';

export interface CustomLayoutFailure {
  ok: false;
  reason: CustomLayoutFailureReason;
  message: string;
  issues?: LayoutValidationIssue[];
  blockingElements?: CustomLayoutBlockingElement[];
}

export type ConvertLayoutToCustomResult =
  | { ok: true; operation: 'converted' | 'noop'; layout: LaboratoryLayout }
  | CustomLayoutFailure;

export interface CustomLayoutResizeAnalysis {
  valid: boolean;
  targetRows: number;
  targetColumns: number;
  addedCellCount: number;
  removedCellCount: number;
  blockingElements: CustomLayoutBlockingElement[];
  reason?: CustomLayoutFailureReason;
  message?: string;
  issues?: LayoutValidationIssue[];
}

export type ResizeCustomLayoutResult =
  | { ok: true; operation: 'resized' | 'noop'; layout: LaboratoryLayout; analysis: CustomLayoutResizeAnalysis }
  | CustomLayoutFailure;

export interface ConvertLayoutToCustomInput {
  layout: LaboratoryLayout;
  updatedAt: string;
}

export interface AnalyzeCustomLayoutResizeInput {
  layout: LaboratoryLayout;
  rows: number;
  columns: number;
}

export interface ResizeCustomLayoutInput extends AnalyzeCustomLayoutResizeInput {
  updatedAt: string;
  emptyElementIdPrefix: string;
}

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function validDimension(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function failure(
  reason: CustomLayoutFailureReason,
  message: string,
  options: Pick<CustomLayoutFailure, 'issues' | 'blockingElements'> = {},
): CustomLayoutFailure {
  return { ok: false, reason, message, ...options };
}

function occupiedCoordinates(element: LayoutElement): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let row = element.row; row < element.row + element.rowSpan; row += 1) {
    for (let column = element.column; column < element.column + element.columnSpan; column += 1) cells.push([row, column]);
  }
  return cells;
}

function isFullyWithin(element: LayoutElement, rows: number, columns: number): boolean {
  return element.row + element.rowSpan - 1 <= rows && element.column + element.columnSpan - 1 <= columns;
}

function toBlocker(element: LayoutElement): CustomLayoutBlockingElement {
  const { id, type, label, referenceId, row, column, rowSpan, columnSpan } = element;
  return { id, type, ...(label ? { label } : {}), ...(referenceId ? { referenceId } : {}), row, column, rowSpan, columnSpan };
}

function emptyElement(layoutId: ID, id: ID, row: number, column: number): LayoutElement {
  return {
    id,
    layoutId,
    type: 'empty',
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: false,
    swappable: false,
    fixed: false,
  };
}

function analyzeDimensions(layout: LaboratoryLayout, rows: number, columns: number): Omit<CustomLayoutResizeAnalysis, 'blockingElements'> {
  const addedCellCount = Array.from({ length: rows }, (_, rowIndex) => rowIndex + 1)
    .flatMap((row) => Array.from({ length: columns }, (_, columnIndex) => columnIndex + 1).map((column) => ({ row, column })))
    .filter(({ row, column }) => row > layout.rows || column > layout.columns).length;
  const removedCellCount = Array.from({ length: layout.rows }, (_, rowIndex) => rowIndex + 1)
    .flatMap((row) => Array.from({ length: layout.columns }, (_, columnIndex) => columnIndex + 1).map((column) => ({ row, column })))
    .filter(({ row, column }) => row > rows || column > columns).length;
  return { valid: true, targetRows: rows, targetColumns: columns, addedCellCount, removedCellCount };
}

export function convertLayoutToCustom(input: ConvertLayoutToCustomInput): ConvertLayoutToCustomResult {
  const validation = validateLaboratoryLayout(input.layout);
  if (!validation.valid) return failure('invalid_layout', 'Denah tidak valid dan tidak dapat diubah menjadi Custom.', { issues: validation.issues });
  if (!validTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan Custom tidak valid.');
  if (input.layout.layoutType === 'custom') return { ok: true, operation: 'noop', layout: cloneLayout(input.layout) };

  const next = cloneLayout(input.layout);
  next.layoutType = 'custom';
  next.updatedAt = input.updatedAt;
  return { ok: true, operation: 'converted', layout: next };
}

export function analyzeCustomLayoutResize(input: AnalyzeCustomLayoutResizeInput): CustomLayoutResizeAnalysis {
  const validation = validateLaboratoryLayout(input.layout);
  if (!validation.valid) {
    return { valid: false, targetRows: input.rows, targetColumns: input.columns, addedCellCount: 0, removedCellCount: 0, blockingElements: [], reason: 'invalid_layout', message: 'Denah tidak valid dan tidak dapat diubah ukurannya.', issues: validation.issues };
  }
  if (input.layout.layoutType !== 'custom') {
    return { valid: false, targetRows: input.rows, targetColumns: input.columns, addedCellCount: 0, removedCellCount: 0, blockingElements: [], reason: 'resize_not_custom', message: 'Ukuran grid hanya dapat diubah setelah denah menjadi Custom.' };
  }
  if (!validDimension(input.rows, CUSTOM_LAYOUT_MIN_ROWS, CUSTOM_LAYOUT_MAX_ROWS) || !validDimension(input.columns, CUSTOM_LAYOUT_MIN_COLUMNS, CUSTOM_LAYOUT_MAX_COLUMNS)) {
    return { valid: false, targetRows: input.rows, targetColumns: input.columns, addedCellCount: 0, removedCellCount: 0, blockingElements: [], reason: 'invalid_dimensions', message: `Baris harus ${CUSTOM_LAYOUT_MIN_ROWS}–${CUSTOM_LAYOUT_MAX_ROWS} dan kolom harus ${CUSTOM_LAYOUT_MIN_COLUMNS}–${CUSTOM_LAYOUT_MAX_COLUMNS}.` };
  }
  const dimensions = analyzeDimensions(input.layout, input.rows, input.columns);
  const blockingElements = input.layout.elements.filter((element) => element.type !== 'empty' && !isFullyWithin(element, input.rows, input.columns)).map(toBlocker);
  return blockingElements.length > 0
    ? { ...dimensions, valid: false, blockingElements, reason: 'resize_would_clip_elements', message: 'Ukuran baru akan memotong elemen yang terisi.' }
    : { ...dimensions, blockingElements };
}

export function resizeCustomLayout(input: ResizeCustomLayoutInput): ResizeCustomLayoutResult {
  const sourceValidation = validateLaboratoryLayout(input.layout);
  if (!sourceValidation.valid) return failure('invalid_layout', 'Denah tidak valid dan tidak dapat diubah ukurannya.', { issues: sourceValidation.issues });
  if (!validTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan ukuran tidak valid.');
  if (!input.emptyElementIdPrefix?.trim()) return failure('invalid_empty_element_id_prefix', 'Prefix ID sel kosong wajib diisi.');
  const analysis = analyzeCustomLayoutResize(input);
  if (!analysis.valid) return failure(analysis.reason!, analysis.message!, { issues: analysis.issues, blockingElements: analysis.blockingElements });
  if (input.rows === input.layout.rows && input.columns === input.layout.columns) {
    return { ok: true, operation: 'noop', layout: cloneLayout(input.layout), analysis };
  }

  const retained = input.layout.elements
    .filter((element) => element.type !== 'empty' || isFullyWithin(element, input.rows, input.columns))
    .map((element) => ({ ...element }));
  const occupied = new Set<string>();
  retained.forEach((element) => occupiedCoordinates(element).forEach(([row, column]) => occupied.add(`${row}:${column}`)));
  const usedIds = new Set(retained.map((element) => element.id));
  const generated: LayoutElement[] = [];
  for (let row = 1; row <= input.rows; row += 1) {
    for (let column = 1; column <= input.columns; column += 1) {
      if (occupied.has(`${row}:${column}`)) continue;
      const id = `${input.emptyElementIdPrefix}:${row}:${column}`;
      if (usedIds.has(id)) return failure('invalid_result', 'ID sel kosong yang dihasilkan duplikat.');
      usedIds.add(id);
      generated.push(emptyElement(input.layout.id, id, row, column));
    }
  }
  const next: LaboratoryLayout = { ...input.layout, rows: input.rows, columns: input.columns, elements: [...retained, ...generated], updatedAt: input.updatedAt };
  const validation = validateLaboratoryLayout(next);
  return validation.valid
    ? { ok: true, operation: 'resized', layout: next, analysis }
    : failure('invalid_result', 'Perubahan ukuran menghasilkan denah tidak valid.', { issues: validation.issues });
}
