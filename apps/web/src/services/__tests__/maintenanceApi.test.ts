import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  MaintenanceContractError,
  createMaintenanceGateway,
  maintenanceIfMatch,
  parseMaintenanceExecution,
  parseMaintenancePlan,
  type MaintenanceExecutionDto,
  type MaintenancePlanDto,
} from '@/services/maintenanceApi';

const PLAN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const EXECUTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const SCHOOL_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

function plan(overrides: Partial<MaintenancePlanDto> = {}): MaintenancePlanDto {
  return {
    id: PLAN_ID,
    schoolId: SCHOOL_ID,
    planCode: 'MP-20260906-ABC12345',
    assetId: ASSET_ID,
    assetCodeSnapshot: 'AST-0001',
    assetNameSnapshot: 'Laptop',
    name: 'Preventive Laptop',
    frequencyKind: 'monthly',
    intervalDays: null,
    checklistTemplate: ['Bersihkan fan'],
    assignedTechnicianReference: null,
    assignedTechnicianNameSnapshot: 'Andi',
    nextDueDate: '2026-09-10',
    status: 'active',
    isOverdue: false,
    version: 2,
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:10:00.000Z',
    ...overrides,
  };
}

function execution(overrides: Partial<MaintenanceExecutionDto> = {}): MaintenanceExecutionDto {
  return {
    id: EXECUTION_ID,
    schoolId: SCHOOL_ID,
    executionNumber: 'ME-20260906-ABC12345',
    maintenancePlanId: PLAN_ID,
    planCodeSnapshot: 'MP-20260906-ABC12345',
    assetId: ASSET_ID,
    assetCodeSnapshot: 'AST-0001',
    assetNameSnapshot: 'Laptop',
    scheduledFor: '2026-09-06',
    status: 'scheduled',
    checklistSnapshot: ['Bersihkan fan'],
    checklistResults: null,
    findings: null,
    actionTaken: null,
    conditionBefore: null,
    conditionAfter: null,
    technicianReference: null,
    technicianNameSnapshot: 'Andi',
    assetVersionAtStart: null,
    custodyActive: false,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    version: 1,
    inventoryTransactions: [],
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: plan() })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: execution() })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: plan() })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: plan() })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Preventive Maintenance API contract', () => {
  it('parses exact plan/execution contracts and rejects local authority drift', () => {
    expect(parseMaintenancePlan(plan())).toEqual(plan());
    expect(parseMaintenanceExecution(execution())).toEqual(execution());
    expect(() => parseMaintenancePlan({ ...plan(), assetCategory: 'Laptop' })).toThrow(MaintenanceContractError);
    expect(() => parseMaintenanceExecution({ ...execution(), status: 'repairing' })).toThrow(MaintenanceContractError);
    expect(() => parseMaintenanceExecution({ ...execution(), assetId: 'free-text' })).toThrow(MaintenanceContractError);
  });

  it('builds strict ETags', () => {
    expect(maintenanceIfMatch(3)).toBe('"3"');
    expect(() => maintenanceIfMatch(0)).toThrow(MaintenanceContractError);
  });

  it('uses explicit lifecycle endpoints and exposes no delete or arbitrary execution patch', async () => {
    const get = vi.fn(async (path: string) => path.startsWith('/maintenance-plans')
      ? { data: [plan()], meta: { page: 1, perPage: 200, total: 1, lastPage: 1 } }
      : { data: [execution()], meta: { page: 1, perPage: 200, total: 1, lastPage: 1 } });
    const post = vi.fn(async (path: string) => ({ data: path.includes('maintenance-plans') ? plan() : execution() }));
    const patch = vi.fn(async () => ({ data: plan() }));
    const gateway = createMaintenanceGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.listAllPlans();
    await gateway.listAllExecutions();
    await gateway.updatePlan(PLAN_ID, 2, { name: 'Updated' });
    await gateway.activatePlan(PLAN_ID, 2);
    await gateway.deactivatePlan(PLAN_ID, 2);
    await gateway.scheduleExecution(PLAN_ID, 2, { scheduledFor: '2026-09-07', technicianName: 'Andi' });
    await gateway.startExecution(EXECUTION_ID, 1);
    await gateway.completeExecution(EXECUTION_ID, 2, {
      checklistResults: [true],
      actionTaken: 'Cleaning',
      conditionAfter: 'good',
    });
    await gateway.cancelExecution(EXECUTION_ID, 2, 'Jadwal berubah');

    expect(patch).toHaveBeenCalledWith(`/maintenance-plans/${PLAN_ID}`, { name: 'Updated' }, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith(`/maintenance-executions/${EXECUTION_ID}/start`, {}, { ifMatch: '"1"' });
    expect('deletePlan' in gateway).toBe(false);
    expect('deleteExecution' in gateway).toBe(false);
    expect('updateExecution' in gateway).toBe(false);
  });
});
