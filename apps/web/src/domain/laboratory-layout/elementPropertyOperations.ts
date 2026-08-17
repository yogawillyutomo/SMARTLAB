import type { LaboratoryLayout, LayoutElement, LayoutElementType, LayoutRotation } from '@/types';
import type { LayoutValidationIssue } from './types';
import { validateLaboratoryLayout } from './validation';

export const LAYOUT_ELEMENT_LABEL_MAX_LENGTH = 60;
export const LAYOUT_ELEMENT_ROTATIONS: readonly LayoutRotation[] = [0, 90, 180, 270];

export const LAYOUT_ELEMENT_TYPE_DISPLAY_NAMES: Record<LayoutElementType, string> = {
  student_pc: 'PC Siswa',
  teacher_pc: 'PC Guru',
  teacher_desk: 'Meja Guru',
  projector: 'Projector',
  printer: 'Printer',
  network_switch: 'Network Switch',
  access_point: 'Access Point',
  door: 'Pintu',
  window: 'Jendela',
  wall: 'Dinding',
  aisle: 'Jalur',
  label: 'Label',
  empty: 'Sel kosong',
};

const LABEL_EDITABLE_TYPES: readonly LayoutElementType[] = ['teacher_desk', 'printer', 'network_switch', 'access_point', 'door', 'window', 'wall', 'label'];
const ROTATION_EDITABLE_TYPES: readonly LayoutElementType[] = ['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'];
const LOCK_EDITABLE_TYPES: readonly LayoutElementType[] = ['teacher_desk', 'printer', 'network_switch', 'access_point', 'door', 'window', 'wall', 'aisle', 'label'];
const DEVICE_MANAGED_TYPES: readonly LayoutElementType[] = ['student_pc', 'teacher_pc'];

export interface LayoutElementPropertyCapabilities {
  editable: boolean;
  labelEditable: boolean;
  rotationEditable: boolean;
  lockEditable: boolean;
  reason?: 'property_edit_not_custom' | 'device_element_managed' | 'empty_element_not_editable' | 'element_not_editable';
}

export interface LayoutElementPropertyPatch {
  label?: string;
  rotation?: LayoutRotation | number;
  locked?: boolean;
}

export type ElementPropertyFailureReason =
  | 'invalid_layout'
  | 'property_edit_not_custom'
  | 'element_not_found'
  | 'element_not_editable'
  | 'device_element_managed'
  | 'empty_element_not_editable'
  | 'unsupported_property'
  | 'invalid_label'
  | 'invalid_rotation'
  | 'invalid_lock_state'
  | 'invalid_timestamp'
  | 'invalid_result';

export type UpdateLayoutElementPropertiesResult =
  | { ok: true; operation: 'updated' | 'noop'; layout: LaboratoryLayout; element: LayoutElement }
  | { ok: false; reason: ElementPropertyFailureReason; message: string; issues?: LayoutValidationIssue[] };

export interface UpdateLayoutElementPropertiesInput {
  layout: LaboratoryLayout;
  elementId: string;
  patch: LayoutElementPropertyPatch;
  updatedAt: string;
}

function includesType(types: readonly LayoutElementType[], type: LayoutElementType): boolean {
  return types.includes(type);
}

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function failure(reason: ElementPropertyFailureReason, message: string, issues?: LayoutValidationIssue[]): UpdateLayoutElementPropertiesResult {
  return { ok: false, reason, message, issues };
}

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

export function getLayoutElementPropertyCapabilities(
  layout: Pick<LaboratoryLayout, 'layoutType'>,
  element: Pick<LayoutElement, 'type'>,
): LayoutElementPropertyCapabilities {
  if (includesType(DEVICE_MANAGED_TYPES, element.type)) {
    return { editable: false, labelEditable: false, rotationEditable: false, lockEditable: false, reason: 'device_element_managed' };
  }
  if (element.type === 'empty') {
    return { editable: false, labelEditable: false, rotationEditable: false, lockEditable: false, reason: 'empty_element_not_editable' };
  }
  if (layout.layoutType !== 'custom') {
    return { editable: false, labelEditable: false, rotationEditable: false, lockEditable: false, reason: 'property_edit_not_custom' };
  }
  const labelEditable = includesType(LABEL_EDITABLE_TYPES, element.type);
  const rotationEditable = includesType(ROTATION_EDITABLE_TYPES, element.type);
  const lockEditable = includesType(LOCK_EDITABLE_TYPES, element.type);
  const editable = labelEditable || rotationEditable || lockEditable;
  return { editable, labelEditable, rotationEditable, lockEditable, ...(!editable ? { reason: 'element_not_editable' as const } : {}) };
}

