import type { ID, LaboratoryLayout, LayoutElement } from '@/types';
import type { LayoutValidationIssue } from './types';
import {
  getLayoutElementGeometryCapabilities,
  isFootprintInBounds,
  reconcileElementFootprint,
  type FootprintCollision,
} from './geometry';
import { isPositiveInteger, validateLaboratoryLayout } from './validation';

export type GeometryOperationFailureReason =
  | 'invalid_layout'
  | 'geometry_not_custom'
  | 'element_not_found'
  | 'geometry_not_supported'
  | 'invalid_span'
  | 'geometry_out_of_bounds'
  | 'geometry_collision'
  | 'invalid_empty_element_id_prefix'
  | 'invalid_timestamp'
  | 'invalid_result';

export type UpdateLayoutElementGeometryResult =
  | { ok: true; operation: 'updated' | 'noop'; layout: LaboratoryLayout; element: LayoutElement }
  | { ok: false; reason: GeometryOperationFailureReason; message: string; issues?: LayoutValidationIssue[]; collisions?: FootprintCollision[] };

export interface UpdateLayoutElementGeometryInput {
  layout: LaboratoryLayout;
  elementId: ID;
  rowSpan: number;
  columnSpan: number;
  updatedAt: string;
  emptyElementIdPrefix?: string;
}

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function failure(
  reason: GeometryOperationFailureReason,
  message: string,
  options: Pick<Extract<UpdateLayoutElementGeometryResult, { ok: false }>, 'issues' | 'collisions'> = {},
): UpdateLayoutElementGeometryResult {
  return { ok: false, reason, message, ...options };
}

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

export function updateLayoutElementGeometry(input: UpdateLayoutElementGeometryInput): UpdateLayoutElementGeometryResult {
  const sourceValidation = validateLaboratoryLayout(input.layout);
  if (!sourceValidation.valid) return failure('invalid_layout', 'Denah tidak valid dan ukuran elemen tidak dapat diubah.', { issues: sourceValidation.issues });
  if (input.layout.layoutType !== 'custom') return failure('geometry_not_custom', 'Ubah denah menjadi Custom untuk mengedit ukuran elemen.');
  const source = input.layout.elements.find((element) => element.id === input.elementId);
  if (!source) return failure('element_not_found', 'Elemen yang dipilih tidak ditemukan.');
  const capabilities = getLayoutElementGeometryCapabilities(input.layout, source);
  if (!capabilities.resizable) return failure('geometry_not_supported', 'Jenis elemen ini menggunakan ukuran tetap 1 × 1.');
  if (!isPositiveInteger(input.rowSpan) || !isPositiveInteger(input.columnSpan)) return failure('invalid_span', 'Rentang baris dan kolom harus berupa bilangan bulat positif.');
  if (source.rowSpan === input.rowSpan && source.columnSpan === input.columnSpan) {
    const layout = cloneLayout(input.layout);
    return { ok: true, operation: 'noop', layout, element: layout.elements.find((element) => element.id === source.id)! };
  }
  const nextFootprint = { row: source.row, column: source.column, rowSpan: input.rowSpan, columnSpan: input.columnSpan };
  if (!isFootprintInBounds(input.layout, nextFootprint)) return failure('geometry_out_of_bounds', 'Ukuran elemen melewati batas grid.');
  if (!input.emptyElementIdPrefix?.trim()) return failure('invalid_empty_element_id_prefix', 'Prefix ID sel kosong wajib diisi.');
  if (!validTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan ukuran elemen tidak valid.');

  const reconciliation = reconcileElementFootprint(input.layout, source, nextFootprint, input.emptyElementIdPrefix);
  if (!reconciliation.ok) {
    if (reconciliation.reason === 'collision') return failure('geometry_collision', 'Ukuran elemen bertabrakan dengan elemen lain.', { collisions: reconciliation.collisions });
    if (reconciliation.reason === 'duplicate_empty_id') return failure('invalid_empty_element_id_prefix', 'Prefix menghasilkan ID sel kosong duplikat.');
    return failure('invalid_result', 'Koordinat grid untuk perubahan ukuran tidak ditemukan.');
  }
  const layout: LaboratoryLayout = { ...input.layout, elements: reconciliation.elements, updatedAt: input.updatedAt };
  const resultValidation = validateLaboratoryLayout(layout);
  if (!resultValidation.valid) return failure('invalid_result', 'Perubahan ukuran menghasilkan denah tidak valid.', { issues: resultValidation.issues });
  return { ok: true, operation: 'updated', layout, element: layout.elements.find((element) => element.id === source.id)! };
}
