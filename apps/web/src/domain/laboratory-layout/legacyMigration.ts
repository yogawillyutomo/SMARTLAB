import type { LaboratoryLayout, LayoutElement } from '@/types';
import type {
  LegacyLayoutMigrationInput,
  LegacyLayoutMigrationIssue,
  LegacyLayoutMigrationResult,
} from './types';
import { isPositiveInteger, validateLaboratoryLayout } from './validation';

function cellKey(row: number, column: number): string {
  return `${row}:${column}`;
}

function isValidTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
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
  if (!isValidTimestamp(createdAt) || !isValidTimestamp(updatedAt)) issues.push({ code: 'invalid-timestamp', message: 'Timestamp migrasi tidak valid.' });
  if (!isPositiveInteger(rows) || !isPositiveInteger(columns)) issues.push({ code: 'invalid-grid-dimensions', message: 'Dimensi grid legacy tidak valid.' });

  const devices = input.devices.filter((device) => device.laboratoryId === input.laboratory.id);
  const deviceIds = new Set<string>();
  const coordinates = new Set<string>();
  for (const device of devices) {
    if (!device.id.trim()) {
      issues.push({ code: 'invalid-device-id', message: 'ID perangkat legacy wajib diisi.', deviceId: device.id });
      continue;
    }
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

  const devicesByCell = new Map(devices.map((device) => [cellKey(device.row, device.col), device]));
  const elements: LayoutElement[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const device = devicesByCell.get(cellKey(row, column));
      elements.push(device
        ? { id: `${layoutId}:device:${device.id}`, layoutId, type: 'student_pc', referenceId: device.id, label: device.positionCode.trim() || undefined, row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: true, swappable: true, fixed: false }
        : { id: `${layoutId}:empty:${row}:${column}`, layoutId, type: 'empty', row, column, rowSpan: 1, columnSpan: 1, rotation: 0, movable: false, swappable: false, fixed: false });
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
    return { ok: false, issues: validation.issues.map((issue) => ({ code: 'generated-layout-invalid', message: issue.message, deviceId: issue.elementId, coordinate: issue.coordinate })) };
  }
  return { ok: true, layout };
}
