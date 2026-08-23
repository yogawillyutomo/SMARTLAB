import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  LaboratoryContractError,
  buildCreateLaboratoryPayload,
  buildUpdateLaboratoryPayload,
  createLaboratoryGateway,
  laboratoryPath,
  parseLaboratoryCollectionResponse,
  parseLaboratoryResponse,
  type CreateLaboratoryInput,
} from '@/services/laboratoryApi';

const laboratory = {
  id: '01LABORATORY00000000000001',
  schoolId: '01SCHOOL000000000000000001',
  code: 'LAB-RPL-1',
  name: 'Laboratorium RPL 1',
  location: 'Gedung A Lantai 2',
  capacity: 36,
  status: 'active' as const,
  createdAt: '2026-08-22T10:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: [laboratory] })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: laboratory })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: laboratory })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: laboratory })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Laboratory response parsing', () => {
  it('parses valid collection and single envelopes into canonical DTOs', () => {
    expect(parseLaboratoryCollectionResponse({ data: [laboratory] })).toEqual([laboratory]);
    expect(parseLaboratoryResponse({ data: laboratory })).toEqual(laboratory);
  });

  it.each([
    undefined,
    {},
    { data: null },
    { data: {} },
  ])('rejects malformed collection envelopes', (value) => {
    expect(() => parseLaboratoryCollectionResponse(value)).toThrow(LaboratoryContractError);
  });

  it.each([
    undefined,
    {},
    { data: null },
    { items: laboratory },
  ])('rejects malformed single envelopes', (value) => {
    expect(() => parseLaboratoryResponse(value)).toThrow(LaboratoryContractError);
  });

  it.each([
    ['status', 'maintenance'],
    ['capacity', 0],
    ['capacity', 1.5],
    ['capacity', '36'],
    ['name', null],
    ['code', ''],
    ['createdAt', 'not-a-date'],
  ])('rejects invalid Laboratory field %s', (field, value) => {
    expect(() => parseLaboratoryResponse({ data: { ...laboratory, [field]: value } })).toThrow(LaboratoryContractError);
  });
});

describe('Laboratory mutation boundary', () => {
  const mutable: CreateLaboratoryInput = {
    code: laboratory.code,
    name: laboratory.name,
    location: laboratory.location,
    capacity: laboratory.capacity,
    status: laboratory.status,
  };

  it('allowlists create and update payloads', () => {
    const source = {
      ...mutable,
      id: laboratory.id,
      schoolId: laboratory.schoolId,
      createdAt: laboratory.createdAt,
      updatedAt: laboratory.updatedAt,
      headName: 'Tidak boleh terkirim',
      technicianName: 'Tidak boleh terkirim',
      pcCount: 36,
      layoutRows: 6,
      layoutCols: 6,
    };

    expect(buildCreateLaboratoryPayload(source)).toEqual(mutable);
    expect(buildUpdateLaboratoryPayload(source)).toEqual(mutable);
  });

  it('rejects an update with no mutable fields', () => {
    expect(() => buildUpdateLaboratoryPayload({})).toThrow(LaboratoryContractError);
  });

  it('uses exact endpoints, safely encodes IDs, and exposes no delete operation', async () => {
    const get = vi.fn(async (path: string) => path === '/laboratories' ? { data: [laboratory] } : { data: laboratory });
    const post = vi.fn(async () => ({ data: laboratory }));
    const patch = vi.fn(async () => ({ data: laboratory }));
    const gateway = createLaboratoryGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.list();
    await gateway.show('lab/id with spaces');
    await gateway.create(mutable);
    await gateway.update('lab/id with spaces', { status: 'inactive' });

    expect(get.mock.calls.map(([path]) => path)).toEqual(['/laboratories', '/laboratories/lab%2Fid%20with%20spaces']);
    expect(post).toHaveBeenCalledWith('/laboratories', mutable);
    expect(patch).toHaveBeenCalledWith('/laboratories/lab%2Fid%20with%20spaces', { status: 'inactive' });
    expect('remove' in gateway).toBe(false);
  });

  it('rejects empty IDs instead of building an unsafe path', () => {
    expect(() => laboratoryPath('   ')).toThrow(LaboratoryContractError);
  });
});
