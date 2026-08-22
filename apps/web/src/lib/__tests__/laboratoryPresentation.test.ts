import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import {
  SubmissionGate,
  changedLaboratoryFields,
  laboratoryPresentationIssue,
  sortLaboratories,
  validateLaboratoryForm,
} from '@/lib/laboratoryPresentation';
import type { LaboratoryDto } from '@/services/laboratoryApi';

const laboratory: LaboratoryDto = {
  id: '01LAB1',
  schoolId: '01SCHOOL1',
  code: 'LAB-2',
  name: 'Lab Dua',
  location: 'Gedung A',
  capacity: 36,
  status: 'active',
  createdAt: '2026-08-22T10:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

describe('Laboratory form and deterministic state helpers', () => {
  it('requires a positive integer capacity and canonical required fields', () => {
    const result = validateLaboratoryForm({ code: '', name: '', location: '', capacity: '1.5', status: 'active' });
    expect(result).toEqual({
      ok: false,
      errors: {
        code: 'Kode laboratorium wajib diisi.',
        name: 'Nama laboratorium wajib diisi.',
        location: 'Lokasi laboratorium wajib diisi.',
        capacity: 'Kapasitas harus berupa bilangan bulat minimal 1.',
      },
    });
  });

  it('builds only changed mutable fields for PATCH', () => {
    expect(changedLaboratoryFields(laboratory, {
      code: laboratory.code,
      name: 'Lab Dua Diperbarui',
      location: laboratory.location,
      capacity: laboratory.capacity,
      status: 'inactive',
    })).toEqual({ name: 'Lab Dua Diperbarui', status: 'inactive' });
  });

  it('sorts server records deterministically by code and ID', () => {
    expect(sortLaboratories([
      { ...laboratory, id: '02', code: 'LAB-B' },
      { ...laboratory, id: '03', code: 'LAB-A' },
      { ...laboratory, id: '01', code: 'LAB-B' },
    ]).map(({ id }) => id)).toEqual(['03', '01', '02']);
  });

  it('prevents duplicate submission until the active request finishes', () => {
    const gate = new SubmissionGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.end();
    expect(gate.begin()).toBe(true);
  });
});

describe('Laboratory API issue presentation', () => {
  it('maps 422 errors to safe field messages', () => {
    const issue = laboratoryPresentationIssue(new ApiClientError('Validation failed.', {
      kind: 'api',
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: { code: ['Kode sudah digunakan.'], schoolId: ['Must not be sent.'] },
    }));
    expect(issue.message).toBe('Periksa kembali data laboratorium yang dimasukkan.');
    expect(issue.fieldErrors).toEqual({ code: 'Kode sudah digunakan.' });
    expect(issue.retryable).toBe(false);
  });

  it('distinguishes 404, auth boundaries, forbidden, network, server, and configuration errors', () => {
    expect(laboratoryPresentationIssue(new ApiClientError('missing', { kind: 'api', status: 404, code: 'LABORATORY_NOT_FOUND' })).notFound).toBe(true);
    expect(laboratoryPresentationIssue(new ApiClientError('guest', { kind: 'api', status: 401, code: 'UNAUTHENTICATED' })).authBoundary).toBe(true);
    expect(laboratoryPresentationIssue(new ApiClientError('context', { kind: 'api', status: 409, code: 'SCHOOL_CONTEXT_REQUIRED' })).authBoundary).toBe(true);
    expect(laboratoryPresentationIssue(new ApiClientError('forbidden', { kind: 'api', status: 403, code: 'FORBIDDEN' })).retryable).toBe(false);
    expect(laboratoryPresentationIssue(new ApiClientError('offline', { kind: 'network' })).retryable).toBe(true);
    expect(laboratoryPresentationIssue(new ApiClientError('server', { kind: 'api', status: 500, code: 'SERVER_ERROR' })).retryable).toBe(true);
    expect(laboratoryPresentationIssue(new ApiClientError('config', { kind: 'configuration' })).retryable).toBe(false);
  });
});
