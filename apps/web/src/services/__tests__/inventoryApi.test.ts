import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  InventoryContractError,
  buildInventoryItemListPath,
  buildInventoryTransactionListPath,
  createInventoryGateway,
  inventoryItemIfMatch,
  parseInventoryItem,
  parseInventoryTransaction,
  type InventoryItemDto,
  type InventoryTransactionDto,
} from '@/services/inventoryApi';

function item(overrides: Partial<InventoryItemDto> = {}): InventoryItemDto {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    itemCode: 'STK-0001',
    name: 'RAM DDR4',
    category: 'Spare Part',
    unit: 'pcs',
    minimumStock: 1,
    storageLocation: null,
    supplierName: null,
    unitPriceSnapshot: null,
    onHandQuantity: 2.5,
    version: 3,
    createdAt: '2026-09-06T01:00:00.000Z',
    updatedAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  };
}

function transaction(overrides: Partial<InventoryTransactionDto> = {}): InventoryTransactionDto {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
    schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    inventoryItemId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    clientMutationId: '550e8400-e29b-41d4-a716-446655440000',
    kind: 'receipt',
    quantity: 1.25,
    signedDelta: 1.25,
    balanceBefore: 1.25,
    balanceAfter: 2.5,
    itemVersionAfter: 3,
    reason: 'Receipt',
    sourceType: null,
    sourceId: null,
    actorUserIdSnapshot: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
    actorMembershipIdSnapshot: '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
    actorNameSnapshot: 'Admin',
    itemCodeSnapshot: 'STK-0001',
    itemNameSnapshot: 'RAM DDR4',
    unitSnapshot: 'pcs',
    occurredAt: '2026-09-06T01:00:00.000Z',
    createdAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: item() })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: item() })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: item() })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: item() })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Inventory contract parser', () => {
  it('parses exact canonical item and transaction shapes', () => {
    expect(parseInventoryItem(item())).toEqual(item());
    expect(parseInventoryTransaction(transaction())).toEqual(transaction());
  });

  it('rejects malformed balance math and protected legacy fields', () => {
    expect(() => parseInventoryItem({ ...item(), quantity: 2.5 })).toThrow(InventoryContractError);
    expect(() => parseInventoryItem({ ...item(), onHandQuantity: -1 })).toThrow(InventoryContractError);
    expect(() => parseInventoryTransaction({ ...transaction(), balanceAfter: 9 })).toThrow(InventoryContractError);
    expect(() => parseInventoryTransaction({ ...transaction(), signedDelta: 2 })).toThrow(InventoryContractError);
  });

  it('builds explicit canonical list paths and If-Match', () => {
    expect(buildInventoryItemListPath({ page: 2, perPage: 50, search: ' RAM 8GB ', lowStock: true }))
      .toBe('/stock-items?page=2&perPage=50&search=RAM+8GB&lowStock=1');
    expect(buildInventoryTransactionListPath({ page: 1, kind: 'issue', inventoryItemId: 'item/id' }))
      .toBe('/stock-transactions?page=1&inventoryItemId=item%2Fid&kind=issue');
    expect(inventoryItemIfMatch(3)).toBe('"3"');
    expect(() => inventoryItemIfMatch(0)).toThrow(InventoryContractError);
  });

  it('uses metadata endpoints and one explicit immutable movement endpoint', async () => {
    const current = item();
    const tx = transaction();
    const get = vi.fn(async (path: string) => path.startsWith('/stock-transactions')
      ? { data: [tx], meta: { page: 1, perPage: 500, total: 1, lastPage: 1 } }
      : path.startsWith('/stock-items?')
        ? { data: [current], meta: { page: 1, perPage: 500, total: 1, lastPage: 1 } }
        : { data: current });
    const post = vi.fn(async (path: string) => path === '/stock-transactions'
      ? { data: tx, meta: { replayed: false } }
      : { data: current });
    const patch = vi.fn(async () => ({ data: current }));
    const gateway = createInventoryGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.listAllItems();
    await gateway.listAllTransactions();
    await gateway.createItem({ itemCode: 'STK-1', name: 'A', category: 'C', unit: 'pcs' });
    await gateway.updateItem(current.id, 3, { minimumStock: 2 });
    await gateway.transact({
      inventoryItemId: current.id,
      clientMutationId: tx.clientMutationId,
      kind: 'receipt',
      quantity: 1.25,
      reason: 'Receipt',
    });

    expect(patch).toHaveBeenCalledWith(`/stock-items/${current.id}`, { minimumStock: 2 }, { ifMatch: '"3"' });
    expect(post).toHaveBeenCalledWith('/stock-transactions', {
      inventoryItemId: current.id,
      clientMutationId: tx.clientMutationId,
      kind: 'receipt',
      quantity: 1.25,
      reason: 'Receipt',
    });
    expect('removeItem' in gateway).toBe(false);
    expect('updateTransaction' in gateway).toBe(false);
  });
});
