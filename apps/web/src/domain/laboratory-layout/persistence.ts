import type { AuditLog, Device, ID, Laboratory, LaboratoryLayout, LayoutElement, RoleName } from '@/types';
import type { SeedData } from '@/data/seed';
import { migrateLegacyDeviceCoordinates } from './legacyMigration';
import { inspectLaboratoryDependencies } from './laboratoryDependencies';
import { isPositiveInteger, validateLaboratoryLayout } from './validation';
import { validatePhysicalLayoutTemplateStructure } from './templates';

export type PersistedLayoutIntegrityIssueCode =
  | 'invalid-layout'
  | 'orphan-layout'
  | 'missing-active-layout'
  | 'multiple-active-layouts'
  | 'active-layout-status-mismatch'
  | 'layout-dimension-mismatch'
  | 'missing-device-reference'
  | 'cross-laboratory-device-reference'
  | 'duplicate-device-reference'
  | 'device-missing-from-active-layout'
  | 'legacy-device-coordinate'
  | 'duplicate-device-id'
  | 'duplicate-laboratory-id'
  | 'duplicate-layout-id'
  | 'orphan-device-laboratory'
  | 'invalid-laboratory-id'
  | 'invalid-layout-id'
  | 'invalid-device-id'
  | 'unsupported-layout-dimension-change';

export interface PersistedLayoutIntegrityIssue {
  code: PersistedLayoutIntegrityIssueCode;
  message: string;
  laboratoryId?: ID;
  layoutId?: ID;
  deviceId?: ID;
  elementId?: ID;
  validationIssueCode?: string;
}

export interface PersistedLayoutIntegrityResult {
  valid: boolean;
  issues: PersistedLayoutIntegrityIssue[];
}

export type LayoutPersistenceFailure = { ok: false; error: string; issues: PersistedLayoutIntegrityIssue[] };
export type ActiveLayoutResult = { ok: true; layout: LaboratoryLayout } | LayoutPersistenceFailure;

