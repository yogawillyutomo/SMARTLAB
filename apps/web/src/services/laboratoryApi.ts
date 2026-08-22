import { apiClient, type ApiClient } from '@/lib/apiClient';

export type LaboratoryStatus = 'active' | 'inactive';

export interface LaboratoryDto {
  id: string;
  schoolId: string;
  code: string;
  name: string;
  location: string;
  capacity: number;
  status: LaboratoryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLaboratoryInput {
  code: string;
  name: string;
  location: string;
  capacity: number;
  status: LaboratoryStatus;
}

export type UpdateLaboratoryInput = Partial<CreateLaboratoryInput>;

export interface LaboratoryGateway {
  list: () => Promise<LaboratoryDto[]>;
  show: (laboratoryId: string) => Promise<LaboratoryDto>;
  create: (input: CreateLaboratoryInput) => Promise<LaboratoryDto>;
  update: (laboratoryId: string, input: UpdateLaboratoryInput) => Promise<LaboratoryDto>;
}

export class LaboratoryContractError extends Error {
  constructor(message = 'Respons Laboratory tidak sesuai kontrak API.') {
    super(message);
    this.name = 'LaboratoryContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, field: keyof LaboratoryDto): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') throw new LaboratoryContractError();
  return value;
}

function requiredDateTime(record: Record<string, unknown>, field: 'createdAt' | 'updatedAt'): string {
  const value = requiredString(record, field);
  if (Number.isNaN(Date.parse(value))) throw new LaboratoryContractError();
  return value;
}

export function parseLaboratory(value: unknown): LaboratoryDto {
  if (!isRecord(value)) throw new LaboratoryContractError();
  const capacity = value.capacity;
  const status = value.status;
  if (!Number.isInteger(capacity) || (capacity as number) < 1) throw new LaboratoryContractError();
  if (status !== 'active' && status !== 'inactive') throw new LaboratoryContractError();

  return {
    id: requiredString(value, 'id'),
    schoolId: requiredString(value, 'schoolId'),
    code: requiredString(value, 'code'),
    name: requiredString(value, 'name'),
    location: requiredString(value, 'location'),
    capacity: capacity as number,
    status,
    createdAt: requiredDateTime(value, 'createdAt'),
    updatedAt: requiredDateTime(value, 'updatedAt'),
  };
}

export function parseLaboratoryResponse(value: unknown): LaboratoryDto {
  if (!isRecord(value) || !('data' in value)) throw new LaboratoryContractError('Envelope Laboratory tidak valid.');
  return parseLaboratory(value.data);
}

export function parseLaboratoryCollectionResponse(value: unknown): LaboratoryDto[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new LaboratoryContractError('Envelope koleksi Laboratory tidak valid.');
  }
  return value.data.map(parseLaboratory);
}

export function buildCreateLaboratoryPayload(input: CreateLaboratoryInput): CreateLaboratoryInput {
  return {
    code: input.code,
    name: input.name,
    location: input.location,
    capacity: input.capacity,
    status: input.status,
  };
}

export function buildUpdateLaboratoryPayload(input: UpdateLaboratoryInput): UpdateLaboratoryInput {
  const payload: UpdateLaboratoryInput = {};
  if (input.code !== undefined) payload.code = input.code;
  if (input.name !== undefined) payload.name = input.name;
  if (input.location !== undefined) payload.location = input.location;
  if (input.capacity !== undefined) payload.capacity = input.capacity;
  if (input.status !== undefined) payload.status = input.status;
  if (Object.keys(payload).length === 0) throw new LaboratoryContractError('Tidak ada field Laboratory yang dapat diperbarui.');
  return payload;
}

export function laboratoryPath(laboratoryId: string): string {
  if (laboratoryId.trim() === '') throw new LaboratoryContractError('ID Laboratory tidak valid.');
  return `/laboratories/${encodeURIComponent(laboratoryId)}`;
}

export function createLaboratoryGateway(client: ApiClient): LaboratoryGateway {
  return {
    async list() {
      return parseLaboratoryCollectionResponse(await client.get<unknown>('/laboratories'));
    },
    async show(laboratoryId) {
      return parseLaboratoryResponse(await client.get<unknown>(laboratoryPath(laboratoryId)));
    },
    async create(input) {
      return parseLaboratoryResponse(await client.post<unknown>('/laboratories', buildCreateLaboratoryPayload(input)));
    },
    async update(laboratoryId, input) {
      return parseLaboratoryResponse(await client.patch<unknown>(laboratoryPath(laboratoryId), buildUpdateLaboratoryPayload(input)));
    },
  };
}

export const laboratoryGateway = createLaboratoryGateway(apiClient);
