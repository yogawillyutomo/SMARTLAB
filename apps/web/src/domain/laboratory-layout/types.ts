import type {
  ID,
  Laboratory,
  LaboratoryLayout,
  LaboratoryLayoutStatus,
  LaboratoryLayoutType,
} from '@/types';

export interface LayoutCoordinate {
  row: number;
  column: number;
}

export type LayoutValidationIssueCode =
  | 'invalid-layout-id'
  | 'invalid-laboratory-id'
  | 'invalid-layout-name'
  | 'invalid-grid-dimensions'
  | 'invalid-layout-version'
  | 'invalid-element-id'
  | 'duplicate-element-id'
  | 'layout-id-mismatch'
  | 'invalid-coordinate'
  | 'invalid-span'
  | 'element-out-of-bounds'
  | 'invalid-rotation'
  | 'invalid-reference-id'
  | 'duplicate-reference-id'
  | 'missing-device-reference'
  | 'empty-element-has-reference'
  | 'fixed-element-movable'
  | 'archived-layout-active'
  | 'active-layout-inactive'
  | 'draft-layout-active'
  | 'duplicate-cell-occupancy'
  | 'incomplete-grid';

export interface LayoutValidationIssue {
  code: LayoutValidationIssueCode;
  message: string;
  elementId?: ID;
  coordinate?: LayoutCoordinate;
}

export interface LayoutValidationResult {
  valid: boolean;
  issues: LayoutValidationIssue[];
}

export interface LayoutOperationOptions {
  updatedAt: string;
}

export type LayoutOperationKind = 'moved' | 'swapped' | 'noop';

export interface LayoutOperationSuccess {
  ok: true;
  operation: LayoutOperationKind;
  layout: LaboratoryLayout;
  sourceElementId: ID;
  targetElementId?: ID;
}

export type LayoutOperationFailureReason =
  | 'invalid_layout'
  | 'source_not_found'
  | 'source_is_empty'
  | 'source_fixed'
  | 'source_not_movable'
  | 'invalid_target_coordinate'
  | 'target_not_found'
  | 'occupied_target'
  | 'incompatible_target'
  | 'swap_not_allowed'
  | 'spanning_move_not_supported'
  | 'invalid_timestamp'
  | 'invalid_result';

export interface LayoutOperationFailure {
  ok: false;
  reason: LayoutOperationFailureReason;
  message: string;
  issues?: LayoutValidationIssue[];
}

export type LayoutOperationResult = LayoutOperationSuccess | LayoutOperationFailure;

export interface LegacyDeviceCoordinate {
  id: ID;
  laboratoryId: ID;
  positionCode: string;
  row: number;
  col: number;
}

export interface LegacyLayoutMigrationInput {
  layoutId: ID;
  laboratory: Pick<Laboratory, 'id' | 'layoutRows' | 'layoutCols'>;
  devices: readonly LegacyDeviceCoordinate[];
  name: string;
  createdAt: string;
  updatedAt?: string;
  layoutType?: LaboratoryLayoutType;
  version?: number;
  status?: LaboratoryLayoutStatus;
  isActive?: boolean;
}

export type LegacyLayoutMigrationIssueCode =
  | 'invalid-layout-id'
  | 'invalid-layout-name'
  | 'invalid-timestamp'
  | 'invalid-grid-dimensions'
  | 'invalid-device-id'
  | 'duplicate-device-id'
  | 'invalid-device-coordinate'
  | 'duplicate-device-coordinate'
  | 'generated-layout-invalid';

export interface LegacyLayoutMigrationIssue {
  code: LegacyLayoutMigrationIssueCode;
  message: string;
  deviceId?: ID;
  coordinate?: LayoutCoordinate;
}

export type LegacyLayoutMigrationResult =
  | { ok: true; layout: LaboratoryLayout }
  | { ok: false; issues: LegacyLayoutMigrationIssue[] };

export type LaboratoryDependencyKey =
  | 'devices'
  | 'assets'
  | 'schedules'
  | 'bookings'
  | 'sessions'
  | 'journals'
  | 'incidents'
  | 'workOrders'
  | 'maintenancePlans'
  | 'maintenanceExecutions';

export interface LaboratoryBoundRecord {
  laboratoryId: ID;
}

export interface LaboratoryDependencySource {
  devices: readonly LaboratoryBoundRecord[];
  assets: readonly LaboratoryBoundRecord[];
  schedules: readonly LaboratoryBoundRecord[];
  bookings: readonly LaboratoryBoundRecord[];
  sessions: readonly LaboratoryBoundRecord[];
  journals: readonly LaboratoryBoundRecord[];
  incidents: readonly LaboratoryBoundRecord[];
  workOrders: readonly LaboratoryBoundRecord[];
  maintenance: {
    plans: readonly LaboratoryBoundRecord[];
    executions: readonly LaboratoryBoundRecord[];
  };
}

export interface LaboratoryDependencySummary {
  laboratoryId: ID;
  counts: Record<LaboratoryDependencyKey, number>;
  total: number;
  canHardDelete: boolean;
}
