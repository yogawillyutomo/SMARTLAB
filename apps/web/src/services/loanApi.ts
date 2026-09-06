import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';
import { ASSET_CONDITIONS, type AssetCondition } from '@/services/assetApi';

export const LOAN_STATUSES = ['submitted', 'approved', 'rejected', 'cancelled', 'checked_out', 'returned', 'closed'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface LoanItemDto {
  id: string;
  assetId: string;
  assetCodeSnapshot: string;
  assetNameSnapshot: string;
  conditionOut: AssetCondition | null;
  conditionReturn: AssetCondition | null;
  returnNotes: string | null;
  custodyActive: boolean;
}

export interface LoanDto {
  id: string;
  schoolId: string;
  loanNumber: string;
  borrowerReference: string | null;
  borrowerNameSnapshot: string;
  borrowerUnitSnapshot: string | null;
  purpose: string;
  requestedReturnAt: string;
  status: LoanStatus;
  isOverdue: boolean;
  terminalReason: string | null;
  requestedByNameSnapshot: string;
  approvedAt: string | null;
  approvedByNameSnapshot: string | null;
  handedOverAt: string | null;
  handedOverByNameSnapshot: string | null;
  returnedAt: string | null;
  returnedByNameSnapshot: string | null;
  inspectedAt: string | null;
  inspectedByNameSnapshot: string | null;
  version: number;
  items: LoanItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface LoanPage {
  data: LoanDto[];
  meta: { page: number; perPage: number; total: number; lastPage: number };
}

export interface LoanListFilters {
  status?: LoanStatus;
  overdue?: boolean;
  search?: string;
  assetId?: string;
  page?: number;
  perPage?: number;
}

export interface CreateLoanInput {
  borrowerReference?: string | null;
  borrowerName: string;
  borrowerUnit?: string | null;
  purpose: string;
  requestedReturnAt: string;
  assetIds: string[];
}

export interface ReturnLoanItemInput {
  loanItemId: string;
  conditionReturn: AssetCondition;
  returnNotes?: string | null;
}

export interface LoanGateway {
  list: (filters?: LoanListFilters) => Promise<LoanPage>;
  listAll: () => Promise<LoanDto[]>;
  show: (loanId: string) => Promise<LoanDto>;
  create: (input: CreateLoanInput) => Promise<LoanDto>;
  approve: (loanId: string, expectedVersion: number) => Promise<LoanDto>;
  reject: (loanId: string, expectedVersion: number, reason: string) => Promise<LoanDto>;
  cancel: (loanId: string, expectedVersion: number, reason: string) => Promise<LoanDto>;
  checkout: (loanId: string, expectedVersion: number) => Promise<LoanDto>;
  returnLoan: (loanId: string, expectedVersion: number, items: ReturnLoanItemInput[]) => Promise<LoanDto>;
  close: (loanId: string, expectedVersion: number) => Promise<LoanDto>;
}

export class LoanContractError extends Error {
  constructor(message = 'Respons Loan tidak sesuai kontrak API.') {
    super(message);
    this.name = 'LoanContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], message?: string): void {
  const keys = Object.keys(record);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new LoanContractError(message);
  }
}

function requiredString(record: Record<string, unknown>, field: string, max = 2000): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new LoanContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string, max = 2000): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new LoanContractError();
  return value;
}

function requiredUlid(record: Record<string, unknown>, field: string): string {
  const value = requiredString(record, field);
  if (!isUlid(value)) throw new LoanContractError();
  return value;
}

