import type { Device, ID, Laboratory, LaboratoryLayout, LayoutElement } from '@/types';
import { validateLaboratoryLayout } from '../validation';

export type PhysicalLayoutTemplateId = 'rpl-perimeter-center-island-36';

export interface PhysicalLayoutTemplateDefinition {
  id: PhysicalLayoutTemplateId;
  name: string;
  description: string;
  layoutType: 'perimeter-center-island';
  rows: number;
  columns: number;
  requiredStudentPcCount: number;
  requiredTeacherPcCount: number;
  requiredTotalDeviceCount: number;
}

export const RPL_PERIMETER_CENTER_ISLAND_36: PhysicalLayoutTemplateDefinition = {
  id: 'rpl-perimeter-center-island-36',
  name: 'Perimeter + Center Island — 36 PC',
  description: 'Denah fisik dengan 36 PC siswa, 1 PC Guru, dua area tengah, perimeter kiri/kanan, jalur utama, dan pintu masuk.',
  layoutType: 'perimeter-center-island', rows: 11, columns: 7,
  requiredStudentPcCount: 36, requiredTeacherPcCount: 1, requiredTotalDeviceCount: 37,
};

export const PHYSICAL_LAYOUT_TEMPLATE_REGISTRY: readonly PhysicalLayoutTemplateDefinition[] = [RPL_PERIMETER_CENTER_ISLAND_36];

export function getPhysicalLayoutTemplate(templateId: PhysicalLayoutTemplateId): PhysicalLayoutTemplateDefinition {
  return PHYSICAL_LAYOUT_TEMPLATE_REGISTRY.find((template) => template.id === templateId) ?? RPL_PERIMETER_CENTER_ISLAND_36;
}

export type TemplateCompatibilityIssueCode =
  | 'laboratory-not-found'
  | 'invalid-device-count'
  | 'teacher-device-required'
  | 'teacher-device-not-found'
  | 'teacher-device-wrong-laboratory'
  | 'student-device-count-mismatch'
  | 'invalid-device-id'
  | 'active-layout-invalid'
  | 'invalid-timestamp';

export interface TemplateCompatibilityIssue { code: TemplateCompatibilityIssueCode; message: string; deviceId?: ID; }
export interface TemplateCompatibilityResult { compatible: boolean; issues: TemplateCompatibilityIssue[]; }
export interface GeneratePhysicalLayoutTemplateInput {
  templateId: PhysicalLayoutTemplateId;
  laboratory?: Laboratory;
  activeLayout: LaboratoryLayout;
  devices: readonly Device[];
  teacherDeviceId?: ID;
  updatedAt: string;
}
export type GeneratePhysicalLayoutTemplateResult =
  | { ok: true; layout: LaboratoryLayout }
  | { ok: false; issues: TemplateCompatibilityIssue[] };

