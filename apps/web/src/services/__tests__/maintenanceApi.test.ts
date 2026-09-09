import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  MaintenanceContractError,
  createMaintenanceGateway,
  maintenanceIfMatch,
  parseMaintenanceCampaign,
  parseMaintenanceExecution,
  parseMaintenancePlan,
  type MaintenanceCampaignDto,
  type MaintenanceExecutionDto,
  type MaintenancePlanDto,
} from '@/services/maintenanceApi';

const PLAN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const EXECUTION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const SCHOOL_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const CAMPAIGN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const CAMPAIGN_ITEM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const LAB_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const USER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const MEMBERSHIP_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB3';

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


function campaign(overrides: Partial<MaintenanceCampaignDto> = {}): MaintenanceCampaignDto {
  return {
    id: CAMPAIGN_ID,
    schoolId: SCHOOL_ID,
    campaignCode: 'MC-20260907-ABC12345',
    laboratoryId: LAB_ID,
    laboratoryCodeSnapshot: 'RPL1',
    laboratoryNameSnapshot: 'Lab RPL 1',
    name: 'Pemeliharaan Bulanan RPL1',
    description: 'Campaign exact-Asset',
    frequencyKind: 'monthly',
    intervalDays: null,
    checklistTemplate: ['Bersihkan fan'],
    assignedTechnicianReference: null,
    assignedTechnicianNameSnapshot: 'Andi',
    nextDueDate: '2026-09-10',
    status: 'active',
    itemCount: 1,
    items: [{
      id: CAMPAIGN_ITEM_ID,
      assetId: ASSET_ID,
      assetCodeSnapshot: 'AST-0001',
      assetNameSnapshot: 'Laptop',
      maintenancePlanId: PLAN_ID,
      planCodeSnapshot: 'MP-20260906-ABC12345',
      createdAt: '2026-09-07T01:00:00.000Z',
    }],
    version: 1,
    createdAt: '2026-09-07T01:00:00.000Z',
    updatedAt: '2026-09-07T01:00:00.000Z',
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
    checklistProgress: null,
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


  it('parses exact Campaign orchestration contract and rejects ambiguous item evidence', () => {
    expect(parseMaintenanceCampaign(campaign())).toEqual(campaign());
    expect(() => parseMaintenanceCampaign({ ...campaign(), itemCount: 2 })).toThrow(MaintenanceContractError);
    expect(() => parseMaintenanceCampaign({ ...campaign(), laboratoryId: 'free-text' })).toThrow(MaintenanceContractError);
    expect(() => parseMaintenanceCampaign({
      ...campaign(),
      items: [{ ...campaign().items[0], maintenancePlanId: 'free-text' }],
    })).toThrow(MaintenanceContractError);
  });

  it('uses versioned Campaign endpoints and batch result counts exactly', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith('/maintenance-campaigns?')) {
        return { data: [campaign()], meta: { page: 1, perPage: 100, total: 1, lastPage: 1 } };
      }
      if (path.endsWith('/history')) {
        return { data: [{
          id: '01ARZ3NDEKTSV4RRFFQ69G5FB4',
          campaignId: CAMPAIGN_ID,
          actorUserIdSnapshot: USER_ID,
          actorMembershipIdSnapshot: MEMBERSHIP_ID,
          actorNameSnapshot: 'Operator',
          eventType: 'maintenance_campaign.created',
          beforeStatus: null,
          afterStatus: 'active',
          payload: { assetCount: 1 },
          createdAt: '2026-09-07T01:00:00.000Z',
        }] };
      }
      return { data: campaign() };
    });
    const post = vi.fn(async (path: string) => {
      if (path.endsWith('/executions')) {
        return { data: campaign({ version: 2 }), executions: [execution()], meta: { executionCount: 1 } };
      }
      return { data: campaign() };
    });
    const gateway = createMaintenanceGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
    }));

    await gateway.listAllCampaigns(LAB_ID);
    await gateway.showCampaign(CAMPAIGN_ID);
    await gateway.campaignHistory(CAMPAIGN_ID);
    await gateway.createCampaign({
      laboratoryId: LAB_ID,
      name: 'Pemeliharaan Bulanan RPL1',
      frequencyKind: 'monthly',
      checklistTemplate: ['Bersihkan fan'],
      nextDueDate: '2026-09-10',
      assetIds: [ASSET_ID],
    });
    await gateway.deactivateCampaign(CAMPAIGN_ID, 1);
    await gateway.activateCampaign(CAMPAIGN_ID, 1);
    const batch = await gateway.scheduleCampaign(CAMPAIGN_ID, 1, {
      scheduledFor: '2026-09-11',
      technicianName: 'Andi',
      assetIds: [ASSET_ID],
    });

    expect(get).toHaveBeenCalledWith(`/maintenance-campaigns?perPage=100&page=1&laboratoryId=${LAB_ID}`);
    expect(batch.executionCount).toBe(1);
    expect(batch.campaign.version).toBe(2);
    expect(post).toHaveBeenCalledWith(
      `/maintenance-campaigns/${CAMPAIGN_ID}/executions`,
      expect.objectContaining({ technicianName: 'Andi' }),
      { ifMatch: '"1"' },
    );
    expect(post).toHaveBeenCalledWith(
      `/maintenance-campaigns/${CAMPAIGN_ID}/deactivate`,
      {},
      { ifMatch: '"1"' },
    );
    expect('deleteCampaign' in gateway).toBe(false);
  });

  it('builds strict ETags', () => {
    expect(maintenanceIfMatch(3)).toBe('"3"');
    expect(() => maintenanceIfMatch(0)).toThrow(MaintenanceContractError);
  });

  it('uses explicit lifecycle endpoints and exposes no delete or arbitrary execution patch', async () => {
    const get = vi.fn(async (path: string) => path.startsWith('/maintenance-plans')
      ? { data: [plan()], meta: { page: 1, perPage: 200, total: 1, lastPage: 1 } }
      : { data: [execution()], meta: { page: 1, perPage: 200, total: 1, lastPage: 1 } });
    const post = vi.fn(async (path: string) => ({
      data: path.includes('/executions') || path.includes('maintenance-executions')
        ? execution()
        : plan(),
    }));
    const patch = vi.fn(async (path: string) => ({
      data: path.includes('maintenance-executions') ? execution({ status: 'in_progress', checklistProgress: [{ item: 'Bersihkan fan', done: true }] }) : plan(),
    }));
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
    await gateway.updateChecklistProgress(EXECUTION_ID, 2, { checklistResults: [true] });
    await gateway.completeExecution(EXECUTION_ID, 2, {
      checklistResults: [true],
      actionTaken: 'Cleaning',
      conditionAfter: 'good',
    });
    await gateway.cancelExecution(EXECUTION_ID, 2, 'Jadwal berubah');

    expect(patch).toHaveBeenCalledWith(`/maintenance-plans/${PLAN_ID}`, { name: 'Updated' }, { ifMatch: '"2"' });
    expect(patch).toHaveBeenCalledWith(`/maintenance-executions/${EXECUTION_ID}/checklist-progress`, { checklistResults: [true] }, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith(`/maintenance-executions/${EXECUTION_ID}/start`, {}, { ifMatch: '"1"' });
    expect('deletePlan' in gateway).toBe(false);
    expect('deleteExecution' in gateway).toBe(false);
    expect('updateExecution' in gateway).toBe(false);
  });
});
