import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { hasServerPermission } from '@/lib/authIdentity';
import { ApiClientError } from '@/lib/apiClient';
import {
  INCIDENT_STATUS_LABELS,
  emptyIncidentCreateForm,
  incidentCreateOutcomeIsAmbiguous,
  validateIncidentCreateForm,
} from '@/lib/incidentPresentation';
import {
  IncidentCreateFormFields,
  IncidentListView,
  type IncidentListState,
} from '@/pages/IncidentApiPages';
import { IncidentContractError, type IncidentListItem, type IncidentReportingLaboratoryDto } from '@/services/incidentApi';
import type { AuthenticatedUser } from '@/types';

const incident: IncidentListItem = {
  id: '01incident000000000000000001',
  ticketNumber: 'INC-2026-000001',
  reporter: { userId: '01user00000000000000000001', name: 'Pelapor' },
  laboratory: { id: '01lab000000000000000000001', code: 'LAB-RPL-1', name: 'Lab RPL 1' },
  device: { id: '01dev000000000000000000001', deviceCode: 'PC-0001', deviceType: 'desktop_pc' },
  category: 'hardware',
  priority: 'critical',
  title: 'Komputer gagal melakukan boot',
  blocksLaboratoryOperation: true,
  status: 'reported',
  assignee: null,
  version: 1,
  occurredAt: '2026-09-03T00:00:00.000Z',
  reportedAt: '2026-09-03T00:01:00.000Z',
};

const user: AuthenticatedUser = {
  id: '01user',
  name: 'Admin',
  email: 'admin@example.test',
  school: { id: '01school', code: 'SMK-01', name: 'SMK SmartLab' },
  membership: { id: '01membership', status: 'active', roles: ['Admin Lab'] },
  permissions: [],
  role: 'Admin Lab',
};

function state(data: IncidentListItem[] = [incident]): IncidentListState {
  return { status: 'ready', page: { data, meta: { page: 1, perPage: 25, total: data.length, lastPage: 1 } } };
}

function renderList(listState: IncidentListState, canCreate = false): string {
  return renderToStaticMarkup(
    <IncidentListView
      state={listState}
      filters={{ status: '', priority: '', category: '', search: '' }}
      canCreate={canCreate}
      onFiltersChange={vi.fn()}
      onApplyFilters={vi.fn()}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
      onDetail={vi.fn()}
      onPageChange={vi.fn()}
    />,
  );
}

describe('Incident API list presentation', () => {
  it('uses exact server permission for create with no role fallback', () => {
    expect(hasServerPermission({ ...user, role: 'Super Admin', membership: { ...user.membership, roles: ['Super Admin'] } }, 'incidents.create')).toBe(false);
    expect(hasServerPermission({ ...user, permissions: ['incidents.create.all'] }, 'incidents.create')).toBe(false);
    expect(hasServerPermission({ ...user, permissions: ['incidents.create'] }, 'incidents.create')).toBe(true);
  });

  it('renders loading, retryable error, and empty states without local fallbacks', () => {
    expect(renderList({ status: 'loading' })).toContain('Memuat tiket dari server...');
    expect(renderList({
      status: 'error',
      issue: {
        message: 'Layanan Incident tidak tersedia.', retryable: true, authBoundary: false, notFound: false,
        versionConflict: false, preconditionFailure: false, assigneeIneligible: false, fieldErrors: {},
      },
    })).toContain('Coba lagi');
    expect(renderList(state([]))).toContain('Belum ada tiket');
  });

  it('renders canonical snapshots and never exposes rejected prototype concepts', () => {
    const markup = renderList(state(), true);
    expect(markup).toContain('INC-2026-000001');
    expect(markup).toContain('Komputer gagal melakukan boot');
    expect(markup).toContain('LAB-RPL-1');
    expect(markup).toContain('PC-0001');
    expect(markup).toContain('Kritis');
    expect(markup).toContain('Dilaporkan');
    expect(markup).toContain('Buat Tiket');
    expect(markup).not.toContain('Menunggu Spare Part');
    expect(markup).not.toContain('Hapus');
    expect(markup).not.toContain('Buat Work Order');
    expect(markup).not.toContain('Andi Wijaya');
    expect(markup).not.toContain('assignedTechnician');
  });

  it('uses the locked Indonesian presentation mapping without changing backend keys', () => {
    expect(INCIDENT_STATUS_LABELS.reported).toBe('Dilaporkan');
    expect(INCIDENT_STATUS_LABELS.triaged).toBe('Diverifikasi');
    expect(INCIDENT_STATUS_LABELS.in_progress).toBe('Diproses');
    expect(INCIDENT_STATUS_LABELS.closed).toBe('Ditutup');
    expect(Object.keys(INCIDENT_STATUS_LABELS)).not.toContain('Menunggu Spare Part');
  });
});