export function updateLayoutElementProperties(input: UpdateLayoutElementPropertiesInput): UpdateLayoutElementPropertiesResult {
  const sourceValidation = validateLaboratoryLayout(input.layout);
  if (!sourceValidation.valid) return failure('invalid_layout', 'Denah tidak valid dan properti tidak dapat diubah.', sourceValidation.issues);
  const source = input.layout.elements.find((element) => element.id === input.elementId);
  if (!source) return failure('element_not_found', 'Elemen yang dipilih tidak ditemukan.');
  const capabilities = getLayoutElementPropertyCapabilities(input.layout, source);
  if (!capabilities.editable) {
    const messages: Record<NonNullable<LayoutElementPropertyCapabilities['reason']>, string> = {
      property_edit_not_custom: 'Ubah denah menjadi Custom untuk mengedit properti elemen.',
      device_element_managed: 'Properti elemen PC dikelola dari Data Perangkat.',
      empty_element_not_editable: 'Sel kosong tidak memiliki properti yang dapat diedit.',
      element_not_editable: 'Jenis elemen ini belum mendukung pengeditan properti.',
    };
    return failure(capabilities.reason!, messages[capabilities.reason!]);
  }

  if (hasOwn(input.patch, 'label') && !capabilities.labelEditable) return failure('unsupported_property', 'Label tidak dapat diubah untuk jenis elemen ini.');
  if (hasOwn(input.patch, 'rotation') && !capabilities.rotationEditable) return failure('unsupported_property', 'Rotasi tidak dapat diubah untuk jenis elemen ini.');
  if (hasOwn(input.patch, 'locked') && !capabilities.lockEditable) return failure('unsupported_property', 'Status posisi tidak dapat diubah untuk jenis elemen ini.');
  if (hasOwn(input.patch, 'locked') && typeof input.patch.locked !== 'boolean') return failure('invalid_lock_state', 'Status posisi harus Dapat dipindahkan atau Terkunci.');

  let normalizedLabel = source.label;
  if (hasOwn(input.patch, 'label')) {
    const trimmed = input.patch.label?.trim() ?? '';
    if (trimmed.length > LAYOUT_ELEMENT_LABEL_MAX_LENGTH) return failure('invalid_label', `Label maksimal ${LAYOUT_ELEMENT_LABEL_MAX_LENGTH} karakter.`);
    if (source.type === 'label' && !trimmed) return failure('invalid_label', 'Teks label wajib diisi.');
    normalizedLabel = trimmed || undefined;
  }
  let normalizedRotation = source.rotation;
  if (hasOwn(input.patch, 'rotation')) {
    if (!LAYOUT_ELEMENT_ROTATIONS.includes(input.patch.rotation as LayoutRotation)) return failure('invalid_rotation', 'Rotasi harus 0°, 90°, 180°, atau 270°.');
    normalizedRotation = input.patch.rotation as LayoutRotation;
  }
  const normalizedFixed = hasOwn(input.patch, 'locked') ? input.patch.locked! : source.fixed;
  const normalizedMovable = hasOwn(input.patch, 'locked') ? !input.patch.locked! : source.movable;

  if (normalizedLabel === source.label && normalizedRotation === source.rotation && normalizedFixed === source.fixed && normalizedMovable === source.movable) {
    const layout = cloneLayout(input.layout);
    return { ok: true, operation: 'noop', layout, element: layout.elements.find((element) => element.id === source.id)! };
  }
  if (!validTimestamp(input.updatedAt)) return failure('invalid_timestamp', 'Waktu pembaruan properti tidak valid.');

  const layout = cloneLayout(input.layout);
  const element = layout.elements.find((candidate) => candidate.id === source.id)!;
  if (normalizedLabel === undefined) delete element.label;
  else element.label = normalizedLabel;
  element.rotation = normalizedRotation;
  element.fixed = normalizedFixed;
  element.movable = normalizedMovable;
  layout.updatedAt = input.updatedAt;
  const resultValidation = validateLaboratoryLayout(layout);
  return resultValidation.valid
    ? { ok: true, operation: 'updated', layout, element }
    : failure('invalid_result', 'Perubahan properti menghasilkan denah tidak valid.', resultValidation.issues);
}
