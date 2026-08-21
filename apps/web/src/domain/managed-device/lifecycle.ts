import type { AuditLog, Device, DeviceLifecycleStatus, ID, RoleName } from '@/types';
import { isDeviceLifecycleStatus, validateManagedDeviceInventory } from './identity';

export const DEVICE_LIFECYCLE_TRANSITIONS: Readonly<Record<DeviceLifecycleStatus, readonly DeviceLifecycleStatus[]>> = {
  in_service: ['spare', 'retired'],
  spare: ['in_service', 'retired'],
  retired: ['in_service', 'spare', 'decommissioned'],
  decommissioned: [],
};

export interface DeviceLifecycleActor {
  name: string;
  role: RoleName;
  device?: string;
}

interface DeviceLifecycleDatabase {
  devices: Device[];
  assets: Parameters<typeof validateManagedDeviceInventory>[0]['assets'];
  auditLogs: AuditLog[];
}

export type DeviceLifecycleTransitionResult<TDatabase extends DeviceLifecycleDatabase> =
  | { ok: true; operation: 'changed'; db: TDatabase; device: Device }
  | { ok: true; operation: 'noop'; db: TDatabase; device: Device }
  | { ok: false; reason: 'invalid_source' | 'device_not_found' | 'invalid_transition' | 'invalid_timestamp' | 'invalid_audit_id'; message: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validTimestamp(value: string): boolean {
  return value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

export function canTransitionDeviceLifecycle(from: DeviceLifecycleStatus, to: DeviceLifecycleStatus): boolean {
  return from === to || DEVICE_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function changeDeviceLifecycle<TDatabase extends DeviceLifecycleDatabase>(input: {
  db: TDatabase;
  deviceId: ID;
  lifecycleStatus: DeviceLifecycleStatus;
  changedAt: string;
  auditId: ID;
  actor: DeviceLifecycleActor;
}): DeviceLifecycleTransitionResult<TDatabase> {
  const integrity = validateManagedDeviceInventory(input.db);
  if (!integrity.valid) return { ok: false, reason: 'invalid_source', message: 'Data perangkat sumber tidak valid.' };
  const source = input.db.devices.find((device) => device.id === input.deviceId);
  if (!source) return { ok: false, reason: 'device_not_found', message: 'Perangkat tidak ditemukan.' };
  if (!isDeviceLifecycleStatus(input.lifecycleStatus) || !canTransitionDeviceLifecycle(source.lifecycleStatus, input.lifecycleStatus)) {
    return { ok: false, reason: 'invalid_transition', message: 'Perubahan lifecycle perangkat tidak diizinkan.' };
  }
  if (source.lifecycleStatus === input.lifecycleStatus) {
    return { ok: true, operation: 'noop', db: input.db, device: source };
  }
  if (!validTimestamp(input.changedAt)) return { ok: false, reason: 'invalid_timestamp', message: 'Waktu perubahan lifecycle tidak valid.' };
  if (!input.auditId.trim() || input.db.auditLogs.some((audit) => audit.id === input.auditId)) {
    return { ok: false, reason: 'invalid_audit_id', message: 'ID audit lifecycle wajib unik dan tidak boleh kosong.' };
  }

  const db = clone(input.db);
  const device = db.devices.find((candidate) => candidate.id === source.id)!;
  const previousLifecycle = device.lifecycleStatus;
  device.lifecycleStatus = input.lifecycleStatus;
  db.auditLogs.unshift({
    id: input.auditId,
    at: input.changedAt,
    userName: input.actor.name,
    role: input.actor.role,
    module: 'devices',
    action: 'device.lifecycle.change',
    object: device.id,
    oldValue: `lifecycle=${previousLifecycle}`,
    newValue: `lifecycle=${device.lifecycleStatus}; assetCode=${device.assetCode}; deviceType=${device.deviceType}`,
    device: input.actor.device ?? 'Web',
  });
  return { ok: true, operation: 'changed', db, device };
}