describe('Incident create presentation', () => {
  const laboratories: IncidentReportingLaboratoryDto[] = [
    { id: '01lab000000000000000000001', code: 'LAB-RPL-1', name: 'Lab RPL 1' },
  ];

  it('renders only server-authoritative report fields and narrow Device discovery', () => {
    const markup = renderToStaticMarkup(
      <IncidentCreateFormFields
        values={{ ...emptyIncidentCreateForm(), laboratoryId: laboratories[0].id }}
        errors={{}}
        laboratories={laboratories}
        devices={[{ id: '01device', deviceCode: 'PC-0001', deviceType: 'desktop_pc' }]}
        deviceSearch="PC"
        deviceSearchBusy={false}
        deviceHasMore
        onChange={vi.fn()}
        onDeviceSearchChange={vi.fn()}
        onSearchDevices={vi.fn()}
      />,
    );
    expect(markup).toContain('Laboratorium');
    expect(markup).toContain('Cari Perangkat (opsional)');
    expect(markup).toContain('Perangkat Terkait');
    expect(markup).toContain('Judul');
    expect(markup).toContain('Deskripsi');
    expect(markup).toContain('Menghambat operasional laboratorium');
    expect(markup).toContain('Persempit pencarian kode perangkat');
    expect(markup).not.toContain('Nama Pelapor');
    expect(markup).not.toContain('Teknisi');
    expect(markup).not.toContain('Status');
    expect(markup).not.toContain('Work Order');
  });

  it('normalizes create payload and rejects invalid client-side bounds before network submission', () => {
    const base = {
      ...emptyIncidentCreateForm(),
      laboratoryId: laboratories[0].id,
      title: '  Komputer gagal boot  ',
      description: '  Komputer berhenti sebelum sistem operasi dimuat.  ',
      impact: '   ',
      stepsTaken: '  Kabel sudah diperiksa.  ',
    };
    const valid = validateIncidentCreateForm(base, '00000000-0000-4000-8000-000000000001');
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.title).toBe('Komputer gagal boot');
      expect(valid.value.description).toBe('Komputer berhenti sebelum sistem operasi dimuat.');
      expect(valid.value.impact).toBeNull();
      expect(valid.value.stepsTaken).toBe('Kabel sudah diperiksa.');
      expect(valid.value.deviceId).toBeNull();
    }

    const invalid = validateIncidentCreateForm(
      { ...base, laboratoryId: '', title: 'tiny', description: 'pendek', occurredAt: 'invalid' },
      'not-a-uuid',
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.laboratoryId).toBeTruthy();
      expect(invalid.errors.title).toBeTruthy();
      expect(invalid.errors.description).toBeTruthy();
      expect(invalid.errors.occurredAt).toBeTruthy();
      expect(invalid.errors.request).toBeTruthy();
    }
  });

  it('enters E4 recovery only for ambiguous POST outcomes', () => {
    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('network', { kind: 'network' }))).toBe(true);
    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('invalid response', { kind: 'invalid_response', status: 200 }))).toBe(true);
    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('server failure', { kind: 'api', status: 503 }))).toBe(true);
    expect(incidentCreateOutcomeIsAmbiguous(new IncidentContractError())).toBe(true);

    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('validation', { kind: 'api', status: 422, code: 'VALIDATION_FAILED' }))).toBe(false);
    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('forbidden', { kind: 'api', status: 403, code: 'FORBIDDEN' }))).toBe(false);
    expect(incidentCreateOutcomeIsAmbiguous(new ApiClientError('configuration', { kind: 'configuration' }))).toBe(false);
  });
});