import type {
  DevicePlacementRole,
  LayoutRotation,
  StructuralLayoutElementType,
  UnplacedDeviceCandidateDto,
} from '@/services/layoutApi';
import type { DeviceType } from '@/services/deviceApi';
import type {
  CanonicalEditorDevicePlacement,
  CanonicalEditorStructuralElement,
  CanonicalLayoutEditorState,
  LayoutEditorFailure,
  LayoutEditorFailureCode,
  LayoutEditorResult,
  LayoutEditorSuccess,
  NewDevicePlacementInput,
  NewStructuralElementInput,
} from './types';
import {
  cloneLayoutEditorState,
  editorChildKey,
  isRoleCompatibleWithDevice,
  validateLayoutEditorState,
} from './validation';

function failure(code: LayoutEditorFailureCode, message: string): LayoutEditorFailure {
  return { ok: false, code, message };
}

function success(state: CanonicalLayoutEditorState, operation: LayoutEditorSuccess['operation']): LayoutEditorSuccess {
  return { ok: true, state, operation };
}

function validateEditable(state: CanonicalLayoutEditorState): LayoutEditorFailure | null {
  const validation = validateLayoutEditorState(state);
  if (!validation.valid) return failure('invalid_state', 'State Layout saat ini tidak valid.');
  if (state.status !== 'draft') return failure('not_editable', 'Hanya draft Layout yang dapat diedit.');
  return null;
}

function validatedResult(
  state: CanonicalLayoutEditorState,
  operation: LayoutEditorSuccess['operation'],
  clippingIsResizeFailure = false,
): LayoutEditorResult {
  const validation = validateLayoutEditorState(state);
  if (validation.valid) return success(state, operation);
  const issue = validation.issues[0];
  if (clippingIsResizeFailure && issue.code === 'out_of_bounds') {
    return failure('resize_clips_content', 'Ukuran Layout baru akan memotong footprint yang ada.');
  }
  return failure(issue.code, issue.message);
}

function allChildKeys(state: CanonicalLayoutEditorState): Set<string> {
  return new Set([
    ...state.structuralElements.map(editorChildKey),
    ...state.devicePlacements.map(editorChildKey),
  ]);
}

function structuralIndex(state: CanonicalLayoutEditorState, key: string): number {
  return state.structuralElements.findIndex((element) => editorChildKey(element) === key);
}

function placementIndex(state: CanonicalLayoutEditorState, key: string): number {
  return state.devicePlacements.findIndex((placement) => editorChildKey(placement) === key);
}

export function updateLayoutProperties(
  state: CanonicalLayoutEditorState,
  changes: { name?: string; templateKey?: string | null },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const name = changes.name ?? state.name;
  const templateKey = changes.templateKey === undefined ? state.templateKey : changes.templateKey;
  if (name === state.name && templateKey === state.templateKey) return success(cloneLayoutEditorState(state), 'noop');
  return validatedResult({ ...cloneLayoutEditorState(state), name, templateKey }, 'updated');
}

export function addStructuralElement(
  state: CanonicalLayoutEditorState,
  input: NewStructuralElementInput,
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  if (input.clientKey.trim() === '' || allChildKeys(state).has(input.clientKey)) {
    return failure('duplicate_client_key', 'Client key child baru harus terisi dan unik.');
  }
  const next = cloneLayoutEditorState(state);
  next.structuralElements.push({ ...input });
  return validatedResult(next, 'added');
}

export function removeStructuralElement(state: CanonicalLayoutEditorState, key: string): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = structuralIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Structural element tidak ditemukan.');
  const next = cloneLayoutEditorState(state);
  next.structuralElements.splice(index, 1);
  return validatedResult(next, 'removed');
}

export function updateStructuralElement(
  state: CanonicalLayoutEditorState,
  key: string,
  changes: { type?: StructuralLayoutElementType; label?: string | null; rotation?: LayoutRotation },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = structuralIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Structural element tidak ditemukan.');
  const current = state.structuralElements[index];
  const nextElement: CanonicalEditorStructuralElement = {
    ...current,
    type: changes.type ?? current.type,
    label: changes.label === undefined ? current.label : changes.label,
    rotation: changes.rotation ?? current.rotation,
  };
  if (nextElement.type === current.type && nextElement.label === current.label && nextElement.rotation === current.rotation) {
    return success(cloneLayoutEditorState(state), 'noop');
  }
  const next = cloneLayoutEditorState(state);
  next.structuralElements[index] = nextElement;
  return validatedResult(next, 'updated');
}

export function moveStructuralElement(
  state: CanonicalLayoutEditorState,
  key: string,
  target: { row: number; column: number },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = structuralIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Structural element tidak ditemukan.');
  const current = state.structuralElements[index];
  if (current.row === target.row && current.column === target.column) return success(cloneLayoutEditorState(state), 'noop');
  const next = cloneLayoutEditorState(state);
  next.structuralElements[index] = { ...next.structuralElements[index], ...target };
  return validatedResult(next, 'moved');
}

export function resizeStructuralElement(
  state: CanonicalLayoutEditorState,
  key: string,
  size: { rowSpan: number; columnSpan: number },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = structuralIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Structural element tidak ditemukan.');
  const current = state.structuralElements[index];
  if (current.rowSpan === size.rowSpan && current.columnSpan === size.columnSpan) return success(cloneLayoutEditorState(state), 'noop');
  const next = cloneLayoutEditorState(state);
  next.structuralElements[index] = { ...next.structuralElements[index], ...size };
  return validatedResult(next, 'resized');
}

