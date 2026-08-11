import type { ID, LaboratoryLayout, LaboratoryLayoutType, LayoutElement, LayoutElementType } from '@/types';
import type { LayoutCoordinate } from './types';
import { isCoordinateInBounds, isSingleCell, validateLaboratoryLayout } from './validation';

export const PALETTE_PLACEABLE_ELEMENT_TYPES = [
  'teacher_desk',
  'printer',
  'network_switch',
  'access_point',
  'door',
  'window',
  'wall',
  'aisle',
  'label',
] as const;

export type PalettePlaceableElementType = (typeof PALETTE_PLACEABLE_ELEMENT_TYPES)[number];

export const PALETTE_DEVICE_MANAGED_ELEMENT_TYPES = ['student_pc', 'teacher_pc'] as const;

export const PALETTE_ELEMENT_DISPLAY_NAMES: Record<PalettePlaceableElementType, string> = {
  teacher_desk: 'Meja Guru',
  printer: 'Printer',
  network_switch: 'Network Switch',
  access_point: 'Access Point',
  door: 'Pintu',
  window: 'Jendela',
  wall: 'Dinding',
  aisle: 'Jalur',
  label: 'Label',
};

export const LABORATORY_LAYOUT_TYPE_DISPLAY_NAMES: Record<LaboratoryLayoutType, string> = {
  'grid-classic': 'Grid Klasik',
  'perimeter-center-island': 'Perimeter + Center Island',
  'u-shape': 'U-Shape',
  'facing-rows': 'Facing Rows',
  custom: 'Custom',
};

export interface PaletteElementDefaults {
  type: PalettePlaceableElementType;
  label?: string;
  rowSpan: 1;
  columnSpan: 1;
  rotation: 0;
  fixed: false;
  movable: true;
  swappable: false;
}

export type PaletteOperationFailureReason =
  | 'invalid_layout'
  | 'palette_edit_not_allowed'
  | 'unsupported_palette_type'
  | 'invalid_target_coordinate'
  | 'target_not_found'
  | 'target_occupied'
  | 'element_not_found'
  | 'element_not_removable'
  | 'source_fixed'
  | 'pc_element_managed'
  | 'invalid_label'
  | 'invalid_timestamp'
  | 'invalid_result';

export type PaletteOperationResult =
  | { ok: true; operation: 'placed' | 'removed'; layout: LaboratoryLayout; elementId: ID; replacedElementId: ID }
  | { ok: false; reason: PaletteOperationFailureReason; message: string; issues?: ReturnType<typeof validateLaboratoryLayout>['issues'] };

export interface PlaceLayoutElementInput {
  layout: LaboratoryLayout;
  type: LayoutElementType;
  target: LayoutCoordinate;
  elementId: ID;
  updatedAt: string;
  label?: string;
}

export interface RemoveLayoutElementInput {
  layout: LaboratoryLayout;
  elementId: ID;
  emptyElementId: ID;
  updatedAt: string;
}

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function isValidTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isPlaceableType(type: LayoutElementType): type is PalettePlaceableElementType {
  return (PALETTE_PLACEABLE_ELEMENT_TYPES as readonly string[]).includes(type);
}

function isDeviceManagedType(type: LayoutElementType): boolean {
  return (PALETTE_DEVICE_MANAGED_ELEMENT_TYPES as readonly string[]).includes(type);
}

function findElementAt(layout: LaboratoryLayout, target: LayoutCoordinate): LayoutElement | undefined {
  return layout.elements.find((element) => target.row >= element.row
    && target.row < element.row + element.rowSpan
    && target.column >= element.column
    && target.column < element.column + element.columnSpan);
}

function failure(reason: PaletteOperationFailureReason, message: string, issues?: ReturnType<typeof validateLaboratoryLayout>['issues']): PaletteOperationResult {
  return { ok: false, reason, message, issues };
}

function validLayoutOrFailure(layout: LaboratoryLayout): PaletteOperationResult | null {
  const validation = validateLaboratoryLayout(layout);
  return validation.valid ? null : failure('invalid_layout', 'Denah tidak valid dan tidak dapat diubah.', validation.issues);
}

export function canEditLayoutStructure(layout: Pick<LaboratoryLayout, 'layoutType'>): boolean {
  return layout.layoutType === 'grid-classic' || layout.layoutType === 'custom';
}

