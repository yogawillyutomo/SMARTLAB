import type { ID, LaboratoryLayout, LayoutElement } from '@/types';
import type {
  LayoutCoordinate,
  LayoutOperationFailureReason,
  LayoutOperationOptions,
  LayoutOperationResult,
  LayoutOperationSuccess,
} from './types';
import { isCoordinateInBounds, isSingleCell, validateLaboratoryLayout } from './validation';

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function failure(reason: LayoutOperationFailureReason, message: string, issues?: ReturnType<typeof validateLaboratoryLayout>['issues']): LayoutOperationResult {
  return { ok: false, reason, message, issues };
}

function success(
  layout: LaboratoryLayout,
  operation: LayoutOperationSuccess['operation'],
  sourceElementId: ID,
  targetElementId?: ID,
): LayoutOperationSuccess {
  return { ok: true, operation, layout, sourceElementId, targetElementId };
}

function isValidTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function findElementAt(layout: LaboratoryLayout, coordinate: LayoutCoordinate): LayoutElement | undefined {
  return layout.elements.find((element) => coordinate.row >= element.row
    && coordinate.row < element.row + element.rowSpan
    && coordinate.column >= element.column
    && coordinate.column < element.column + element.columnSpan);
}

function validLayoutOrFailure(layout: LaboratoryLayout): LayoutOperationResult | null {
  const validation = validateLaboratoryLayout(layout);
  return validation.valid ? null : failure('invalid_layout', 'Denah tidak valid dan tidak dapat diubah.', validation.issues);
}

function timestampedResult(
  layout: LaboratoryLayout,
  operation: Exclude<LayoutOperationSuccess['operation'], 'noop'>,
  sourceElementId: ID,
  targetElementId: ID,
  options: LayoutOperationOptions,
): LayoutOperationResult {
  if (!isValidTimestamp(options.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan operasi tidak valid.');
  const next = cloneLayout(layout);
  next.updatedAt = options.updatedAt;
  const validation = validateLaboratoryLayout(next);
  return validation.valid
    ? success(next, operation, sourceElementId, targetElementId)
    : failure('invalid_result', 'Operasi menghasilkan denah tidak valid.', validation.issues);
}

export function swapLayoutElements(
  layout: LaboratoryLayout,
  firstElementId: ID,
  secondElementId: ID,
  options: LayoutOperationOptions,
): LayoutOperationResult {
  const invalidLayout = validLayoutOrFailure(layout);
  if (invalidLayout) return invalidLayout;
  const source = layout.elements.find((element) => element.id === firstElementId);
  if (!source) return failure('source_not_found', 'Elemen sumber yang akan ditukar tidak ditemukan.');
  const target = layout.elements.find((element) => element.id === secondElementId);
  if (!target) return failure('target_not_found', 'Elemen target yang akan ditukar tidak ditemukan.');
  if (!isSingleCell(source) || !isSingleCell(target)) return failure('spanning_move_not_supported', 'Swap hanya mendukung elemen satu sel.');
  if (source.type !== 'student_pc' || target.type !== 'student_pc' || !source.swappable || !target.swappable) {
    return failure('swap_not_allowed', 'Hanya student_pc yang dapat ditukar secara otomatis.');
  }
  if (source.fixed || target.fixed) return failure('swap_not_allowed', 'Elemen fixed tidak dapat ditukar.');
  if (!source.movable || !target.movable) return failure('swap_not_allowed', 'Elemen yang tidak movable tidak dapat ditukar.');
  if (source.id === target.id) return success(cloneLayout(layout), 'noop', source.id, target.id);

  const next = cloneLayout(layout);
  const nextFirst = next.elements.find((element) => element.id === source.id)!;
  const nextSecond = next.elements.find((element) => element.id === target.id)!;
  [nextFirst.row, nextSecond.row] = [nextSecond.row, nextFirst.row];
  [nextFirst.column, nextSecond.column] = [nextSecond.column, nextFirst.column];
  return timestampedResult(next, 'swapped', source.id, target.id, options);
}

export function moveLayoutElement(
  layout: LaboratoryLayout,
  sourceElementId: ID,
  target: LayoutCoordinate,
  options: LayoutOperationOptions,
): LayoutOperationResult {
  const invalidLayout = validLayoutOrFailure(layout);
  if (invalidLayout) return invalidLayout;
  const source = layout.elements.find((element) => element.id === sourceElementId);
  if (!source) return failure('source_not_found', 'Elemen sumber tidak ditemukan.');
  if (source.type === 'empty') return failure('source_is_empty', 'Elemen empty tidak dapat dipindahkan.');
  if (source.fixed) return failure('source_fixed', 'Elemen fixed tidak dapat dipindahkan.');
  if (!source.movable) return failure('source_not_movable', 'Elemen ini tidak dapat dipindahkan.');
  if (!isSingleCell(source)) return failure('spanning_move_not_supported', 'Perpindahan elemen multi-sel belum didukung.');
  if (!isCoordinateInBounds(layout, target)) return failure('invalid_target_coordinate', 'Koordinat target tidak valid.');
  if (source.row === target.row && source.column === target.column) return success(cloneLayout(layout), 'noop', source.id, source.id);

  const targetElement = findElementAt(layout, target);
  if (!targetElement) return failure('target_not_found', 'Target tidak memiliki elemen grid.');
  if (!isSingleCell(targetElement)) return failure('spanning_move_not_supported', 'Target elemen multi-sel belum didukung.');
  if (targetElement.type === 'empty') {
    const next = cloneLayout(layout);
    const nextSource = next.elements.find((element) => element.id === source.id)!;
    const nextTarget = next.elements.find((element) => element.id === targetElement.id)!;
    [nextSource.row, nextTarget.row] = [nextTarget.row, nextSource.row];
    [nextSource.column, nextTarget.column] = [nextTarget.column, nextSource.column];
    return timestampedResult(next, 'moved', source.id, targetElement.id, options);
  }
  if (source.type === 'student_pc' && targetElement.type === 'student_pc') {
    return swapLayoutElements(layout, source.id, targetElement.id, options);
  }
  if (source.type === 'student_pc') return failure('incompatible_target', 'student_pc tidak dapat menimpa elemen non-PC.');
  return failure('occupied_target', 'Elemen non-PC hanya dapat dipindahkan ke slot empty.');
}
