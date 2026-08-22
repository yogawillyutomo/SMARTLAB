import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { hasServerPermission } from '@/lib/authIdentity';
import {
  LaboratoryDetailView,
  LaboratoryFormFields,
  LaboratoryLayoutUnavailableView,
  LaboratoryListView,
  type LaboratoryListState,
} from '@/pages/LaboratoryApiPages';
import type { LaboratoryDto } from '@/services/laboratoryApi';
import type { AuthenticatedUser } from '@/types';

const laboratory: LaboratoryDto = {
  id: '01LABORATORY00000000000001',
  schoolId: '01SCHOOL000000000000000001',
  code: 'LAB-RPL-1',
  name: 'Laboratorium RPL 1',
  location: 'Gedung A Lantai 2',
  capacity: 36,
  status: 'active',
  createdAt: '2026-08-22T10:00:00.000Z',
  updatedAt: '2026-08-22T10:00:00.000Z',
};

const user: AuthenticatedUser = {
  id: '01USER',
  name: 'Admin',
  email: 'admin@example.test',
  school: { id: laboratory.schoolId, code: 'SMK-01', name: 'SMK SmartLab' },
  membership: { id: '01MEMBER', status: 'active', roles: ['Admin Lab'] },
  permissions: [],
  role: 'Admin Lab',
};

function renderList(state: LaboratoryListState, permissions: string[] = []): string {
  const currentUser = { ...user, permissions };
  return renderToStaticMarkup(
    <LaboratoryListView
      state={state}
      canCreate={hasServerPermission(currentUser, 'laboratories.create')}
      canUpdate={hasServerPermission(currentUser, 'laboratories.update')}
      statusUpdatingId={null}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
      onEdit={vi.fn()}
      onToggleStatus={vi.fn()}
      onDetail={vi.fn()}
    />,
  );
}

describe('Laboratory API list presentation', () => {
  it('requires the exact server view permission without a role fallback', () => {
    expect(hasServerPermission({ ...user, role: 'Super Admin', membership: { ...user.membership, roles: ['Super Admin'] } }, 'laboratories.view')).toBe(false);
    expect(hasServerPermission({ ...user, permissions: ['laboratories.view.all'] }, 'laboratories.view')).toBe(false);
    expect(hasServerPermission({ ...user, permissions: ['laboratories.view'] }, 'laboratories.view')).toBe(true);
  });

  it('renders controlled loading, empty, and retryable error states', () => {
    expect(renderList({ status: 'loading' })).toContain('Memuat laboratorium dari server...');
    expect(renderList({ status: 'ready', laboratories: [] })).toContain('Belum ada laboratorium');
    expect(renderList({
      status: 'error',
      issue: { message: 'Layanan tidak tersedia.', retryable: true, authBoundary: false, notFound: false, fieldErrors: {} },
    })).toContain('Coba lagi');
  });

  it('uses exact server permissions for create and update actions', () => {
    const viewOnly = renderList({ status: 'ready', laboratories: [laboratory] }, ['laboratories.view']);
    expect(viewOnly).not.toContain('Tambah Lab');
    expect(viewOnly).not.toContain('Edit Laboratorium');
    expect(viewOnly).not.toContain('Nonaktifkan Laboratorium');

    const mutable = renderList(
      { status: 'ready', laboratories: [laboratory] },
      ['laboratories.view', 'laboratories.create', 'laboratories.update'],
    );
    expect(mutable).toContain('Tambah Lab');
    expect(mutable).toContain('Edit Laboratorium');
    expect(mutable).toContain('Nonaktifkan Laboratorium');
  });

  it('shows only canonical fields and exposes no delete, layout, or monitoring action', () => {
    const markup = renderList({ status: 'ready', laboratories: [laboratory] }, ['laboratories.view', 'laboratories.update']);
    expect(markup).toContain(laboratory.code);
    expect(markup).toContain(laboratory.name);
    expect(markup).toContain(laboratory.location);
    expect(markup).toContain('36 orang');
    expect(markup).not.toContain('Hapus');
    expect(markup).not.toContain('>Denah<');
    expect(markup).not.toContain('>Monitor<');
    expect(markup).not.toContain('Kepala Lab');
    expect(markup).not.toContain('Teknisi');
  });
});

describe('Laboratory API detail and form presentation', () => {
  it('renders an explicit 404 state without consulting local data', () => {
    const markup = renderToStaticMarkup(
      <LaboratoryDetailView state={{ status: 'not_found' }} onRetry={vi.fn()} onBack={vi.fn()} />,
    );
    expect(markup).toContain('Laboratorium tidak ditemukan');
    expect(markup).toContain('konteks sekolah aktif');
  });

  it('renders canonical read-only metadata and marks local domains as not integrated', () => {
    const markup = renderToStaticMarkup(
      <LaboratoryDetailView state={{ status: 'ready', laboratory }} onRetry={vi.fn()} onBack={vi.fn()} />,
    );
    expect(markup).toContain(laboratory.schoolId);
    expect(markup).toContain('Dibuat');
    expect(markup).toContain('Diperbarui');
    expect(markup).toContain('Domain operasional belum terintegrasi');
  });

  it('fails the former layout route in a controlled state instead of binding local data', () => {
    const markup = renderToStaticMarkup(<LaboratoryLayoutUnavailableView onBack={vi.fn()} />);
    expect(markup).toContain('Denah belum terintegrasi');
    expect(markup).toContain('tidak menghubungkan ID Laboratory API');
  });

  it('places 422 validation messages on the matching form fields', () => {
    const markup = renderToStaticMarkup(
      <LaboratoryFormFields
        values={{ code: 'LAB-1', name: 'Lab', location: 'Gedung A', capacity: '36', status: 'active' }}
        errors={{ code: 'Kode sudah digunakan.', capacity: 'Kapasitas tidak valid.' }}
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain('Kode sudah digunakan.');
    expect(markup).toContain('Kapasitas tidak valid.');
    expect(markup).not.toContain('schoolId');
    expect(markup).not.toContain('Kepala Lab');
  });
});
