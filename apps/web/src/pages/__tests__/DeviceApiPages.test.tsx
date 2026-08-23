import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DeviceDetailView,
  DeviceFormFields,
  DeviceListView,
  type DeviceListState,
} from '@/pages/DeviceApiPages';
import { deviceFormFromDto, loadLatestDeviceAfterConflict } from '@/lib/devicePresentation';
import type { DeviceDto } from '@/services/deviceApi';
import type { LaboratoryDto } from '@/services/laboratoryApi';

const device: DeviceDto = {
  id: '01DEVICE',
  schoolId: '01SCHOOL',
  deviceCode: 'DEV-0001',
  qrPublicId: 'devq_abcdefghijklmnopqrstuv',
  deviceType: 'router',
  lifecycleStatus: 'in_service',
  homeLaboratoryId: '01LAB',
  serialNumber: 'SN-01',
  hostname: 'RTR-01',
  brand: 'Example',
  model: 'R1',
  technicalProfileVersion: 1,
  technicalProfile: { wanPortCount: 1, lanPortCount: 4, wifiCapable: true },
  version: 4,
  createdAt: '2026-08-23T01:00:00.000Z',
  updatedAt: '2026-08-23T02:00:00.000Z',
};

const laboratory: LaboratoryDto = {
  id: '01LAB',
  schoolId: '01SCHOOL',
  code: 'LAB-RPL-1',
  name: 'Laboratorium RPL 1',
  location: 'Gedung A',
  capacity: 36,
  status: 'active',
  createdAt: '2026-08-23T01:00:00.000Z',
  updatedAt: '2026-08-23T01:00:00.000Z',
};

function renderList(state: DeviceListState, permissions: { create?: boolean; update?: boolean } = {}): string {
  return renderToStaticMarkup(
    <DeviceListView
      state={state}
      laboratories={[laboratory]}
      filters={{ search: '', deviceType: '', lifecycleStatus: '', homeLaboratoryId: '' }}
      canCreate={Boolean(permissions.create)}
      canUpdate={Boolean(permissions.update)}
      onFiltersChange={vi.fn()}
      onSearch={vi.fn()}
      onRetry={vi.fn()}
      onCreate={vi.fn()}
      onDetail={vi.fn()}
      onEdit={vi.fn()}
      onPageChange={vi.fn()}
    />,
  );
}

describe('Device API list presentation', () => {
  it('renders controlled loading, empty, and retryable error states', () => {
    expect(renderList({ status: 'loading' })).toContain('Memuat perangkat dari server...');
    expect(renderList({ status: 'ready', page: { data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } } })).toContain('Belum ada perangkat');
    expect(renderList({
      status: 'error',
      issue: { message: 'API tidak tersedia.', retryable: true, authBoundary: false, notFound: false, versionConflict: false, preconditionFailure: false, fieldErrors: {} },
    })).toContain('Coba lagi');
  });

  it('shows create and edit only when exact server permission results are passed in', () => {
    const page = { status: 'ready' as const, page: { data: [device], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } } };
    const viewOnly = renderList(page);
    expect(viewOnly).not.toContain('Tambah Perangkat');
    expect(viewOnly).not.toContain('Edit perangkat');

    const mutable = renderList(page, { create: true, update: true });
    expect(mutable).toContain('Tambah Perangkat');
    expect(mutable).toContain('Edit perangkat');
  });

  it('renders only useful canonical inventory values and pagination metadata', () => {
    const markup = renderList({ status: 'ready', page: { data: [device], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } } });
    expect(markup).toContain('DEV-0001');
    expect(markup).toContain('Router');
    expect(markup).toContain('RTR-01');
    expect(markup).toContain('LAB-RPL-1');
    expect(markup).toContain('1 perangkat');
    for (const forbidden of ['CPU Usage', 'RAM Usage', 'temperature', 'IP Address', 'MAC Address', 'Online', 'Offline']) {
      expect(markup).not.toContain(forbidden);
    }
  });
});

describe('Device API detail and edit boundaries', () => {
  it('reloads the latest canonical Device after a 412 without issuing another mutation', async () => {
    const latest = { ...device, version: 5, hostname: 'RTR-SERVER-LATEST' };
    const show = vi.fn(async () => latest);

    await expect(loadLatestDeviceAfterConflict({ show }, device.id)).resolves.toEqual(latest);
    expect(show).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledWith(device.id);
  });

  it('renders a controlled Device 404 state', () => {
    const markup = renderToStaticMarkup(
      <DeviceDetailView state={{ status: 'not_found' }} canUpdate={false} onRetry={vi.fn()} onBack={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(markup).toContain('Perangkat tidak ditemukan');
    expect(markup).toContain('konteks sekolah aktif');
  });

  it('renders canonical identity, custody, profile, and revision without QR auth or legacy joins', () => {
    const markup = renderToStaticMarkup(
      <DeviceDetailView
        state={{ status: 'ready', device }}
        laboratoryLabel="LAB-RPL-1 · Laboratorium RPL 1"
        canUpdate
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(markup).toContain(device.qrPublicId);
    expect(markup).toContain('Laboratorium asal adalah kustodi normal, bukan lokasi fisik saat ini.');
    expect(markup).toContain('Port WAN');
    expect(markup).toContain('Versi Device');
    expect(markup).toContain('Domain terkait tetap terpisah');
    expect(markup).not.toContain('QR scanner');
    expect(markup).not.toContain('Kode Aset');
  });

  it('keeps established home custody read-only and terminal lifecycle non-reactivatable', () => {
    const retired = { ...device, lifecycleStatus: 'retired' as const };
    const markup = renderToStaticMarkup(
      <DeviceFormFields
        values={deviceFormFromDto(retired)}
        errors={{}}
        laboratories={[laboratory]}
        editing={retired}
        onChange={vi.fn()}
      />,
    );
    expect(markup).toContain('Perubahan laboratorium asal memerlukan alur Transfer.');
    expect(markup).toContain('Dipensiunkan');
    expect(markup).toContain('Lifecycle terminal tidak dapat diaktifkan kembali');
    expect(markup).not.toContain('value="spare"');
  });
});
