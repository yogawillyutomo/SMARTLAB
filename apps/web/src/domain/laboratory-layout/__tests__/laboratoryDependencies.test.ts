import { describe, expect, it } from 'vitest';
import { inspectLaboratoryDependencies } from '../index';
import { emptyDependencies } from './fixtures';

describe('inspectLaboratoryDependencies', () => {
  it('allows hard delete when no dependencies exist', () => {
    expect(inspectLaboratoryDependencies(emptyDependencies(), 'lab-1')).toMatchObject({ total: 0, canHardDelete: true });
  });

  it('blocks hard delete when one device exists', () => {
    const source = emptyDependencies();
    source.devices = [{ laboratoryId: 'lab-1' }];
    expect(inspectLaboratoryDependencies(source, 'lab-1')).toMatchObject({ total: 1, canHardDelete: false, counts: { devices: 1 } });
  });

  it('returns every dependency key with zero counts', () => {
    expect(Object.keys(inspectLaboratoryDependencies(emptyDependencies(), 'lab-1').counts)).toEqual([
      'devices', 'assets', 'schedules', 'bookings', 'sessions', 'journals', 'incidents', 'workOrders', 'maintenancePlans', 'maintenanceExecutions',
    ]);
  });

  it('counts multiple collections and excludes unrelated laboratories', () => {
    const source = emptyDependencies();
    source.devices = [{ laboratoryId: 'lab-1' }, { laboratoryId: 'lab-other' }];
    source.assets = [{ laboratoryId: 'lab-1' }];
    source.sessions = [{ laboratoryId: 'lab-1' }, { laboratoryId: 'lab-1' }];
    source.maintenance.plans = [{ laboratoryId: 'lab-1' }];
    const result = inspectLaboratoryDependencies(source, 'lab-1');
    expect(result).toMatchObject({ total: 5, counts: { devices: 1, assets: 1, sessions: 2, maintenancePlans: 1 } });
  });

  it('does not mutate the source object', () => {
    const source = emptyDependencies();
    source.journals = [{ laboratoryId: 'lab-1' }];
    const before = JSON.stringify(source);
    inspectLaboratoryDependencies(source, 'lab-1');
    expect(JSON.stringify(source)).toBe(before);
  });
});