export function getPaletteElementDefaults(type: PalettePlaceableElementType, label?: string): PaletteElementDefaults {
  const trimmedLabel = label?.trim();
  return {
    type,
    ...(type === 'label' ? { label: trimmedLabel } : type === 'aisle' ? {} : { label: PALETTE_ELEMENT_DISPLAY_NAMES[type] }),
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    fixed: false,
    movable: true,
    swappable: false,
  };
}

export function placeLayoutElement(input: PlaceLayoutElementInput): PaletteOperationResult {
  const invalidLayout = validLayoutOrFailure(input.layout);
  if (invalidLayout) return invalidLayout;
  if (!isValidTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan operasi tidak valid.');
  if (!canEditLayoutStructure(input.layout)) return failure('palette_edit_not_allowed', 'Struktur template fisik terkunci. Gunakan Custom Editor untuk mengubahnya.');
  if (isDeviceManagedType(input.type)) return failure('pc_element_managed', 'Elemen PC dikelola dari Data Perangkat.');
  if (!isPlaceableType(input.type)) return failure('unsupported_palette_type', 'Jenis elemen tidak tersedia di Element Palette.');
  if (!input.elementId?.trim() || input.layout.elements.some((element) => element.id === input.elementId)) return failure('invalid_result', 'ID elemen baru tidak valid.');
  if (!isCoordinateInBounds(input.layout, input.target)) return failure('invalid_target_coordinate', 'Koordinat target tidak valid.');
  const target = findElementAt(input.layout, input.target);
  if (!target) return failure('target_not_found', 'Target tidak memiliki elemen grid.');
  if (target.type !== 'empty' || !isSingleCell(target)) return failure('target_occupied', 'Elemen baru hanya dapat ditempatkan pada sel kosong.');
  const label = input.label?.trim();
  if (input.type === 'label' && !label) return failure('invalid_label', 'Teks label wajib diisi.');

  const next = cloneLayout(input.layout);
  const elementIndex = next.elements.findIndex((element) => element.id === target.id);
  const defaults = getPaletteElementDefaults(input.type, label);
  next.elements[elementIndex] = {
    id: input.elementId,
    layoutId: next.id,
    ...defaults,
    row: target.row,
    column: target.column,
  };
  next.updatedAt = input.updatedAt;
  const validation = validateLaboratoryLayout(next);
  return validation.valid
    ? { ok: true, operation: 'placed', layout: next, elementId: input.elementId, replacedElementId: target.id }
    : failure('invalid_result', 'Penempatan menghasilkan denah tidak valid.', validation.issues);
}

export function removeLayoutElement(input: RemoveLayoutElementInput): PaletteOperationResult {
  const invalidLayout = validLayoutOrFailure(input.layout);
  if (invalidLayout) return invalidLayout;
  if (!isValidTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan operasi tidak valid.');
  if (!canEditLayoutStructure(input.layout)) return failure('palette_edit_not_allowed', 'Struktur template fisik terkunci. Gunakan Custom Editor untuk mengubahnya.');
  const source = input.layout.elements.find((element) => element.id === input.elementId);
  if (!source) return failure('element_not_found', 'Elemen yang akan dihapus tidak ditemukan.');
  if (source.type === 'empty') return failure('element_not_removable', 'Sel kosong tidak dapat dihapus.');
  if (isDeviceManagedType(source.type)) return failure('pc_element_managed', 'Elemen PC dikelola dari Data Perangkat dan tidak dapat dihapus dari denah.');
  if (source.fixed) return failure('source_fixed', 'Elemen fixed tidak dapat dihapus.');
  if (!isSingleCell(source)) return failure('element_not_removable', 'Penghapusan elemen multi-sel belum didukung.');
  if (!input.emptyElementId?.trim() || input.layout.elements.some((element) => element.id === input.emptyElementId)) return failure('invalid_result', 'ID sel kosong baru tidak valid.');

  const next = cloneLayout(input.layout);
  const sourceIndex = next.elements.findIndex((element) => element.id === source.id);
  next.elements[sourceIndex] = {
    id: input.emptyElementId,
    layoutId: next.id,
    type: 'empty',
    row: source.row,
    column: source.column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: false,
    swappable: false,
    fixed: false,
  };
  next.updatedAt = input.updatedAt;
  const validation = validateLaboratoryLayout(next);
  return validation.valid
    ? { ok: true, operation: 'removed', layout: next, elementId: source.id, replacedElementId: input.emptyElementId }
    : failure('invalid_result', 'Penghapusan menghasilkan denah tidak valid.', validation.issues);
}
