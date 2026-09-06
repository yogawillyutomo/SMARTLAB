import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  LoanContractError,
  buildLoanListPath,
  createLoanGateway,
  loanIfMatch,
  parseLoan,
  type LoanDto,
} from '@/services/loanApi';

function loan(overrides: Partial<LoanDto> = {}): LoanDto {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    loanNumber: 'LOAN-20260906-ABC12345',
    borrowerReference: null,
    borrowerNameSnapshot: 'Budi Santoso',
    borrowerUnitSnapshot: 'XI PPLG 1',
    purpose: 'Praktikum',
    requestedReturnAt: '2026-09-07T01:00:00.000Z',
    status: 'approved',
    isOverdue: false,
    terminalReason: null,
    requestedByNameSnapshot: 'Guru',
    approvedAt: '2026-09-06T01:00:00.000Z',
    approvedByNameSnapshot: 'Kepala Lab',
    handedOverAt: null,
    handedOverByNameSnapshot: null,
    returnedAt: null,
    returnedByNameSnapshot: null,
    inspectedAt: null,
    inspectedByNameSnapshot: null,
    version: 2,
    items: [{
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      assetId: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
      assetCodeSnapshot: 'AST-0001',
      assetNameSnapshot: 'Laptop',
      conditionOut: null,
      conditionReturn: null,
      returnNotes: null,
      custodyActive: false,
    }],
    createdAt: '2026-09-06T00:30:00.000Z',
    updatedAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: loan() })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: loan() })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: loan() })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: loan() })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Loan API contract', () => {
  it('parses exact Loan/LoanItem identity and rejects legacy quantity/status drift', () => {
    expect(parseLoan(loan())).toEqual(loan());
    expect(() => parseLoan({ ...loan(), quantity: 2 })).toThrow(LoanContractError);
    expect(() => parseLoan({ ...loan(), status: 'overdue' })).toThrow(LoanContractError);
    expect(() => parseLoan({ ...loan(), items: [{ ...loan().items[0], assetId: 'free-text' }] })).toThrow(LoanContractError);
  });

  it('builds canonical query paths and ETag preconditions', () => {
    expect(buildLoanListPath({ status: 'checked_out', overdue: true, search: ' Budi ' }))
      .toBe('/loans?status=checked_out&overdue=1&search=Budi');
    expect(loanIfMatch(4)).toBe('"4"');
    expect(() => loanIfMatch(0)).toThrow(LoanContractError);
  });

  it('uses explicit lifecycle action endpoints and never exposes arbitrary Loan PATCH/delete', async () => {
    const current = loan();
    const get = vi.fn(async (path: string) => path.startsWith('/loans?')
      ? { data: [current], meta: { page: 1, perPage: 200, total: 1, lastPage: 1 } }
      : { data: current });
    const post = vi.fn(async () => ({ data: current }));
    const gateway = createLoanGateway(clientWith({ get: get as ApiClient['get'], post: post as ApiClient['post'] }));

    await gateway.listAll();
    await gateway.create({
      borrowerName: 'Budi',
      purpose: 'Praktikum',
      requestedReturnAt: '2026-09-07T01:00:00.000Z',
      assetIds: [current.items[0].assetId],
    });
    await gateway.approve(current.id, 2);
    await gateway.reject(current.id, 2, 'Tidak tersedia');
    await gateway.cancel(current.id, 2, 'Dibatalkan');
    await gateway.checkout(current.id, 2);
    await gateway.returnLoan(current.id, 2, [{
      loanItemId: current.items[0].id,
      conditionReturn: 'good',
      returnNotes: null,
    }]);
    await gateway.close(current.id, 2);

    expect(post).toHaveBeenCalledWith(`/loans/${current.id}/approve`, {}, { ifMatch: '"2"' });
    expect(post).toHaveBeenCalledWith(`/loans/${current.id}/return`, {
      items: [{ loanItemId: current.items[0].id, conditionReturn: 'good', returnNotes: null }],
    }, { ifMatch: '"2"' });
    expect('update' in gateway).toBe(false);
    expect('delete' in gateway).toBe(false);
    expect('markOverdue' in gateway).toBe(false);
  });
});
