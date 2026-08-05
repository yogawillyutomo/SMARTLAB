import type { ID, LaboratoryLayout, LayoutElement, LayoutRotation } from '@/types';
import type { LayoutCoordinate, LayoutValidationIssue, LayoutValidationResult } from './types';

const ROTATIONS: readonly LayoutRotation[] = [0, 90, 180, 270];

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isCoordinateInBounds(layout: Pick<LaboratoryLayout, 'rows' | 'columns'>, coordinate: LayoutCoordinate): boolean {
  return isPositiveInteger(coordinate.row)
    && isPositiveInteger(coordinate.column)
    && coordinate.row <= layout.rows
    && coordinate.column <= layout.columns;
}

export function isSingleCell(element: LayoutElement): boolean {
  return element.rowSpan === 1 && element.columnSpan === 1;
}

export function validateLaboratoryLayout(layout: LaboratoryLayout): LayoutValidationResult {
  const issues: LayoutValidationIssue[] = [];
  if (!hasText(layout.id)) issues.push({ code: 'invalid-layout-id', message: 'ID denah wajib diisi.' });
  if (!hasText(layout.laboratoryId)) issues.push({ code: 'invalid-laboratory-id', message: 'ID laboratorium wajib diisi.' });
  if (!hasText(layout.name)) issues.push({ code: 'invalid-layout-name', message: 'Nama denah wajib diisi.' });
  if (!isPositiveInteger(layout.rows) || !isPositiveInteger(layout.columns)) {
    issues.push({ code: 'invalid-grid-dimensions', message: 'Baris dan kolom denah harus berupa bilangan bulat positif.' });
  }
  if (!isPositiveInteger(layout.version)) issues.push({ code: 'invalid-layout-version', message: 'Versi denah harus berupa bilangan bulat positif.' });
  if (layout.status === 'archived' && layout.isActive) {
    issues.push({ code: 'archived-layout-active', message: 'Denah terarsip tidak boleh aktif.' });
  }
  if (layout.status === 'active' && !layout.isActive) {
    issues.push({ code: 'active-layout-inactive', message: 'Denah berstatus aktif harus ditandai aktif.' });
  }
  if (layout.status === 'draft' && layout.isActive) {
    issues.push({ code: 'draft-layout-active', message: 'Denah draft tidak boleh aktif.' });
  }

  const elementIds = new Set<ID>();
  const referenceIds = new Set<ID>();
  const occupiedCells = new Map<string, ID>();
  for (const element of layout.elements) {
    if (!hasText(element.id)) {
      issues.push({ code: 'invalid-element-id', message: 'ID elemen wajib diisi.' });
    } else if (elementIds.has(element.id)) {
      issues.push({ code: 'duplicate-element-id', message: 'ID elemen tidak boleh duplikat.', elementId: element.id });
    } else {
      elementIds.add(element.id);
    }
    if (element.layoutId !== layout.id) issues.push({ code: 'layout-id-mismatch', message: 'Elemen harus merujuk ke denah yang sama.', elementId: element.id });
    if (element.fixed && element.movable) issues.push({ code: 'fixed-element-movable', message: 'Elemen fixed tidak boleh movable.', elementId: element.id });

    const referenceId = element.referenceId?.trim();
    if (element.type === 'empty' && element.referenceId !== undefined) {
      issues.push({ code: 'empty-element-has-reference', message: 'Elemen empty tidak boleh memiliki referensi.', elementId: element.id });
    } else if ((element.type === 'student_pc' || element.type === 'teacher_pc') && !referenceId) {
      issues.push({ code: 'missing-device-reference', message: 'Elemen PC harus memiliki ID perangkat.', elementId: element.id });
    } else if (element.referenceId !== undefined && !referenceId) {
      issues.push({ code: 'invalid-reference-id', message: 'ID referensi elemen tidak boleh kosong.', elementId: element.id });
    }
    if (referenceId) {
      if (referenceIds.has(referenceId)) {
        issues.push({ code: 'duplicate-reference-id', message: 'ID referensi elemen tidak boleh duplikat.', elementId: element.id });
      } else {
        referenceIds.add(referenceId);
      }
    }

    if (!isPositiveInteger(element.row) || !isPositiveInteger(element.column)) {
      issues.push({ code: 'invalid-coordinate', message: 'Koordinat elemen harus berupa bilangan bulat positif.', elementId: element.id });
      continue;
    }
    if (!isPositiveInteger(element.rowSpan) || !isPositiveInteger(element.columnSpan)) {
      issues.push({ code: 'invalid-span', message: 'Rentang elemen harus berupa bilangan bulat positif.', elementId: element.id });
      continue;
    }
    if (!ROTATIONS.includes(element.rotation)) issues.push({ code: 'invalid-rotation', message: 'Rotasi elemen tidak didukung.', elementId: element.id });

    const lastRow = element.row + element.rowSpan - 1;
    const lastColumn = element.column + element.columnSpan - 1;
    if (lastRow > layout.rows || lastColumn > layout.columns) {
      issues.push({ code: 'element-out-of-bounds', message: 'Elemen berada di luar batas grid.', elementId: element.id });
      continue;
    }
    for (let row = element.row; row <= lastRow; row += 1) {
      for (let column = element.column; column <= lastColumn; column += 1) {
        const key = cellKey(row, column);
        if (occupiedCells.has(key)) {
          issues.push({ code: 'duplicate-cell-occupancy', message: 'Satu sel hanya boleh ditempati oleh satu elemen.', elementId: element.id, coordinate: { row, column } });
        } else {
          occupiedCells.set(key, element.id);
        }
      }
    }
  }

  if (isPositiveInteger(layout.rows) && isPositiveInteger(layout.columns)) {
    for (let row = 1; row <= layout.rows; row += 1) {
      for (let column = 1; column <= layout.columns; column += 1) {
        if (!occupiedCells.has(cellKey(row, column))) {
          issues.push({ code: 'incomplete-grid', message: 'Setiap sel grid harus direpresentasikan, termasuk sel kosong.', coordinate: { row, column } });
        }
      }
    }
  }
  return { valid: issues.length === 0, issues };
}