function dateTime(value: unknown, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new LoanContractError();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

const ITEM_FIELDS = [
  'id', 'assetId', 'assetCodeSnapshot', 'assetNameSnapshot',
  'conditionOut', 'conditionReturn', 'returnNotes', 'custodyActive',
] as const;

export function parseLoanItem(value: unknown): LoanItemDto {
  if (!isRecord(value)) throw new LoanContractError();
  assertExactKeys(value, ITEM_FIELDS);
  if (value.conditionOut !== null && !(ASSET_CONDITIONS as readonly unknown[]).includes(value.conditionOut)) throw new LoanContractError();
  if (value.conditionReturn !== null && !(ASSET_CONDITIONS as readonly unknown[]).includes(value.conditionReturn)) throw new LoanContractError();
  if (typeof value.custodyActive !== 'boolean') throw new LoanContractError();

  return {
    id: requiredUlid(value, 'id'),
    assetId: requiredUlid(value, 'assetId'),
    assetCodeSnapshot: requiredString(value, 'assetCodeSnapshot', 64),
    assetNameSnapshot: requiredString(value, 'assetNameSnapshot', 255),
    conditionOut: value.conditionOut as AssetCondition | null,
    conditionReturn: value.conditionReturn as AssetCondition | null,
    returnNotes: nullableString(value, 'returnNotes'),
    custodyActive: value.custodyActive,
  };
}

const LOAN_FIELDS = [
  'id', 'schoolId', 'loanNumber', 'borrowerReference', 'borrowerNameSnapshot',
  'borrowerUnitSnapshot', 'purpose', 'requestedReturnAt', 'status', 'isOverdue',
  'terminalReason', 'requestedByNameSnapshot', 'approvedAt', 'approvedByNameSnapshot',
  'handedOverAt', 'handedOverByNameSnapshot', 'returnedAt', 'returnedByNameSnapshot',
  'inspectedAt', 'inspectedByNameSnapshot', 'version', 'items', 'createdAt', 'updatedAt',
] as const;

export function parseLoan(value: unknown): LoanDto {
  if (!isRecord(value)) throw new LoanContractError();
  assertExactKeys(value, LOAN_FIELDS);
  if (!(LOAN_STATUSES as readonly unknown[]).includes(value.status)) throw new LoanContractError();
  if (typeof value.isOverdue !== 'boolean') throw new LoanContractError();
  if (!positiveInteger(value.version)) throw new LoanContractError();
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 20) throw new LoanContractError();

  return {
    id: requiredUlid(value, 'id'),
    schoolId: requiredUlid(value, 'schoolId'),
    loanNumber: requiredString(value, 'loanNumber', 48),
    borrowerReference: nullableString(value, 'borrowerReference', 255),
    borrowerNameSnapshot: requiredString(value, 'borrowerNameSnapshot', 255),
    borrowerUnitSnapshot: nullableString(value, 'borrowerUnitSnapshot', 255),
    purpose: requiredString(value, 'purpose'),
    requestedReturnAt: dateTime(value.requestedReturnAt) as string,
    status: value.status as LoanStatus,
    isOverdue: value.isOverdue,
    terminalReason: nullableString(value, 'terminalReason', 1000),
    requestedByNameSnapshot: requiredString(value, 'requestedByNameSnapshot', 255),
    approvedAt: dateTime(value.approvedAt, true),
    approvedByNameSnapshot: nullableString(value, 'approvedByNameSnapshot', 255),
    handedOverAt: dateTime(value.handedOverAt, true),
    handedOverByNameSnapshot: nullableString(value, 'handedOverByNameSnapshot', 255),
    returnedAt: dateTime(value.returnedAt, true),
    returnedByNameSnapshot: nullableString(value, 'returnedByNameSnapshot', 255),
    inspectedAt: dateTime(value.inspectedAt, true),
    inspectedByNameSnapshot: nullableString(value, 'inspectedByNameSnapshot', 255),
    version: value.version,
    items: value.items.map(parseLoanItem),
    createdAt: dateTime(value.createdAt) as string,
    updatedAt: dateTime(value.updatedAt) as string,
  };
}

function parseLoanResponse(value: unknown): LoanDto {
  if (!isRecord(value)) throw new LoanContractError('Envelope Loan tidak valid.');
  assertExactKeys(value, ['data'], 'Envelope Loan tidak valid.');
  return parseLoan(value.data);
}

