import type {
  DevicePlacementDto,
  DevicePlacementRole,
  LayoutDto,
  LayoutRotation,
  LayoutStatus,
  StructuralLayoutElementDto,
  StructuralLayoutElementType,
} from '@/services/layoutApi';
import type { DeviceLifecycleStatus, DeviceType } from '@/services/deviceApi';

export type ExistingEditorChildIdentity = { id: string; clientKey?: never };
export type UnsavedEditorChildIdentity = { id?: never; clientKey: string };
export type EditorChildIdentity = ExistingEditorChildIdentity | UnsavedEditorChildIdentity;

export type CanonicalEditorStructuralElement = EditorChildIdentity & Omit<StructuralLayoutElementDto, 'id'>;
export type CanonicalEditorDevicePlacement = EditorChildIdentity & Omit<DevicePlacementDto, 'id'>;

export interface CanonicalLayoutEditorState {
  id: string;
  schoolId: string;
  laboratoryId: string;
  name: string;
  templateKey: string | null;
  rows: number;
  columns: number;
  status: LayoutStatus;
  version: number;
  structuralElements: CanonicalEditorStructuralElement[];
  devicePlacements: CanonicalEditorDevicePlacement[];
  serverPlacementDeviceIds: Readonly<Record<string, string>>;
  activatedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewStructuralElementInput {
  clientKey: string;
  type: StructuralLayoutElementType;
  label: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface NewDevicePlacementInput {
  clientKey: string;
  role: DevicePlacementRole;
  label: string | null;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
}

export interface LayoutDeviceDisplayMetadata {
  id: string;
  deviceCode: string;
  deviceType: DeviceType;
  lifecycleStatus: DeviceLifecycleStatus;
  hostname: string | null;
  brand: string | null;
  model: string | null;
}

export type LayoutDeviceMetadataById = Readonly<Record<string, LayoutDeviceDisplayMetadata>>;

export type LayoutEditorFailureCode =
  | 'invalid_state'
  | 'not_editable'
  | 'child_not_found'
  | 'duplicate_client_key'
  | 'duplicate_device'
  | 'invalid_geometry'
  | 'out_of_bounds'
  | 'collision'
  | 'invalid_label'
  | 'invalid_role'
  | 'device_type_required'
  | 'device_identity_immutable'
  | 'resize_clips_content';

export interface LayoutEditorFailure {
  ok: false;
  code: LayoutEditorFailureCode;
  message: string;
}

export interface LayoutEditorSuccess {
  ok: true;
  state: CanonicalLayoutEditorState;
  operation: 'added' | 'removed' | 'updated' | 'moved' | 'resized' | 'swapped' | 'noop';
}

export type LayoutEditorResult = LayoutEditorSuccess | LayoutEditorFailure;

export interface LayoutEditorValidationIssue {
  code: LayoutEditorFailureCode;
  message: string;
  childKey?: string;
  coordinate?: { row: number; column: number };
}

export interface LayoutEditorValidationResult {
  valid: boolean;
  issues: LayoutEditorValidationIssue[];
}

export type CanonicalServerLayout = LayoutDto;