export function addDevicePlacement(
  state: CanonicalLayoutEditorState,
  candidate: UnplacedDeviceCandidateDto,
  input: NewDevicePlacementInput,
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  if (input.clientKey.trim() === '' || allChildKeys(state).has(input.clientKey)) {
    return failure('duplicate_client_key', 'Client key child baru harus terisi dan unik.');
  }
  if (state.devicePlacements.some((placement) => placement.deviceId === candidate.id)) {
    return failure('duplicate_device', 'Device sudah ditempatkan dalam Layout ini.');
  }
  if (!isRoleCompatibleWithDevice(input.role, candidate.deviceType)) {
    return failure('invalid_role', 'Role station hanya valid untuk desktop PC atau laptop.');
  }
  const next = cloneLayoutEditorState(state);
  next.devicePlacements.push({
    clientKey: input.clientKey,
    deviceId: candidate.id,
    role: input.role,
    label: input.label,
    row: input.row,
    column: input.column,
    rowSpan: input.rowSpan,
    columnSpan: input.columnSpan,
    rotation: input.rotation,
  });
  return validatedResult(next, 'added');
}

export function removeDevicePlacement(state: CanonicalLayoutEditorState, key: string): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = placementIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Device placement tidak ditemukan.');
  const next = cloneLayoutEditorState(state);
  next.devicePlacements.splice(index, 1);
  return validatedResult(next, 'removed');
}

export function moveDevicePlacement(
  state: CanonicalLayoutEditorState,
  key: string,
  target: { row: number; column: number },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = placementIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Device placement tidak ditemukan.');
  const current = state.devicePlacements[index];
  if (current.row === target.row && current.column === target.column) return success(cloneLayoutEditorState(state), 'noop');
  const next = cloneLayoutEditorState(state);
  next.devicePlacements[index] = { ...next.devicePlacements[index], ...target };
  return validatedResult(next, 'moved');
}

export function resizeDevicePlacement(
  state: CanonicalLayoutEditorState,
  key: string,
  size: { rowSpan: number; columnSpan: number },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = placementIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Device placement tidak ditemukan.');
  const current = state.devicePlacements[index];
  if (current.rowSpan === size.rowSpan && current.columnSpan === size.columnSpan) return success(cloneLayoutEditorState(state), 'noop');
  const next = cloneLayoutEditorState(state);
  next.devicePlacements[index] = { ...next.devicePlacements[index], ...size };
  return validatedResult(next, 'resized');
}

export function updateDevicePlacement(
  state: CanonicalLayoutEditorState,
  key: string,
  changes: { role?: DevicePlacementRole; label?: string | null; rotation?: LayoutRotation },
  deviceType?: DeviceType,
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const index = placementIndex(state, key);
  if (index < 0) return failure('child_not_found', 'Device placement tidak ditemukan.');
  const current = state.devicePlacements[index];
  const role = changes.role === undefined ? current.role : changes.role;
  if (changes.role !== undefined && role !== null && deviceType === undefined) {
    return failure('device_type_required', 'Metadata jenis Device diperlukan untuk menetapkan role station.');
  }
  if (role !== null && deviceType !== undefined && !isRoleCompatibleWithDevice(role, deviceType)) {
    return failure('invalid_role', 'Role station hanya valid untuk desktop PC atau laptop.');
  }
  const nextPlacement: CanonicalEditorDevicePlacement = {
    ...current,
    role,
    label: changes.label === undefined ? current.label : changes.label,
    rotation: changes.rotation ?? current.rotation,
  };
  if (nextPlacement.role === current.role && nextPlacement.label === current.label && nextPlacement.rotation === current.rotation) {
    return success(cloneLayoutEditorState(state), 'noop');
  }
  const next = cloneLayoutEditorState(state);
  next.devicePlacements[index] = nextPlacement;
  return validatedResult(next, 'updated');
}

export function reassignPlacementDevice(
  state: CanonicalLayoutEditorState,
  key: string,
  _replacementDeviceId: string,
): LayoutEditorResult {
  void _replacementDeviceId;
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  if (placementIndex(state, key) < 0) return failure('child_not_found', 'Device placement tidak ditemukan.');
  return failure(
    'device_identity_immutable',
    'Device placement tidak dapat direassign. Hapus placement lama lalu buat placement baru tanpa server ID.',
  );
}

export function resizeLayout(
  state: CanonicalLayoutEditorState,
  dimensions: { rows: number; columns: number },
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  if (state.rows === dimensions.rows && state.columns === dimensions.columns) return success(cloneLayoutEditorState(state), 'noop');
  const next = { ...cloneLayoutEditorState(state), ...dimensions };
  return validatedResult(next, 'resized', true);
}

export function swapDevicePlacements(
  state: CanonicalLayoutEditorState,
  firstKey: string,
  secondKey: string,
): LayoutEditorResult {
  const invalid = validateEditable(state);
  if (invalid) return invalid;
  const firstIndex = placementIndex(state, firstKey);
  const secondIndex = placementIndex(state, secondKey);
  if (firstIndex < 0 || secondIndex < 0) return failure('child_not_found', 'Device placement untuk swap tidak ditemukan.');
  if (firstIndex === secondIndex) return success(cloneLayoutEditorState(state), 'noop');
  const next = cloneLayoutEditorState(state);
  const first = next.devicePlacements[firstIndex];
  const second = next.devicePlacements[secondIndex];
  next.devicePlacements[firstIndex] = { ...first, row: second.row, column: second.column };
  next.devicePlacements[secondIndex] = { ...second, row: first.row, column: first.column };
  return validatedResult(next, 'swapped');
}