function parseLoanPage(value: unknown): LoanPage {
  if (!isRecord(value)) throw new LoanContractError('Envelope koleksi Loan tidak valid.');
  assertExactKeys(value, ['data', 'meta'], 'Envelope koleksi Loan tidak valid.');
  if (!Array.isArray(value.data) || !isRecord(value.meta)) throw new LoanContractError('Envelope koleksi Loan tidak valid.');
  assertExactKeys(value.meta, ['page', 'perPage', 'total', 'lastPage'], 'Metadata koleksi Loan tidak valid.');
  const { page, perPage, total, lastPage } = value.meta;
  if (!positiveInteger(page) || !positiveInteger(perPage) || perPage > 200 || !nonNegativeInteger(total) || !positiveInteger(lastPage)) {
    throw new LoanContractError('Metadata koleksi Loan tidak valid.');
  }
  return { data: value.data.map(parseLoan), meta: { page, perPage, total, lastPage } };
}

export function loanIfMatch(version: number): string {
  if (!positiveInteger(version)) throw new LoanContractError('Versi Loan tidak valid.');
  return `"${version}"`;
}

export function loanPath(loanId: string): string {
  if (loanId.trim() === '') throw new LoanContractError('ID Loan tidak valid.');
  return `/loans/${encodeURIComponent(loanId)}`;
}

export function buildLoanListPath(filters: LoanListFilters = {}): string {
  const parameters = new URLSearchParams();
  if (filters.status !== undefined) parameters.set('status', filters.status);
  if (filters.overdue !== undefined) parameters.set('overdue', filters.overdue ? '1' : '0');
  if (filters.search !== undefined) {
    const value = filters.search.trim();
    if (value.length === 0 || value.length > 255) throw new LoanContractError('Pencarian Loan tidak valid.');
    parameters.set('search', value);
  }
  if (filters.assetId !== undefined) parameters.set('assetId', filters.assetId);
  if (filters.page !== undefined) parameters.set('page', String(filters.page));
  if (filters.perPage !== undefined) parameters.set('perPage', String(filters.perPage));
  const query = parameters.toString();
  return query === '' ? '/loans' : `/loans?${query}`;
}

function actionPath(loanId: string, action: string): string {
  return `${loanPath(loanId)}/${action}`;
}

export function createLoanGateway(client: ApiClient): LoanGateway {
  return {
    async list(filters = {}) {
      return parseLoanPage(await client.get<unknown>(buildLoanListPath(filters)));
    },
    async listAll() {
      const first = parseLoanPage(await client.get<unknown>(buildLoanListPath({ page: 1, perPage: 200 })));
      if (first.meta.lastPage === 1) return first.data;
      const pages = await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
        client.get<unknown>(buildLoanListPath({ page: index + 2, perPage: 200 }))));
      return [...first.data, ...pages.flatMap((page) => parseLoanPage(page).data)];
    },
    async show(loanId) {
      return parseLoanResponse(await client.get<unknown>(loanPath(loanId)));
    },
    async create(input) {
      return parseLoanResponse(await client.post<unknown>('/loans', {
        ...(input.borrowerReference !== undefined ? { borrowerReference: input.borrowerReference } : {}),
        borrowerName: input.borrowerName,
        ...(input.borrowerUnit !== undefined ? { borrowerUnit: input.borrowerUnit } : {}),
        purpose: input.purpose,
        requestedReturnAt: input.requestedReturnAt,
        assetIds: input.assetIds,
      }));
    },
    async approve(loanId, expectedVersion) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'approve'), {}, { ifMatch: loanIfMatch(expectedVersion) }));
    },
    async reject(loanId, expectedVersion, reason) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'reject'), { reason }, { ifMatch: loanIfMatch(expectedVersion) }));
    },
    async cancel(loanId, expectedVersion, reason) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'cancel'), { reason }, { ifMatch: loanIfMatch(expectedVersion) }));
    },
    async checkout(loanId, expectedVersion) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'checkout'), {}, { ifMatch: loanIfMatch(expectedVersion) }));
    },
    async returnLoan(loanId, expectedVersion, items) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'return'), { items }, { ifMatch: loanIfMatch(expectedVersion) }));
    },
    async close(loanId, expectedVersion) {
      return parseLoanResponse(await client.post<unknown>(actionPath(loanId, 'close'), {}, { ifMatch: loanIfMatch(expectedVersion) }));
    },
  };
}

export const loanGateway = createLoanGateway(apiClient);
