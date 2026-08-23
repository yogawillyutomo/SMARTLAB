import type { LayoutDto, ReplaceLayoutInput } from '@/services/layoutApi';
import type {
  CanonicalEditorDevicePlacement,
  CanonicalEditorStructuralElement,
  CanonicalLayoutEditorState,
  LayoutDeviceDisplayMetadata,
  LayoutDeviceMetadataById,
  LayoutEditorValidationIssue,
} from './types';
import { validateLayoutEditorState } from './validation';

export class LayoutEditorContractError extends Error {
  readonly issues: LayoutEditorValidationIssue[];

  constructor(message: string, issues: LayoutEditorValidationIssue[] = []) {
    super(message);
    this.name = 'LayoutEditorContractError';
    this.issues = issues;
  }
}

export function layoutEditorStateFromServer(layout: LayoutDto): CanonicalLayoutEditorState {
  return {
    id: layout.id,
    schoolId: layout.schoolId,
    laboratoryId: layout.laboratoryId,
    name: layout.name,
    templateKey: layout.templateKey,
    rows: layout.rows,
    columns: layout.columns,
    status: layout.status,
    version: layout.version,
    structuralElements: layout.structuralElements.map((element): CanonicalEditorStructuralElement => ({ ...element })),
    devicePlacements: layout.devicePlacements.map((placement): CanonicalEditorDevicePlacement => ({ ...placement })),
    serverPlacementDeviceIds: Object.fromEntries(
      layout.devicePlacements.map((placement) => [placement.id, placement.deviceId]),
    ),
    activatedAt: layout.activatedAt,
    archivedAt: layout.archivedAt,
    createdAt: layout.createdAt,
    updatedAt: layout.updatedAt,
  };
}

export function replaceEditorStateWithServer(layout: LayoutDto): CanonicalLayoutEditorState {
  return layoutEditorStateFromServer(layout);
}

export function indexLayoutDeviceMetadata(devices: readonly LayoutDeviceDisplayMetadata[]): LayoutDeviceMetadataById {
  return Object.fromEntries(devices.map((device) => [device.id, {
    id: device.id,
    deviceCode: device.deviceCode,
    deviceType: device.deviceType,
    lifecycleStatus: device.lifecycleStatus,
    hostname: device.hostname,
    brand: device.brand,
    model: device.model,
  }]));
}

export function serializeLayoutEditorState(state: CanonicalLayoutEditorState): ReplaceLayoutInput {
  const validation = validateLayoutEditorState(state);
  if (!validation.valid) {
    throw new LayoutEditorContractError('State editor Layout tidak dapat diserialisasi.', validation.issues);
  }
  return {
    name: state.name,
    templateKey: state.templateKey,
    rows: state.rows,
    columns: state.columns,
    structuralElements: state.structuralElements.map((element) => {
      const payload = {
        type: element.type,
        label: element.label,
        row: element.row,
        column: element.column,
        rowSpan: element.rowSpan,
        columnSpan: element.columnSpan,
        rotation: element.rotation,
      };
      return 'id' in element && typeof element.id === 'string' ? { id: element.id, ...payload } : payload;
    }),
    devicePlacements: state.devicePlacements.map((placement) => {
      const payload = {
        deviceId: placement.deviceId,
        role: placement.role,
        label: placement.label,
        row: placement.row,
        column: placement.column,
        rowSpan: placement.rowSpan,
        columnSpan: placement.columnSpan,
        rotation: placement.rotation,
      };
      return 'id' in placement && typeof placement.id === 'string' ? { id: placement.id, ...payload } : payload;
    }),
  };
}
