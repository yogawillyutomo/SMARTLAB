import {
  DEVICE_PLACEMENT_ROLES,
  LAYOUT_ROTATIONS,
  STRUCTURAL_LAYOUT_ELEMENT_TYPES,
  type DevicePlacementRole,
} from '@/services/layoutApi';
import { isUlid } from '@/lib/ulid';
import type { DeviceType } from '@/services/deviceApi';
import type {
  CanonicalEditorDevicePlacement,
  CanonicalEditorStructuralElement,
  CanonicalLayoutEditorState,
  EditorChildIdentity,
  LayoutEditorValidationIssue,
  LayoutEditorValidationResult,
} from './types';

type EditorFootprint = Pick<CanonicalEditorStructuralElement, 'row' | 'column' | 'rowSpan' | 'columnSpan'>;
type EditorChild = CanonicalEditorStructuralElement | CanonicalEditorDevicePlacement;

export function editorChildKey(child: EditorChildIdentity): string {
  return 'id' in child && typeof child.id === 'string' ? child.id : child.clientKey;
}

export function cloneLayoutEditorState(state: CanonicalLayoutEditorState): CanonicalLayoutEditorState {
  return {
    ...state,
    structuralElements: state.structuralElements.map((element) => ({ ...element })),
    devicePlacements: state.devicePlacements.map((placement) => ({ ...placement })),
    serverPlacementDeviceIds: { ...state.serverPlacementDeviceIds },
  };
}

export function footprintCells(footprint: EditorFootprint): { row: number; column: number }[] {
  const cells: { row: number; column: number }[] = [];
  for (let row = footprint.row; row < footprint.row + footprint.rowSpan; row += 1) {
    for (let column = footprint.column; column < footprint.column + footprint.columnSpan; column += 1) {
      cells.push({ row, column });
    }
  }
  return cells;
}

export function isStationDeviceType(deviceType: DeviceType): boolean {
  return deviceType === 'desktop_pc' || deviceType === 'laptop';
}

export function isRoleCompatibleWithDevice(role: DevicePlacementRole, deviceType: DeviceType): boolean {
  return role === null || isStationDeviceType(deviceType);
}

function validateIdentity(child: EditorChild, issues: LayoutEditorValidationIssue[]): string | null {
  const id = 'id' in child ? child.id : undefined;
  const clientKey = 'clientKey' in child ? child.clientKey : undefined;
  const hasServerId = typeof id === 'string';
  const hasClientKey = typeof clientKey === 'string';
  if (hasServerId === hasClientKey
    || (hasServerId && !isUlid(id))
    || (hasClientKey && clientKey.trim() === '')) {
    issues.push({ code: 'invalid_state', message: 'Identitas child Layout tidak valid.' });
    return null;
  }
  return (hasServerId ? id : clientKey) ?? null;
}

function validFootprint(footprint: EditorFootprint): boolean {
  return Number.isSafeInteger(footprint.row) && footprint.row > 0
    && Number.isSafeInteger(footprint.column) && footprint.column > 0
    && Number.isSafeInteger(footprint.rowSpan) && footprint.rowSpan > 0
    && Number.isSafeInteger(footprint.columnSpan) && footprint.columnSpan > 0;
}

function validOptionalLabel(label: string | null): boolean {
  return label === null || (typeof label === 'string' && label.trim() !== '' && label.length <= 60);
}

