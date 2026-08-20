import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import type { DeviceLifecycleStatus } from '@/types';
import {
  DEVICE_LIFECYCLE_TRANSITIONS,
  canTransitionDeviceLifecycle,
  changeDeviceLifecycle,
} from '../index';

const CHANGED_AT = '2026-08-19T08:00:00.000Z';
const ACTOR = { name: 'Teknisi UAT', role: 'Teknisi' as const, device: 'Browser UAT' };

const ALLOWED_TRANSITIONS: Array<[DeviceLifecycleStatus, DeviceLifecycleStatus]> = [
  ['in_service', 'spare'],
  ['in_service', 'retired'],
  ['spare', 'in_service'],
  ['spare', 'retired'],
  ['retired', 'in_service'],
  ['retired', 'spare'],
  ['retired', 'decommissioned'],
];

function databaseWithLifecycle(lifecycleStatus: DeviceLifecycleStatus) {
  const db = generateSeedData();
  db.devices[0].lifecycleStatus = lifecycleStatus;
  return db;
}

describe('managed Device lifecycle policy', () => {
  it('exposes only the documented allowed transition matrix', () => {
    expect(DEVICE_LIFECYCLE_TRANSITIONS).toEqual({
      in_service: ['spare', 'retired'],
      spare: ['in_service', 'retired'],
      retired: ['in_service', 'spare', 'decommissioned'],
      decommissioned: [],
    });
  });

  it.each(ALLOWED_TRANSITIONS)('allows %s -> %s and creates exactly one audit event', (from, to) => {
    const db = databaseWithLifecycle(from);
    const result = changeDeviceLifecycle({
      db,
      deviceId: db.devices[0].id,
      lifecycleStatus: to,
      changedAt: CHANGED_AT,
      auditId: `audit-${from}-${to}`,
      actor: ACTOR,
    });

    expect(canTransitionDeviceLifecycle(from, to)).toBe(true);
    expect(result).toMatchObject({ ok: true, operation: 'changed', device: { lifecycleStatus: to } });
    if (!result.ok) return;
    expect(result.db.auditLogs).toHaveLength(db.auditLogs.length + 1);
    expect(result.db.auditLogs[0]).toMatchObject({
      id: `audit-${from}-${to}`,
      at: CHANGED_AT,
      userName: ACTOR.name,
      role: ACTOR.role,
      module: 'devices',
      action: 'device.lifecycle.change',
      object: db.devices[0].id,
      oldValue: `lifecycle=${from}`,
    });
    expect(result.db.auditLogs[0].newValue).toContain(`lifecycle=${to}`);
    expect(result.db.auditLogs[0].newValue).not.toContain(db.devices[0].qrPublicId);
  });

  it.each(['in_service', 'spare', 'retired'] as DeviceLifecycleStatus[])('keeps decommissioned terminal and rejects transition to %s', (to) => {
    const db = databaseWithLifecycle('decommissioned');
    const before = JSON.stringify(db);
    const result = changeDeviceLifecycle({
      db,
      deviceId: db.devices[0].id,
      lifecycleStatus: to,
      changedAt: CHANGED_AT,
      auditId: `audit-decommissioned-${to}`,
      actor: ACTOR,
    });

    expect(canTransitionDeviceLifecycle('decommissioned', to)).toBe(false);
    expect(result).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(JSON.stringify(db)).toBe(before);
  });

  it('rejects another unsupported transition without mutation or audit', () => {
    const db = databaseWithLifecycle('in_service');
    const before = JSON.stringify(db);
    const result = changeDeviceLifecycle({
      db,
      deviceId: db.devices[0].id,
      lifecycleStatus: 'decommissioned',
      changedAt: CHANGED_AT,
      auditId: 'audit-invalid-transition',
      actor: ACTOR,
    });

    expect(result).toMatchObject({ ok: false, reason: 'invalid_transition' });
    expect(JSON.stringify(db)).toBe(before);
    expect(db.auditLogs).toHaveLength(generateSeedData().auditLogs.length);
  });

  it('treats a same-state transition as a true no-op before consuming timestamp or audit ID', () => {
    const db = databaseWithLifecycle('in_service');
    const result = changeDeviceLifecycle({
      db,
      deviceId: db.devices[0].id,
      lifecycleStatus: 'in_service',
      changedAt: 'not-a-timestamp',
      auditId: '',
      actor: ACTOR,
    });

    expect(result).toEqual({ ok: true, operation: 'noop', db, device: db.devices[0] });
    expect(result.ok && result.db).toBe(db);
  });

  it('preserves Device identity, operational and technical data, and layout references', () => {
    const db = databaseWithLifecycle('in_service');
    const source = structuredClone(db.devices[0]);
    const layoutReferences = db.layouts.map((layout) => layout.elements.map((element) => element.referenceId));
    const result = changeDeviceLifecycle({
      db,
      deviceId: source.id,
      lifecycleStatus: 'retired',
      changedAt: CHANGED_AT,
      auditId: 'audit-identity-preservation',
      actor: ACTOR,
    });

    expect(result).toMatchObject({ ok: true, operation: 'changed' });
    if (!result.ok) return;
    const { lifecycleStatus: previousLifecycle, ...previousIdentity } = source;
    const { lifecycleStatus: nextLifecycle, ...nextIdentity } = result.device;
    expect(previousLifecycle).toBe('in_service');
    expect(nextLifecycle).toBe('retired');
    expect(nextIdentity).toEqual(previousIdentity);
    expect(result.db.layouts.map((layout) => layout.elements.map((element) => element.referenceId))).toEqual(layoutReferences);
    expect(db.devices[0]).toEqual(source);
  });

  it('rejects empty and duplicate audit IDs for a real transition without mutation', () => {
    const db = databaseWithLifecycle('in_service');
    const duplicateId = db.auditLogs[0].id;
    for (const auditId of ['', duplicateId]) {
      const before = JSON.stringify(db);
      const result = changeDeviceLifecycle({
        db,
        deviceId: db.devices[0].id,
        lifecycleStatus: 'spare',
        changedAt: CHANGED_AT,
        auditId,
        actor: ACTOR,
      });
      expect(result).toMatchObject({ ok: false, reason: 'invalid_audit_id' });
      expect(JSON.stringify(db)).toBe(before);
    }
  });
});