const STUDENT_SLOTS: readonly [number, number, number][] = [
  ...Array.from({ length: 9 }, (_, index) => [index + 1, index + 3, 7] as [number, number, number]),
  ...Array.from({ length: 9 }, (_, index) => [18 - index, index + 3, 4] as [number, number, number]),
  ...Array.from({ length: 9 }, (_, index) => [index + 19, index + 3, 3] as [number, number, number]),
  ...Array.from({ length: 9 }, (_, index) => [36 - index, index + 3, 1] as [number, number, number]),
];
const STUDENT_SLOT_KEYS = new Set(STUDENT_SLOTS.map(([, row, column]) => `${row}:${column}`));
const AISLE_SLOT_KEYS = new Set<string>([
  ...Array.from({ length: 5 }, (_, index) => `1:${index + 2}`),
  ...Array.from({ length: 7 }, (_, index) => `2:${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `${index + 3}:2`),
  ...Array.from({ length: 9 }, (_, index) => `${index + 3}:5`),
  ...Array.from({ length: 9 }, (_, index) => `${index + 3}:6`),
]);

function validTimestamp(value: string): boolean { return value.trim().length > 0 && !Number.isNaN(Date.parse(value)); }
function key(row: number, column: number): string { return `${row}:${column}`; }
function fixedElement(id: ID, layoutId: ID, type: LayoutElement['type'], row: number, column: number, label?: string): LayoutElement {
  return { id, layoutId, type, ...(label ? { label } : {}), row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: false, swappable: false, fixed: true };
}

export function sortTemplateStudentDevices(devices: readonly Device[]): Device[] {
  return [...devices].sort((left, right) => left.positionCode.localeCompare(right.positionCode, 'en', { numeric: true, sensitivity: 'base' }) || left.hostname.localeCompare(right.hostname, 'en', { numeric: true, sensitivity: 'base' }) || left.id.localeCompare(right.id));
}

export function checkPhysicalLayoutTemplateCompatibility(input: Omit<GeneratePhysicalLayoutTemplateInput, 'updatedAt' | 'activeLayout'>): TemplateCompatibilityResult {
  const definition = getPhysicalLayoutTemplate(input.templateId);
  const issues: TemplateCompatibilityIssue[] = [];
  const laboratory = input.laboratory;
  if (!laboratory) issues.push({ code: 'laboratory-not-found', message: 'Laboratorium tidak ditemukan.' });
  const labDevices = laboratory ? input.devices.filter((device) => device.laboratoryId === laboratory.id) : [];
  if (laboratory && labDevices.length !== definition.requiredTotalDeviceCount) issues.push({ code: 'invalid-device-count', message: `Template membutuhkan tepat ${definition.requiredTotalDeviceCount} perangkat. Laboratorium ini memiliki ${labDevices.length}.` });
  if (!input.teacherDeviceId?.trim()) issues.push({ code: 'teacher-device-required', message: 'Pilih perangkat yang digunakan sebagai PC Guru.' });
  const teacher = input.teacherDeviceId ? input.devices.find((device) => device.id === input.teacherDeviceId) : undefined;
  if (input.teacherDeviceId?.trim() && !teacher) issues.push({ code: 'teacher-device-not-found', message: 'Perangkat PC Guru tidak ditemukan.', deviceId: input.teacherDeviceId });
  if (teacher && laboratory && teacher.laboratoryId !== laboratory.id) issues.push({ code: 'teacher-device-wrong-laboratory', message: 'PC Guru harus berasal dari laboratorium yang sama.', deviceId: teacher.id });
  if (teacher && labDevices.filter((device) => device.id !== teacher.id).length !== definition.requiredStudentPcCount) issues.push({ code: 'student-device-count-mismatch', message: `Template membutuhkan ${definition.requiredStudentPcCount} PC siswa setelah PC Guru dipilih.` });
  labDevices.forEach((device) => { if (!device.id?.trim()) issues.push({ code: 'invalid-device-id', message: 'ID perangkat tidak valid.', deviceId: device.id }); });
  return { compatible: issues.length === 0, issues };
}

export function generatePhysicalLayoutTemplateDraft(input: GeneratePhysicalLayoutTemplateInput): GeneratePhysicalLayoutTemplateResult {
  if (!validTimestamp(input.updatedAt)) return { ok: false, issues: [{ code: 'invalid-timestamp', message: 'Waktu pembaruan template tidak valid.' }] };
  const compatibility = checkPhysicalLayoutTemplateCompatibility(input);
  if (!compatibility.compatible) return { ok: false, issues: compatibility.issues };
  const activeValidation = validateLaboratoryLayout(input.activeLayout);
  if (!activeValidation.valid) return { ok: false, issues: [{ code: 'active-layout-invalid', message: 'Template tidak dapat diterapkan karena denah aktif tidak valid.' }] };
  const definition = getPhysicalLayoutTemplate(input.templateId);
  const laboratory = input.laboratory!;
  const teacher = input.devices.find((device) => device.id === input.teacherDeviceId)!;
  const students = sortTemplateStudentDevices(input.devices.filter((device) => device.laboratoryId === laboratory.id && device.id !== teacher.id));
  const layoutId = input.activeLayout.id;
  const elements: LayoutElement[] = [
    { ...fixedElement(`${layoutId}:teacher:${teacher.id}`, layoutId, 'teacher_pc', 1, 1, 'PC Guru'), referenceId: teacher.id },
    fixedElement(`${layoutId}:door:entrance`, layoutId, 'door', 1, 7, 'Pintu Masuk'),
  ];
  for (let row = 1; row <= definition.rows; row += 1) for (let column = 1; column <= definition.columns; column += 1) {
    if (key(row, column) === '1:1' || key(row, column) === '1:7' || STUDENT_SLOT_KEYS.has(key(row, column))) continue;
    elements.push(fixedElement(`${layoutId}:aisle:${row}:${column}`, layoutId, 'aisle', row, column));
  }
  STUDENT_SLOTS.forEach(([studentNumber, row, column]) => {
    const device = students[studentNumber - 1];
    elements.push({ id: `${layoutId}:student:${device.id}`, layoutId, type: 'student_pc', referenceId: device.id, row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: true, swappable: true, fixed: false });
  });
  const layout: LaboratoryLayout = { ...input.activeLayout, layoutType: definition.layoutType, rows: definition.rows, columns: definition.columns, elements, updatedAt: input.updatedAt };
  const validation = validateLaboratoryLayout(layout);
  const structure = validatePhysicalLayoutTemplateStructure(layout);
  return validation.valid && structure.valid ? { ok: true, layout } : { ok: false, issues: [{ code: 'active-layout-invalid', message: 'Template fisik yang dihasilkan tidak valid.' }] };
}

export interface PhysicalTemplateStructureValidation { valid: boolean; issues: string[]; }
export function validatePhysicalLayoutTemplateStructure(layout: LaboratoryLayout): PhysicalTemplateStructureValidation {
  const issues: string[] = [];
  if (layout.layoutType !== 'perimeter-center-island' || layout.rows !== 11 || layout.columns !== 7 || layout.elements.length !== 77) issues.push('Dimensi atau jenis template fisik tidak sesuai.');
  const at = (row: number, column: number) => layout.elements.find((element) => element.row === row && element.column === column);
  const teacher = at(1, 1); const door = at(1, 7);
  if (!teacher || teacher.type !== 'teacher_pc' || !teacher.fixed || teacher.movable || teacher.swappable) issues.push('PC Guru harus berada tetap di depan kiri.');
  if (!door || door.type !== 'door' || !door.fixed || door.movable || door.swappable) issues.push('Pintu harus berada tetap di depan kanan.');
  for (let row = 1; row <= 11; row += 1) for (let column = 1; column <= 7; column += 1) {
    const element = at(row, column); const slot = key(row, column);
    if (!element) { issues.push('Grid template tidak lengkap.'); continue; }
    if (AISLE_SLOT_KEYS.has(slot) && (element.type !== 'aisle' || !element.fixed || element.movable || element.swappable)) issues.push('Jalur harus tetap dan tidak dapat dipindahkan.');
    if (STUDENT_SLOT_KEYS.has(slot) && (element.type !== 'student_pc' || element.fixed || !element.movable || !element.swappable)) issues.push('Slot siswa harus berisi student_pc yang dapat ditukar.');
    if (element.type === 'empty') issues.push('Template fisik tidak memiliki sel empty.');
  }
  if (layout.elements.filter((element) => element.type === 'student_pc').length !== 36) issues.push('Template harus memiliki 36 PC siswa.');
  if (layout.elements.filter((element) => element.type === 'teacher_pc').length !== 1 || layout.elements.filter((element) => element.type === 'door').length !== 1 || layout.elements.filter((element) => element.type === 'aisle').length !== 39) issues.push('Komposisi elemen template tidak sesuai.');
  return { valid: issues.length === 0, issues };
}

export const PHYSICAL_TEMPLATE_AISLE_SLOTS = AISLE_SLOT_KEYS;
