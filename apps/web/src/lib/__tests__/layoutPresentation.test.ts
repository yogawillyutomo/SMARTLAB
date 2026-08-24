import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/apiClient';
import { layoutCapabilities, layoutPresentationIssue, layoutReadPresentationIssue } from '@/lib/layoutPresentation';
import { LayoutContractError } from '@/services/layoutApi';
import type { AuthenticatedUser } from '@/types';

function user(permissions: string[], role: AuthenticatedUser['role'] = 'Super Admin'): AuthenticatedUser {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAA',
    name: 'Admin',
    email: 'admin@example.test',
    school: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAB', code: 'SCH-01', name: 'SmartLab' },
    membership: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAC', status: 'active', roles: [role] },
    permissions,
    role,
  };
}

function apiError(status: number, code: string, errors?: Record<string, string[]>): ApiClientError {
  return new ApiClientError(code, { kind: 'api', status, code, errors });
}

describe('Layout exact server permission capabilities', () => {
  it('fails closed for guests, roles, and prefix-like permission values', () => {
    expect(layoutCapabilities(null)).toEqual({
      view: false, create: false, update: false, delete: false, viewUnplacedDevices: false,
    });
    expect(layoutCapabilities(user([], 'Super Admin'))).toEqual({
      view: false, create: false, update: false, delete: false, viewUnplacedDevices: false,
    });
    expect(layoutCapabilities(user(['layouts', 'LAYOUTS.VIEW', 'devices.view']))).toEqual({
      view: false, create: false, update: false, delete: false, viewUnplacedDevices: false,
    });
  });

  it('derives each action independently and requires both view permissions for unplaced Devices', () => {
    expect(layoutCapabilities(user(['layouts.create', 'layouts.update', 'layouts.delete', 'devices.view']))).toEqual({
      view: false, create: true, update: true, delete: true, viewUnplacedDevices: false,
    });
    expect(layoutCapabilities(user(['layouts.view', 'devices.view']))).toEqual({
      view: true, create: false, update: false, delete: false, viewUnplacedDevices: true,
    });
  });
});

describe('Layout error presentation', () => {
  it('maps auth, permission, and all known operational conflicts', () => {
    expect(layoutPresentationIssue(apiError(401, 'UNAUTHENTICATED'))).toMatchObject({ authBoundary: true, retryable: false });
    expect(layoutPresentationIssue(apiError(403, 'FORBIDDEN'))).toMatchObject({ authBoundary: false, retryable: false });

    for (const code of [
      'LAYOUT_DRAFT_ALREADY_EXISTS',
      'LAYOUT_STATUS_CONFLICT',
      'LAYOUT_LABORATORY_INACTIVE',
      'LAYOUT_DEVICE_ALREADY_PLACED',
      'LAYOUT_DEVICE_HOME_MISMATCH',
      'LAYOUT_DEVICE_NOT_ELIGIBLE',
      'LAYOUT_POSITION_OCCUPIED',
    ]) {
      expect(layoutPresentationIssue(apiError(409, code))).toMatchObject({ retryable: false, versionConflict: false });
    }
  });

  it('classifies Layout, Laboratory, and unknown 404 domains without leaking existence', () => {
    expect(layoutPresentationIssue(apiError(404, 'LAYOUT_NOT_FOUND'))).toMatchObject({
      notFound: true,
      retryable: false,
      message: 'Layout tidak ditemukan pada konteks sekolah aktif.',
    });
    expect(layoutPresentationIssue(apiError(404, 'LABORATORY_NOT_FOUND'))).toMatchObject({
      notFound: true,
      retryable: false,
      message: 'Laboratorium tidak ditemukan pada konteks sekolah aktif.',
    });
    expect(layoutPresentationIssue(apiError(404, 'UNKNOWN_NOT_FOUND'))).toMatchObject({
      notFound: true,
      retryable: false,
      message: 'Data yang diminta tidak ditemukan pada konteks sekolah aktif.',
    });
  });

  it('requires explicit reload/reconciliation for 412 and never marks it retryable', () => {
    expect(layoutPresentationIssue(apiError(412, 'LAYOUT_VERSION_CONFLICT'))).toMatchObject({
      retryable: false,
      versionConflict: true,
      message: expect.stringContaining('tidak dikirim ulang otomatis'),
    });
  });

  it('treats 428 and malformed contract data as client contract failures', () => {
    expect(layoutPresentationIssue(apiError(428, 'PRECONDITION_REQUIRED'))).toMatchObject({
      retryable: false, preconditionFailure: true, contractFailure: true,
    });
    expect(layoutPresentationIssue(new LayoutContractError('bad payload'))).toMatchObject({
      retryable: false, contractFailure: true,
    });
    expect(layoutPresentationIssue(new ApiClientError('bad response', { kind: 'invalid_response' }))).toMatchObject({
      retryable: false, contractFailure: true,
    });
  });

  it('classifies read outages as safely retryable without weakening strict contract failures', () => {
    expect(layoutReadPresentationIssue(new ApiClientError('offline', { kind: 'network' }))).toMatchObject({
      retryable: true,
      contractFailure: false,
      message: 'Layanan Layout tidak dapat dijangkau. Periksa koneksi lalu coba lagi.',
    });

    for (const status of [500, 502, 503]) {
      expect(layoutReadPresentationIssue(new ApiClientError('proxy outage', { kind: 'invalid_response', status }))).toMatchObject({
        retryable: true,
        contractFailure: false,
        message: 'Server Layout sedang tidak dapat dijangkau atau memberikan respons sementara yang tidak dapat diproses. Silakan coba lagi.',
      });
      expect(layoutReadPresentationIssue(apiError(status, 'SERVER_ERROR'))).toMatchObject({
        retryable: true,
        contractFailure: false,
      });
    }

    expect(layoutReadPresentationIssue(new ApiClientError('malformed success', { kind: 'invalid_response', status: 200 }))).toMatchObject({
      retryable: false,
      contractFailure: true,
    });
    expect(layoutReadPresentationIssue(new ApiClientError('missing status', { kind: 'invalid_response' }))).toMatchObject({
      retryable: false,
      contractFailure: true,
    });
  });

  it('keeps malformed mutation responses non-retryable and never replayable', () => {
    expect(layoutPresentationIssue(new ApiClientError('ambiguous mutation response', { kind: 'invalid_response', status: 500 }))).toMatchObject({
      retryable: false,
      contractFailure: true,
    });
  });

  it('surfaces first 422 field errors and distinguishes retryable network/server failures', () => {
    expect(layoutPresentationIssue(apiError(422, 'VALIDATION_FAILED', {
      name: ['Nama wajib diisi.', 'Pesan kedua.'],
      'devicePlacements.0.row': ['Posisi bertabrakan.'],
      empty: [],
    }))).toMatchObject({
      retryable: false,
      fieldErrors: { name: 'Nama wajib diisi.', 'devicePlacements.0.row': 'Posisi bertabrakan.' },
    });
    expect(layoutPresentationIssue(new ApiClientError('offline', { kind: 'network' }))).toMatchObject({ retryable: true });
    expect(layoutPresentationIssue(apiError(503, 'SERVER_ERROR'))).toMatchObject({ retryable: true });
  });
});
