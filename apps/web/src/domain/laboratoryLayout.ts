import type {
  ID,
  Laboratory,
  LaboratoryLayout,
  LaboratoryLayoutStatus,
  LaboratoryLayoutType,
  LayoutElement,
  LayoutRotation,
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

export type LayoutOperationErrorCode =
  | 'invalid-layout'
  | 'element-not-found'
  | 'target-out-of-bounds'
  | 'element-not-movable'
  | 'element-not-swappable'
  | 'unsupported-span-operation'
  | 'incompatible-target'
  | 'swap-not-allowed';

export type LayoutOperationResult =
  | { ok: true; layout: LaboratoryLayout }
  | { ok: false; code: LayoutOperationErrorCode; message: string; issues?: LayoutValidationIssue[] };

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

export type LaboratoryDependencyKind =
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

export interface LaboratoryDependency {
  kind: LaboratoryDependencyKind;
  label: string;
  count: number;
}

export interface LaboratoryDependencyInspection {
  laboratoryId: ID;
  dependencies: LaboratoryDependency[];
  total: number;
  hasDependencies: boolean;
  canDelete: boolean;
}

const ROTATIONS: readonly LayoutRotation[] = [0, 90, 180, 270];

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isCoordinateInBounds(layout: LaboratoryLayout, coordinate: LayoutCoordinate): boolean {
  return isPositiveInteger(coordinate.row)
    && isPositiveInteger(coordinate.column)
    && coordinate.row <= layout.rows
    && coordinate.column <= layout.columns;
}

function isSingleCell(element: LayoutElement): boolean {
  return element.rowSpan === 1 && element.columnSpan === 1;
}

function cloneLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

function layoutOperationFailure(
  code: LayoutOperationErrorCode,
  message: string,
  issues?: LayoutValidationIssue[],
): LayoutOperationResult {
  return { ok: false, code, message, issues };
}

function findElementAt(layout: LaboratoryLayout, coordinate: LayoutCoordinate): LayoutElement | undefined {
  return layout.elements.find((element) => (
    coordinate.row >= element.row
    && coordinate.row < element.row + element.rowSpan
    && coordinate.column >= element.column
    && coordinate.column < element.column + element.columnSpan
  ));
}

function ensureValidLayout(layout: LaboratoryLayout): LayoutOperationResult | null {
  const validation = validateLaboratoryLayout(layout);
  return validation.valid
    ? null
    : layoutOperationFailure('invalid-layout', 'Denah tidak valid dan tidak dapat diubah.', validation.issues);
}

function ensureResultIntegrity(layout: LaboratoryLayout): LayoutOperationResult {
  const validation = validateLaboratoryLayout(layout);
  return validation.valid
    ? { ok: true, layout }
    : layoutOperationFailure('invalid-layout', 'Operasi menghasilkan denah tidak valid.', validation.issues);
}

export function validateLaboratoryLayout(layout: LaboratoryLayout): LayoutValidationResult {
  const issues: LayoutValidationIssue[] = [];

  if (!isNonEmptyString(layout.id)) {
    issues.push({ code: 'invalid-layout-id', message: 'ID denah wajib diisi.' });
  }
  if (!isNonEmptyString(layout.laboratoryId)) {
    issues.push({ code: 'invalid-laboratory-id', message: 'ID laboratorium wajib diisi.' });
  }
  if (!isNonEmptyString(layout.name)) {
    issues.push({ code: 'invalid-layout-name', message: 'Nama denah wajib diisi.' });
  }
  if (!isPositiveInteger(layout.rows) || !isPositiveInteger(layout.columns)) {
    issues.push({ code: 'invalid-grid-dimensions', message: 'Baris dan kolom denah harus berupa bilangan bulat positif.' });
  }
  if (!isPositiveInteger(layout.version)) {
    issues.push({ code: 'invalid-layout-version', message: 'Versi denah harus berupa bilangan bulat positif.' });
  }

  const elementIds = new Set<ID>();
  const occupiedCells = new Map<string, ID>();

  for (const element of layout.elements) {
    if (!isNonEmptyString(element.id)) {
      issues.push({ code: 'invalid-element-id', message: 'ID elemen wajib diisi.' });
    } else if (elementIds.has(element.id)) {
      issues.push({ code: 'duplicate-element-id', message: 'ID elemen tidak boleh duplikat.', elementId: element.id });
    } else {
      elementIds.add(element.id);
    }

    if (element.layoutId !== layout.id) {
      issues.push({ code: 'layout-id-mismatch', message: 'Elemen harus merujuk ke denah yang sama.', elementId: element.id });
    }
    if (!isPositiveInteger(element.row) || !isPositiveInteger(element.column)) {
      issues.push({ code: 'invalid-coordinate', message: 'Koordinat elemen harus berupa bilangan bulat positif.', elementId: element.id });
      continue;
    }
    if (!isPositiveInteger(element.rowSpan) || !isPositiveInteger(element.columnSpan)) {
      issues.push({ code: 'invalid-span', message: 'Rentang elemen harus berupa bilangan bulat positif.', elementId: element.id });
      continue;
    }
    if (!ROTATIONS.includes(element.rotation)) {
      issues.push({ code: 'invalid-rotation', message: 'Rotasi elemen tidak didukung.', elementId: element.id });
    }
    if (element.referenceId !== undefined && !isNonEmptyString(element.referenceId)) {
      issues.push({ code: 'invalid-reference-id', message: 'ID referensi elemen tidak boleh kosong.', elementId: element.id });
    }

    const lastRow = element.row + element.rowSpan - 1;
    const lastColumn = element.column + element.columnSpan - 1;
    if (lastRow > layout.rows || lastColumn > layout.columns) {
      issues.push({ code: 'element-out-of-bounds', message: 'Elemen berada di luar batas grid.', elementId: element.id });
      continue;
    }

    for (let row = element.row; row <= lastRow; row += 1) {
      for (let column = element.column; column <= lastColumn; column += 1) {
        const key = cellKey(row, column);
        const occupiedBy = occupiedCells.get(key);
        if (occupiedBy) {
          issues.push({
            code: 'duplicate-cell-occupancy',
            message: 'Satu sel hanya boleh ditempati oleh satu elemen.',
            elementId: element.id,
            coordinate: { row, column },
          });
        } else {
          occupiedCells.set(key, element.id);
        }
      }
    }
  }

  if (isPositiveInteger(layout.rows) && isPositiveInteger(layout.columns)) {
    for (let row = 1; row <= layout.rows; row += 1) {
      for (let column = 1; column <= layout.columns; column += 1) {
        if (!occupiedCells.has(cellKey(row, column))) {
          issues.push({
            code: 'incomplete-grid',
            message: 'Setiap sel grid harus direpresentasikan, termasuk sel kosong.',
            coordinate: { row, column },
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export function swapLayoutElements(
  layout: LaboratoryLayout,
  firstElementId: ID,
  secondElementId: ID,
): LayoutOperationResult {
  const invalidLayout = ensureValidLayout(layout);
  if (invalidLayout) return invalidLayout;

  const first = layout.elements.find((element) => element.id === firstElementId);
  const second = layout.elements.find((element) => element.id === secondElementId);
  if (!first || !second) {
    return layoutOperationFailure('element-not-found', 'Elemen yang akan ditukar tidak ditemukan.');
  }
  if (first.id === second.id) {
    return { ok: true, layout: cloneLayout(layout) };
  }
  if (first.type !== 'student_pc' || second.type !== 'student_pc') {
    return layoutOperationFailure('swap-not-allowed', 'Hanya student_pc yang dapat ditukar secara otomatis.');
  }
  if (first.fixed || second.fixed || !first.movable || !second.movable || !first.swappable || !second.swappable) {
    return layoutOperationFailure('element-not-swappable', 'Kedua student_pc harus dapat dipindahkan dan ditukar.');
  }
  if (!isSingleCell(first) || !isSingleCell(second)) {
    return layoutOperationFailure('unsupported-span-operation', 'Swap otomatis hanya mendukung elemen satu sel.');
  }

  const next = cloneLayout(layout);
  const nextFirst = next.elements.find((element) => element.id === first.id)!;
  const nextSecond = next.elements.find((element) => element.id === second.id)!;
  [nextFirst.row, nextSecond.row] = [nextSecond.row, nextFirst.row];
  [nextFirst.column, nextSecond.column] = [nextSecond.column, nextFirst.column];
  return ensureResultIntegrity(next);
}

export function moveLayoutElement(
  layout: LaboratoryLayout,
  elementId: ID,
  target: LayoutCoordinate,
): LayoutOperationResult {
  const invalidLayout = ensureValidLayout(layout);
  if (invalidLayout) return invalidLayout;

  const source = layout.elements.find((element) => element.id === elementId);
  if (!source) return layoutOperationFailure('element-not-found', 'Elemen yang akan dipindahkan tidak ditemukan.');
  if (!isCoordinateInBounds(layout, target)) {
    return layoutOperationFailure('target-out-of-bounds', 'Target berada di luar batas grid.');
  }
  if (source.fixed || !source.movable || source.type === 'empty') {
    return layoutOperationFailure('element-not-movable', 'Elemen ini tidak dapat dipindahkan.');
  }
  if (!isSingleCell(source)) {
    return layoutOperationFailure('unsupported-span-operation', 'Perpindahan hanya mendukung elemen satu sel.');
  }

  const targetElement = findElementAt(layout, target);
  if (!targetElement) {
    return layoutOperationFailure('invalid-layout', 'Target tidak memiliki representasi elemen.');
  }
  if (targetElement.id === source.id) return { ok: true, layout: cloneLayout(layout) };

  if (targetElement.type === 'student_pc') {
    if (source.type !== 'student_pc') {
      return layoutOperationFailure('incompatible-target', 'Elemen non-PC tidak dapat ditukar dengan student_pc.');
    }
    return swapLayoutElements(layout, source.id, targetElement.id);
  }
  if (targetElement.type !== 'empty') {
    return layoutOperationFailure('incompatible-target', 'Target terisi elemen non-PC dan tidak dapat ditimpa.');
  }
  if (!isSingleCell(targetElement)) {
    return layoutOperationFailure('unsupported-span-operation', 'Perpindahan ke elemen kosong multi-sel belum didukung.');
  }

  const next = cloneLayout(layout);
  const nextSource = next.elements.find((element) => element.id === source.id)!;
  const nextTarget = next.elements.find((element) => element.id === targetElement.id)!;
  [nextSource.row, nextTarget.row] = [nextTarget.row, nextSource.row];
  [nextSource.column, nextTarget.column] = [nextTarget.column, nextSource.column];
  return ensureResultIntegrity(next);
}

export function migrateLegacyDeviceCoordinates(input: LegacyLayoutMigrationInput): LegacyLayoutMigrationResult {
  const issues: LegacyLayoutMigrationIssue[] = [];
  const rows = input.laboratory.layoutRows;
  const columns = input.laboratory.layoutCols;
  const layoutId = input.layoutId.trim();
  const name = input.name.trim();
  const createdAt = input.createdAt.trim();
  const updatedAt = input.updatedAt?.trim() || createdAt;

  if (!layoutId) issues.push({ code: 'invalid-layout-id', message: 'ID denah wajib diisi.' });
  if (!name) issues.push({ code: 'invalid-layout-name', message: 'Nama denah wajib diisi.' });
  if (!createdAt) issues.push({ code: 'invalid-timestamp', message: 'Waktu pembuatan denah wajib diisi.' });
  if (input.updatedAt !== undefined && !input.updatedAt.trim()) {
    issues.push({ code: 'invalid-timestamp', message: 'Waktu pembaruan denah tidak boleh kosong.' });
  }
  if (!isPositiveInteger(rows) || !isPositiveInteger(columns)) {
    issues.push({ code: 'invalid-grid-dimensions', message: 'Dimensi grid legacy tidak valid.' });
  }

  const relevantDevices = input.devices.filter((device) => device.laboratoryId === input.laboratory.id);
  const deviceIds = new Set<ID>();
  const coordinates = new Set<string>();
  for (const device of relevantDevices) {
    if (deviceIds.has(device.id)) {
      issues.push({ code: 'duplicate-device-id', message: 'ID perangkat legacy tidak boleh duplikat.', deviceId: device.id });
      continue;
    }
    deviceIds.add(device.id);

    const coordinate = { row: device.row, column: device.col };
    if (!isPositiveInteger(device.row) || !isPositiveInteger(device.col) || device.row > rows || device.col > columns) {
      issues.push({ code: 'invalid-device-coordinate', message: 'Koordinat perangkat legacy berada di luar grid.', deviceId: device.id, coordinate });
      continue;
    }
    const key = cellKey(device.row, device.col);
    if (coordinates.has(key)) {
      issues.push({ code: 'duplicate-device-coordinate', message: 'Koordinat perangkat legacy tidak boleh duplikat.', deviceId: device.id, coordinate });
      continue;
    }
    coordinates.add(key);
  }

  if (issues.length > 0) return { ok: false, issues };

  const devicesByCell = new Map(relevantDevices.map((device) => [cellKey(device.row, device.col), device]));
  const elements: LayoutElement[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const device = devicesByCell.get(cellKey(row, column));
      elements.push(device
        ? {
          id: `${layoutId}:device:${device.id}`,
          layoutId,
          type: 'student_pc',
          referenceId: device.id,
          label: device.positionCode.trim() || undefined,
          row,
          column,
          rowSpan: 1,
          columnSpan: 1,
          rotation: 0,
          movable: true,
          swappable: true,
          fixed: false,
        }
        : {
          id: `${layoutId}:empty:${row}:${column}`,
          layoutId,
          type: 'empty',
          row,
          column,
          rowSpan: 1,
          columnSpan: 1,
          rotation: 0,
          movable: false,
          swappable: false,
          fixed: true,
        });
    }
  }

  const layout: LaboratoryLayout = {
    id: layoutId,
    laboratoryId: input.laboratory.id,
    name,
    layoutType: input.layoutType ?? 'grid-classic',
    rows,
    columns,
    version: input.version ?? 1,
    status: input.status ?? 'draft',
    isActive: input.isActive ?? false,
    elements,
    createdAt,
    updatedAt,
  };
  const validation = validateLaboratoryLayout(layout);
  if (!validation.valid) {
    return {
      ok: false,
      issues: validation.issues.map((issue) => ({
        code: 'generated-layout-invalid',
        message: issue.message,
        deviceId: issue.elementId,
        coordinate: issue.coordinate,
      })),
    };
  }
  return { ok: true, layout };
}

export function inspectLaboratoryDependencies(
  source: LaboratoryDependencySource,
  laboratoryId: ID,
): LaboratoryDependencyInspection {
  const count = (records: readonly LaboratoryBoundRecord[]): number => records.filter((record) => record.laboratoryId === laboratoryId).length;
  const candidates: LaboratoryDependency[] = [
    { kind: 'devices', label: 'device', count: count(source.devices) },
    { kind: 'assets', label: 'asset', count: count(source.assets) },
    { kind: 'schedules', label: 'schedule', count: count(source.schedules) },
    { kind: 'bookings', label: 'booking', count: count(source.bookings) },
    { kind: 'sessions', label: 'session', count: count(source.sessions) },
    { kind: 'journals', label: 'journal', count: count(source.journals) },
    { kind: 'incidents', label: 'incident', count: count(source.incidents) },
    { kind: 'workOrders', label: 'work order', count: count(source.workOrders) },
    { kind: 'maintenancePlans', label: 'maintenance plan', count: count(source.maintenance.plans) },
    { kind: 'maintenanceExecutions', label: 'maintenance execution', count: count(source.maintenance.executions) },
  ];
  const dependencies = candidates.filter((dependency) => dependency.count > 0);
  const total = dependencies.reduce((sum, dependency) => sum + dependency.count, 0);
  return { laboratoryId, dependencies, total, hasDependencies: total > 0, canDelete: total === 0 };
}