export interface LayoutActor {
  name: string;
  role: RoleName;
  device?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function pcElements(layout: LaboratoryLayout): LayoutElement[] {
  return layout.elements.filter((element) => element.type === 'student_pc' || element.type === 'teacher_pc');
}

function failure(error: string, issues: PersistedLayoutIntegrityIssue[]): LayoutPersistenceFailure {
  return { ok: false, error, issues };
}

export function cloneLaboratoryLayout(layout: LaboratoryLayout): LaboratoryLayout {
  return { ...layout, elements: layout.elements.map((element) => ({ ...element })) };
}

export function layoutFingerprint(layout: LaboratoryLayout): string {
  const elements = layout.elements
    .map((element) => ({
      id: element.id,
      layoutId: element.layoutId,
      type: element.type,
      referenceId: element.referenceId ?? null,
      label: element.label ?? null,
      row: element.row,
      column: element.column,
      rowSpan: element.rowSpan,
      columnSpan: element.columnSpan,
      rotation: element.rotation,
      movable: element.movable,
      swappable: element.swappable,
      fixed: element.fixed,
    }))
    .sort((left, right) => left.row - right.row || left.column - right.column || left.id.localeCompare(right.id));
  return JSON.stringify({
    id: layout.id,
    laboratoryId: layout.laboratoryId,
    name: layout.name,
    layoutType: layout.layoutType,
    rows: layout.rows,
    columns: layout.columns,
    version: layout.version,
    status: layout.status,
    isActive: layout.isActive,
    createdAt: layout.createdAt,
    elements,
  });
}

export function layoutsEquivalent(left: LaboratoryLayout, right: LaboratoryLayout): boolean {
  return layoutFingerprint(left) === layoutFingerprint(right);
}

export function validatePersistedLaboratoryLayouts(db: Pick<SeedData, 'labs' | 'devices' | 'layouts'>): PersistedLayoutIntegrityResult {
  const issues: PersistedLayoutIntegrityIssue[] = [];
  const labsById = new Map<ID, Laboratory>();
  for (const laboratory of db.labs) {
    if (!laboratory.id?.trim() || labsById.has(laboratory.id)) issues.push({ code: 'duplicate-laboratory-id', message: 'ID laboratorium wajib unik dan tidak boleh kosong.', laboratoryId: laboratory.id });
    else labsById.set(laboratory.id, laboratory);
  }
  const devicesById = new Map<ID, Device>();
  for (const device of db.devices) {
    if (devicesById.has(device.id)) {
      issues.push({ code: 'duplicate-device-id', message: 'ID perangkat tidak boleh duplikat.', deviceId: device.id });
    } else {
      devicesById.set(device.id, device);
    }
    if (hasOwn(device, 'row') || hasOwn(device, 'col')) {
      issues.push({ code: 'legacy-device-coordinate', message: 'Perangkat tersimpan tidak boleh memiliki koordinat row atau col.', deviceId: device.id });
    }
    if (!labsById.has(device.laboratoryId)) issues.push({ code: 'orphan-device-laboratory', message: 'Perangkat merujuk ke laboratorium yang tidak ada.', deviceId: device.id, laboratoryId: device.laboratoryId });
  }

  const activeLayoutsByLab = new Map<ID, LaboratoryLayout[]>();
  const layoutIds = new Set<ID>();
  for (const layout of db.layouts) {
    if (!layout.id?.trim() || layoutIds.has(layout.id)) issues.push({ code: 'duplicate-layout-id', message: 'ID denah wajib unik dan tidak boleh kosong.', layoutId: layout.id, laboratoryId: layout.laboratoryId });
    layoutIds.add(layout.id);
    const laboratory = labsById.get(layout.laboratoryId);
    if (!laboratory) {
      issues.push({ code: 'orphan-layout', message: 'Denah merujuk ke laboratorium yang tidak ada.', laboratoryId: layout.laboratoryId, layoutId: layout.id });
    } else if (layout.rows !== laboratory.layoutRows || layout.columns !== laboratory.layoutCols) {
      issues.push({ code: 'layout-dimension-mismatch', message: 'Dimensi denah harus sama dengan dimensi laboratorium.', laboratoryId: laboratory.id, layoutId: layout.id });
    }
    const validation = validateLaboratoryLayout(layout);
    validation.issues.forEach((issue) => issues.push({
      code: 'invalid-layout',
      message: issue.message,
      laboratoryId: layout.laboratoryId,
      layoutId: layout.id,
      elementId: issue.elementId,
      validationIssueCode: issue.code,
    }));
    if (layout.isActive) {
      if (layout.status !== 'active') {
        issues.push({ code: 'active-layout-status-mismatch', message: 'Denah aktif harus memiliki status active.', laboratoryId: layout.laboratoryId, layoutId: layout.id });
      }
      activeLayoutsByLab.set(layout.laboratoryId, [...(activeLayoutsByLab.get(layout.laboratoryId) ?? []), layout]);
    }
  }

  const referencedDeviceIds = new Set<ID>();
  for (const laboratory of db.labs) {
    const activeLayouts = activeLayoutsByLab.get(laboratory.id) ?? [];
    if (activeLayouts.length === 0) {
      issues.push({ code: 'missing-active-layout', message: 'Laboratorium harus memiliki satu denah aktif.', laboratoryId: laboratory.id });
      continue;
    }
    if (activeLayouts.length !== 1) {
      issues.push({ code: 'multiple-active-layouts', message: 'Laboratorium hanya boleh memiliki satu denah aktif.', laboratoryId: laboratory.id });
      continue;
    }
    const layout = activeLayouts[0];
    const layoutReferences = new Set<ID>();
    for (const element of pcElements(layout)) {
      const referenceId = element.referenceId;
      if (!referenceId || !devicesById.has(referenceId)) {
        issues.push({ code: 'missing-device-reference', message: 'Elemen PC harus merujuk ke perangkat yang ada.', laboratoryId: laboratory.id, layoutId: layout.id, elementId: element.id, deviceId: referenceId });
        continue;
      }
      const device = devicesById.get(referenceId)!;
      if (device.laboratoryId !== laboratory.id) {
        issues.push({ code: 'cross-laboratory-device-reference', message: 'Elemen PC harus merujuk ke perangkat dalam laboratorium yang sama.', laboratoryId: laboratory.id, layoutId: layout.id, elementId: element.id, deviceId: referenceId });
      }
      if (layoutReferences.has(referenceId) || referencedDeviceIds.has(referenceId)) {
        issues.push({ code: 'duplicate-device-reference', message: 'Perangkat hanya boleh direferensikan satu kali oleh denah aktif.', laboratoryId: laboratory.id, layoutId: layout.id, elementId: element.id, deviceId: referenceId });
      }
      layoutReferences.add(referenceId);
      referencedDeviceIds.add(referenceId);
    }
    db.devices.filter((device) => device.laboratoryId === laboratory.id).forEach((device) => {
      if (!layoutReferences.has(device.id)) {
        issues.push({ code: 'device-missing-from-active-layout', message: 'Setiap perangkat laboratorium harus muncul tepat sekali dalam denah aktif.', laboratoryId: laboratory.id, layoutId: layout.id, deviceId: device.id });
      }
    });
  }
  return { valid: issues.length === 0, issues };
}

export function getActiveLaboratoryLayout(db: Pick<SeedData, 'labs' | 'devices' | 'layouts'>, laboratoryId: ID): ActiveLayoutResult {
  const laboratory = db.labs.find((candidate) => candidate.id === laboratoryId);
  if (!laboratory) return failure('Laboratorium tidak ditemukan.', [{ code: 'orphan-layout', message: 'Laboratorium tidak ditemukan.', laboratoryId }]);
  const activeLayouts = db.layouts.filter((layout) => layout.laboratoryId === laboratoryId && layout.isActive);
  if (activeLayouts.length === 0) return failure('Denah aktif laboratorium tidak ditemukan.', [{ code: 'missing-active-layout', message: 'Denah aktif laboratorium tidak ditemukan.', laboratoryId }]);
  if (activeLayouts.length !== 1) return failure('Laboratorium memiliki lebih dari satu denah aktif.', [{ code: 'multiple-active-layouts', message: 'Laboratorium memiliki lebih dari satu denah aktif.', laboratoryId }]);
  const integrity = validatePersistedLaboratoryLayouts(db);
  const identityIssues = integrity.issues.filter((issue) => ['duplicate-laboratory-id', 'duplicate-layout-id', 'duplicate-device-id', 'orphan-device-laboratory'].includes(issue.code));
  const relevantIssues = [...identityIssues, ...integrity.issues.filter((issue) => issue.laboratoryId === laboratoryId || issue.layoutId === activeLayouts[0].id)];
  if (relevantIssues.length > 0) return failure('Denah aktif tidak valid.', relevantIssues);
  return { ok: true, layout: cloneLaboratoryLayout(activeLayouts[0]) };
}

export type SaveLayoutResult =
  | { ok: true; changed: boolean; db: SeedData; layout: LaboratoryLayout }
  | LayoutPersistenceFailure;

export interface SaveActiveLaboratoryLayoutInput {
  db: SeedData;
  laboratoryId: ID;
  draft: LaboratoryLayout;
  actor: LayoutActor;
  savedAt: string;
  auditId: ID;
}

export function saveActiveLaboratoryLayout(input: SaveActiveLaboratoryLayoutInput): SaveLayoutResult {
  const draftValidation = validateLaboratoryLayout(input.draft);
  if (!draftValidation.valid) {
    return failure('Denah draft tidak valid.', draftValidation.issues.map((issue) => ({ code: 'invalid-layout', message: issue.message, laboratoryId: input.draft.laboratoryId, layoutId: input.draft.id, elementId: issue.elementId, validationIssueCode: issue.code })));
  }
  const active = getActiveLaboratoryLayout(input.db, input.laboratoryId);
  if (!active.ok) return active;
  if (input.draft.id !== active.layout.id || input.draft.laboratoryId !== input.laboratoryId) {
    return failure('Draft tidak sesuai dengan denah aktif laboratorium.', [{ code: 'invalid-layout', message: 'ID denah atau laboratorium draft tidak sesuai.', laboratoryId: input.laboratoryId, layoutId: input.draft.id }]);
  }
  const laboratory = input.db.labs.find((candidate) => candidate.id === input.laboratoryId)!;
  const dimensionsChanged = input.draft.rows !== laboratory.layoutRows || input.draft.columns !== laboratory.layoutCols;
  if (dimensionsChanged && !validatePhysicalLayoutTemplateStructure(input.draft).valid) {
    return failure('Perubahan ukuran denah hanya diperbolehkan melalui template fisik yang didukung.', [{ code: 'unsupported-layout-dimension-change', message: 'Perubahan dimensi harus menggunakan struktur template fisik yang valid.', laboratoryId: input.laboratoryId, layoutId: input.draft.id }]);
  }
  if (layoutsEquivalent(active.layout, input.draft)) return { ok: true, changed: false, db: input.db, layout: active.layout };

  const next = clone(input.db);
  if (dimensionsChanged) {
    const laboratoryIndex = next.labs.findIndex((candidate) => candidate.id === input.laboratoryId);
    next.labs[laboratoryIndex] = { ...next.labs[laboratoryIndex], layoutRows: input.draft.rows, layoutCols: input.draft.columns };
  }
  const index = next.layouts.findIndex((layout) => layout.id === active.layout.id);
  const savedLayout = { ...cloneLaboratoryLayout(input.draft), updatedAt: input.savedAt };
  next.layouts[index] = savedLayout;
  const movedElements = savedLayout.elements.filter((element) => {
    const previous = active.layout.elements.find((candidate) => candidate.id === element.id);
    return previous && (previous.row !== element.row || previous.column !== element.column);
  }).length;
  const audit: AuditLog = {
    id: input.auditId,
    at: input.savedAt,
    userName: input.actor.name,
    role: input.actor.role,
    module: 'laboratories',
    action: 'layout.save',
    object: savedLayout.id,
    oldValue: `updatedAt=${active.layout.updatedAt}`,
    newValue: `updatedAt=${savedLayout.updatedAt}; layoutType=${savedLayout.layoutType}; dimensions=${savedLayout.rows}x${savedLayout.columns}; repositioned=${movedElements}`,
    device: input.actor.device ?? 'Web',
  };
  next.auditLogs.unshift(audit);
  const integrity = validatePersistedLaboratoryLayouts(next);
  if (!integrity.valid) return failure('Simpan denah ditolak karena data hasil tidak valid.', integrity.issues);
  return { ok: true, changed: true, db: next, layout: cloneLaboratoryLayout(savedLayout) };
}

export type LaboratoryLifecycleResult =
  | { ok: true; db: SeedData; layout?: LaboratoryLayout }
  | LayoutPersistenceFailure;

export interface CreateLaboratoryWithInitialLayoutInput {
  db: SeedData;
  laboratory: Laboratory;
  devices: Device[];
  createdAt: string;
  layoutId: ID;
  actor?: LayoutActor;
  auditId?: ID;
}

export function createInitialLaboratoryDevices(laboratory: Laboratory, createdAt: string): Device[] {
  return Array.from({ length: laboratory.pcCount }, (_, index) => {
    const number = index + 1;
    const padded = String(number).padStart(2, '0');
    return {
      id: `dev-${laboratory.code}-${padded}`,
      positionCode: `PC-${padded}`,
      hostname: `PC-${laboratory.code}-${padded}`,
      laboratoryId: laboratory.id,
      assetCode: `AST-${laboratory.code}-${String(number).padStart(3, '0')}`,
      ipAddress: `10.10.99.${number}`,
      macAddress: `02:00:99:${padded}:${String(number + 1).padStart(2, '0')}:${String(number + 2).padStart(2, '0')}`,
      serialNumber: `SN${laboratory.code}${String(number).padStart(3, '0')}2026`,
      brand: 'Dell', model: 'OptiPlex 7090', yearAcquired: 2026, processor: 'Intel Core i5-11400', ramGB: 16, storageGB: 512,
      gpu: 'Intel UHD Graphics 730', monitor: 'Dell 24"', os: 'Windows 11 Pro', status: 'Offline', cpuUsage: 0, ramUsage: 0,
      diskUsage: 40, temperature: 45, uptimeHours: 0, network: 'Disconnected', lastHeartbeat: createdAt,
      peripherals: { monitor: true, keyboard: true, mouse: true, headset: false, network: false, ups: false },
    };
  });
}

export function createLaboratoryWithInitialLayout(input: CreateLaboratoryWithInitialLayoutInput): LaboratoryLifecycleResult {
  const { laboratory, devices } = input;
  const sourceIntegrity = validatePersistedLaboratoryLayouts(input.db);
  if (!sourceIntegrity.valid) return failure('Database sumber tidak valid.', sourceIntegrity.issues);
  if (!isPositiveInteger(laboratory.layoutRows) || !isPositiveInteger(laboratory.layoutCols) || !Number.isInteger(laboratory.pcCount) || laboratory.pcCount < 0 || laboratory.pcCount > laboratory.layoutRows * laboratory.layoutCols) {
    return failure('Struktur laboratorium tidak valid.', [{ code: 'layout-dimension-mismatch', message: 'Baris, kolom, atau jumlah PC tidak valid.', laboratoryId: laboratory.id }]);
  }
  if (!laboratory.id.trim()) return failure('ID laboratorium wajib diisi.', [{ code: 'invalid-laboratory-id', message: 'ID laboratorium wajib diisi.', laboratoryId: laboratory.id }]);
  if (input.db.labs.some((item) => item.id === laboratory.id)) return failure('ID laboratorium duplikat.', [{ code: 'duplicate-laboratory-id', message: 'ID laboratorium sudah digunakan.', laboratoryId: laboratory.id }]);
  if (!input.layoutId.trim()) return failure('ID denah wajib diisi.', [{ code: 'invalid-layout-id', message: 'ID denah wajib diisi.', layoutId: input.layoutId }]);
  if (input.db.layouts.some((layout) => layout.id === input.layoutId)) return failure('ID denah duplikat.', [{ code: 'duplicate-layout-id', message: 'ID denah sudah digunakan.', layoutId: input.layoutId }]);
  const seenDeviceIds = new Set<ID>();
  for (const device of devices) {
    if (!device.id.trim()) return failure('ID perangkat wajib diisi.', [{ code: 'invalid-device-id', message: 'ID perangkat wajib diisi.', deviceId: device.id, laboratoryId: laboratory.id }]);
    if (seenDeviceIds.has(device.id) || input.db.devices.some((item) => item.id === device.id)) return failure('ID perangkat duplikat.', [{ code: 'duplicate-device-id', message: 'ID perangkat sudah digunakan.', deviceId: device.id, laboratoryId: laboratory.id }]);
    seenDeviceIds.add(device.id);
  }
  if (devices.length !== laboratory.pcCount || devices.some((device) => device.laboratoryId !== laboratory.id || hasOwn(device, 'row') || hasOwn(device, 'col'))) {
    return failure('Perangkat laboratorium tidak valid.', [{ code: 'legacy-device-coordinate', message: 'Perangkat harus cocok dengan laboratorium dan tidak boleh memiliki row atau col.', laboratoryId: laboratory.id }]);
  }
  const legacyDevices = devices.map((device, index) => ({ ...device, row: Math.floor(index / laboratory.layoutCols) + 1, col: (index % laboratory.layoutCols) + 1 }));
  const migration = migrateLegacyDeviceCoordinates({
    layoutId: input.layoutId,
    laboratory,
    devices: legacyDevices,
    name: `${laboratory.name} — Denah Aktif`,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    layoutType: 'grid-classic',
    version: 1,
    status: 'active',
    isActive: true,
  });
  if (!migration.ok) return failure('Denah awal laboratorium tidak valid.', migration.issues.map((issue) => ({ code: 'invalid-layout', message: issue.message, laboratoryId: laboratory.id, layoutId: input.layoutId, deviceId: issue.deviceId, validationIssueCode: issue.code })));
  const next = clone(input.db);
  next.labs.push(clone(laboratory));
  next.devices.push(...clone(devices));
  next.layouts.push(migration.layout);
  if (input.actor && input.auditId) {
    next.auditLogs.unshift({ id: input.auditId, at: input.createdAt, userName: input.actor.name, role: input.actor.role, module: 'laboratories', action: 'create', object: laboratory.id, newValue: laboratory.name, device: input.actor.device ?? 'Web' });
  }
  const integrity = validatePersistedLaboratoryLayouts(next);
  if (!integrity.valid) return failure('Pembuatan laboratorium menghasilkan data tidak valid.', integrity.issues);
  return { ok: true, db: next, layout: migration.layout };
}

export interface DeleteLaboratorySafelyInput {
  db: SeedData;
  laboratoryId: ID;
  deletedAt: string;
  actor?: LayoutActor;
  auditId?: ID;
}

export function deleteLaboratorySafely(input: DeleteLaboratorySafelyInput): LaboratoryLifecycleResult {
  const laboratory = input.db.labs.find((item) => item.id === input.laboratoryId);
  if (!laboratory) return failure('Laboratorium tidak ditemukan.', [{ code: 'orphan-layout', message: 'Laboratorium tidak ditemukan.', laboratoryId: input.laboratoryId }]);
  const dependencies = inspectLaboratoryDependencies({
    devices: input.db.devices,
    assets: input.db.assets,
    schedules: input.db.schedules,
    bookings: input.db.bookings,
    sessions: input.db.sessions,
    journals: input.db.journals,
    incidents: input.db.incidents,
    workOrders: input.db.workOrders,
    maintenance: input.db.maintenance,
  }, input.laboratoryId);
  if (!dependencies.canHardDelete) {
    const detail = Object.entries(dependencies.counts).filter(([, count]) => count > 0).map(([key, count]) => `${key} (${count})`).join(', ');
    return failure(`Laboratorium masih digunakan oleh ${detail}.`, [{ code: 'invalid-layout', message: `Dependency terdeteksi: ${detail}.`, laboratoryId: input.laboratoryId }]);
  }
  const next = clone(input.db);
  next.labs = next.labs.filter((item) => item.id !== input.laboratoryId);
  next.layouts = next.layouts.filter((layout) => layout.laboratoryId !== input.laboratoryId);
  if (input.actor && input.auditId) {
    next.auditLogs.unshift({ id: input.auditId, at: input.deletedAt, userName: input.actor.name, role: input.actor.role, module: 'laboratories', action: 'delete', object: laboratory.id, oldValue: laboratory.name, device: input.actor.device ?? 'Web' });
  }
  const integrity = validatePersistedLaboratoryLayouts(next);
  if (!integrity.valid) return failure('Penghapusan laboratorium menghasilkan data tidak valid.', integrity.issues);
  return { ok: true, db: next };
}