export function validateLayoutEditorState(state: CanonicalLayoutEditorState): LayoutEditorValidationResult {
  const issues: LayoutEditorValidationIssue[] = [];
  if (!isUlid(state.id) || !isUlid(state.schoolId) || !isUlid(state.laboratoryId)
    || !Number.isSafeInteger(state.version) || state.version < 1) {
    issues.push({ code: 'invalid_state', message: 'Identitas atau versi Layout tidak valid.' });
  }
  if (typeof state.name !== 'string' || state.name.trim() === '' || state.name.length > 255
    || (state.templateKey !== null && (state.templateKey.trim() === '' || state.templateKey.length > 100))) {
    issues.push({ code: 'invalid_state', message: 'Metadata Layout tidak valid.' });
  }
  if (!Number.isSafeInteger(state.rows) || state.rows < 1 || state.rows > 50
    || !Number.isSafeInteger(state.columns) || state.columns < 1 || state.columns > 50) {
    issues.push({ code: 'invalid_geometry', message: 'Dimensi Layout harus berada pada rentang 1 sampai 50.' });
  }
  if (state.structuralElements.length > 2500 || state.devicePlacements.length > 2500
    || state.structuralElements.length + state.devicePlacements.length > state.rows * state.columns) {
    issues.push({ code: 'invalid_geometry', message: 'Jumlah footprint melebihi kapasitas grid.' });
  }

  const keys = new Set<string>();
  const deviceIds = new Set<string>();
  const occupied = new Map<string, string>();
  const visit = (child: EditorChild, kind: 'structure' | 'placement') => {
    const key = validateIdentity(child, issues);
    if (key !== null) {
      if (keys.has(key)) issues.push({ code: 'duplicate_client_key', message: 'Identitas editor child harus unik.', childKey: key });
      keys.add(key);
    }
    if (!validFootprint(child)) {
      issues.push({ code: 'invalid_geometry', message: 'Geometry child harus berupa bilangan bulat positif.', childKey: key ?? undefined });
      return;
    }
    const lastRow = child.row + child.rowSpan - 1;
    const lastColumn = child.column + child.columnSpan - 1;
    if (lastRow > state.rows || lastColumn > state.columns) {
      issues.push({ code: 'out_of_bounds', message: 'Footprint child melewati batas grid.', childKey: key ?? undefined });
      return;
    }
    footprintCells(child).forEach((coordinate) => {
      const coordinateKey = `${coordinate.row}:${coordinate.column}`;
      const previous = occupied.get(coordinateKey);
      if (previous !== undefined) {
        issues.push({
          code: 'collision',
          message: 'Footprint Layout bertabrakan pada grid bersama.',
          childKey: key ?? undefined,
          coordinate,
        });
      } else {
        occupied.set(coordinateKey, `${kind}:${key ?? 'invalid'}`);
      }
    });
  };

  state.structuralElements.forEach((element) => {
    if (!(STRUCTURAL_LAYOUT_ELEMENT_TYPES as readonly unknown[]).includes(element.type)) {
      issues.push({ code: 'invalid_state', message: 'Jenis structural element tidak valid.', childKey: editorChildKey(element) });
    }
    if (!validOptionalLabel(element.label)
      || (element.type === 'label' && element.label === null)
      || (element.type === 'aisle' && element.label !== null)) {
      issues.push({ code: 'invalid_label', message: 'Label structural element tidak valid.', childKey: editorChildKey(element) });
    }
    if (!(LAYOUT_ROTATIONS as readonly unknown[]).includes(element.rotation)) {
      issues.push({ code: 'invalid_geometry', message: 'Rotasi structural element tidak valid.', childKey: editorChildKey(element) });
    }
    visit(element, 'structure');
  });

  state.devicePlacements.forEach((placement) => {
    const key = editorChildKey(placement);
    if ('id' in placement && typeof placement.id === 'string'
      && state.serverPlacementDeviceIds[placement.id] !== placement.deviceId) {
      issues.push({
        code: 'device_identity_immutable',
        message: 'Existing placement tidak boleh mengganti identitas Device.',
        childKey: key,
      });
    }
    if (!isUlid(placement.deviceId)) {
      issues.push({ code: 'invalid_state', message: 'ID Device placement tidak valid.', childKey: key });
    } else if (deviceIds.has(placement.deviceId)) {
      issues.push({ code: 'duplicate_device', message: 'Device hanya boleh muncul sekali dalam Layout.', childKey: key });
    }
    deviceIds.add(placement.deviceId);
    if (!(placement.role === null || (DEVICE_PLACEMENT_ROLES as readonly unknown[]).includes(placement.role))) {
      issues.push({ code: 'invalid_role', message: 'Role Device placement tidak valid.', childKey: key });
    }
    if (!validOptionalLabel(placement.label)) {
      issues.push({ code: 'invalid_label', message: 'Label Device placement tidak valid.', childKey: key });
    }
    if (!(LAYOUT_ROTATIONS as readonly unknown[]).includes(placement.rotation)) {
      issues.push({ code: 'invalid_geometry', message: 'Rotasi Device placement tidak valid.', childKey: key });
    }
    visit(placement, 'placement');
  });

  return { valid: issues.length === 0, issues };
}
