import type { ID } from '@/types';
import type {
  LaboratoryBoundRecord,
  LaboratoryDependencyKey,
  LaboratoryDependencySource,
  LaboratoryDependencySummary,
} from './types';

const KEYS: readonly LaboratoryDependencyKey[] = [
  'devices', 'assets', 'schedules', 'bookings', 'sessions', 'journals', 'incidents', 'workOrders', 'maintenancePlans', 'maintenanceExecutions',
];

function count(records: readonly LaboratoryBoundRecord[], laboratoryId: ID): number {
  return records.filter((record) => record.laboratoryId === laboratoryId).length;
}

export function inspectLaboratoryDependencies(source: LaboratoryDependencySource, laboratoryId: ID): LaboratoryDependencySummary {
  const counts: Record<LaboratoryDependencyKey, number> = {
    devices: count(source.devices, laboratoryId),
    assets: count(source.assets, laboratoryId),
    schedules: count(source.schedules, laboratoryId),
    bookings: count(source.bookings, laboratoryId),
    sessions: count(source.sessions, laboratoryId),
    journals: count(source.journals, laboratoryId),
    incidents: count(source.incidents, laboratoryId),
    workOrders: count(source.workOrders, laboratoryId),
    maintenancePlans: count(source.maintenance.plans, laboratoryId),
    maintenanceExecutions: count(source.maintenance.executions, laboratoryId),
  };
  const total = KEYS.reduce((sum, key) => sum + counts[key], 0);
  return { laboratoryId, counts, total, canHardDelete: total === 0 };
}
