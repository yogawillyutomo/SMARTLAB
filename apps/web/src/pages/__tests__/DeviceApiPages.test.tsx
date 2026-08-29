import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  DeviceDetailView,
  DeviceFormFields,
  DeviceListView,
  shouldCloseTransferDialog,
  type DeviceListState,
} from '@/pages/DeviceApiPages';
import { ApiClientError } from '@/lib/apiClient';
import { loadDeviceCollectionForSearchParams, runDeviceListMutation } from '@/lib/deviceCollection';
import { deviceFormFromDto, devicePresentationIssue, loadLatestDeviceAfterConflict } from '@/lib/devicePresentation';
import { executeTransferMutation } from '@/lib/deviceTransferPresentation';
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

  it('refreshes the lifecycle-filtered server page after an edit instead of retaining the returned Device locally', async () => {
    const spareDevice = { ...device, lifecycleStatus: 'spare' as const, version: 5 };
    const update = vi.fn(async (...args: [string, number, object]) => {
      expect(args).toEqual([device.id, device.version, { lifecycleStatus: 'spare' }]);
      return spareDevice;
    });
    const list = vi.fn(async () => ({ data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } }));

    const outcome = await runDeviceListMutation(
      () => update(device.id, device.version, { lifecycleStatus: 'spare' }),
      () => loadDeviceCollectionForSearchParams({ list }, new URLSearchParams('lifecycleStatus=in_service')),
    );

    expect(update).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ page: 1, perPage: 25, lifecycleStatus: 'in_service' });
    expect(outcome.result).toEqual(spareDevice);
    expect(outcome.refresh).toEqual({
      status: 'ready',
      page: { data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } },
    });
  });

  it('refreshes the exact search query after searchable metadata changes without local substring matching', async () => {
    const renamedDevice = { ...device, hostname: 'EDGE-01', version: 5 };
    const update = vi.fn(async (...args: [string, number, object]) => {
      expect(args).toEqual([device.id, device.version, { hostname: 'EDGE-01' }]);
      return renamedDevice;
    });
    const list = vi.fn(async () => ({ data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } }));

    const outcome = await runDeviceListMutation(
      () => update(device.id, device.version, { hostname: 'EDGE-01' }),
      () => loadDeviceCollectionForSearchParams({ list }, new URLSearchParams('search=router')),
    );

    expect(list).toHaveBeenCalledWith({ page: 1, perPage: 25, search: 'router' });
    expect(outcome.refresh.status).toBe('ready');
    if (outcome.refresh.status === 'ready') expect(outcome.refresh.page.data).toEqual([]);
  });

  it('refreshes the collection after 412 recovery without issuing a second PATCH or injecting the latest Device', async () => {
    const latest = { ...device, lifecycleStatus: 'spare' as const, version: 5 };
    const update = vi.fn(async () => {
      throw new ApiClientError('stale', { kind: 'api', status: 412, code: 'DEVICE_VERSION_CONFLICT' });
    });
    const show = vi.fn(async () => latest);
    const list = vi.fn(async () => ({ data: [], meta: { page: 1, perPage: 25, total: 0, lastPage: 1 } }));

    let conflictMessage = '';
    try {
      await update();
    } catch (error) {
      const issue = devicePresentationIssue(error);
      expect(issue.versionConflict).toBe(true);
      conflictMessage = issue.message;
    }
    const recovery = await runDeviceListMutation(
      () => loadLatestDeviceAfterConflict({ show }, device.id),
      () => loadDeviceCollectionForSearchParams({ list }, new URLSearchParams('lifecycleStatus=in_service')),
    );

    expect(update).toHaveBeenCalledOnce();
    expect(conflictMessage).toContain('Data terbaru sudah dimuat');
    expect(show).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ page: 1, perPage: 25, lifecycleStatus: 'in_service' });
    expect(recovery.result).toEqual(latest);
    expect(recovery.refresh.status).toBe('ready');
    if (recovery.refresh.status === 'ready') expect(recovery.refresh.page.data).toEqual([]);
  });

  it('canonicalizes an out-of-range page to lastPage and fetches it once without a redirect loop', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ data: [], meta: { page: 3, perPage: 25, total: 50, lastPage: 2 } })
      .mockResolvedValueOnce({ data: [device], meta: { page: 2, perPage: 25, total: 50, lastPage: 2 } });

    const first = await loadDeviceCollectionForSearchParams(
      { list },
      new URLSearchParams('page=3&lifecycleStatus=in_service'),
    );
    expect(first.status).toBe('redirect');
    if (first.status !== 'redirect') throw new Error('Expected page reconciliation redirect.');
    expect(first.searchParams.toString()).toBe('page=2&lifecycleStatus=in_service');

    const second = await loadDeviceCollectionForSearchParams({ list }, first.searchParams);
    expect(second.status).toBe('ready');
    expect(list).toHaveBeenNthCalledWith(1, { page: 3, perPage: 25, lifecycleStatus: 'in_service' });
    expect(list).toHaveBeenNthCalledWith(2, { page: 2, perPage: 25, lifecycleStatus: 'in_service' });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('refreshes the canonical collection after a normal metadata edit that remains in the query', async () => {
    const updated = { ...device, brand: 'Updated Brand', version: 5 };
    const update = vi.fn(async (...args: [string, number, object]) => {
      expect(args).toEqual([device.id, device.version, { brand: 'Updated Brand' }]);
      return updated;
    });
    const list = vi.fn(async () => ({ data: [updated], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } }));

    const outcome = await runDeviceListMutation(
      () => update(device.id, device.version, { brand: 'Updated Brand' }),
      () => loadDeviceCollectionForSearchParams({ list }, new URLSearchParams('deviceType=router')),
    );

    expect(list).toHaveBeenCalledWith({ page: 1, perPage: 25, deviceType: 'router' });
    expect(outcome.refresh.status).toBe('ready');
    if (outcome.refresh.status === 'ready') expect(outcome.refresh.page.data).toEqual([updated]);
  });
});

describe('Device API detail and edit boundaries', () => {
  const destinationLaboratoryId = '01DESTINATION';
  const transferInput = { destinationLaboratoryId, reason: 'UAT recovery' };
  const transferSnapshot = {
    deviceId: device.id,
    submittedVersion: device.version,
    sourceLaboratoryId: device.homeLaboratoryId!,
    destinationLaboratoryId,
    reason: transferInput.reason,
  };

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

  it('shows the Transfer action only from exact permission inputs and renders snapshot history states', () => {
    const onOpenTransfer = vi.fn();
    const history = {
      status: 'ready' as const,
      page: {
        data: [{
          id: '01m0r8nsw938c2zcv44zyge824',
          deviceId: device.id,
          deviceCode: device.deviceCode,
          sourceLaboratory: { id: '01m0r8nsw938c2zcv44zyge821', code: 'LAB-A', name: 'Source Lab' },
          destinationLaboratory: { id: '01m0r8nsw938c2zcv44zyge822', code: 'LAB-B', name: 'Destination Lab' },
          reason: 'Move',
          actor: { id: '01m0r8nsw938c2zcv44zyge823', name: 'Operator' },
          deviceVersionBefore: 3,
          deviceVersionAfter: 4,
          createdAt: '2026-08-24T01:00:00.000Z',
        }],
        meta: { page: 1, perPage: 10, total: 1, lastPage: 1 },
      },
    };
    const withPermission = renderToStaticMarkup(
      <DeviceDetailView
        state={{ status: 'ready', device }}
        laboratoryLabel="LAB-RPL-1 · Laboratorium RPL 1"
        canUpdate={false}
        canCreateTransfer
        canViewLaboratories
        canViewTransferHistory
        transferHistory={history}
        onOpenTransfer={onOpenTransfer}
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(withPermission).toContain('Pindahkan Laboratorium');
    expect(withPermission).toContain('LAB-A · Source Lab');
    expect(withPermission).toContain('LAB-B · Destination Lab');

    const withoutPermission = renderToStaticMarkup(
      <DeviceDetailView state={{ status: 'ready', device }} canUpdate={false} canCreateTransfer={false} canViewTransferHistory={false} onRetry={vi.fn()} onBack={vi.fn()} onEdit={vi.fn()} />,
    );
    expect(withoutPermission).not.toContain('Pindahkan Laboratorium');
    expect(withoutPermission).not.toContain('Transfer belum dihubungkan');
  });

  it('closes the Transfer command after known success when reconciliation is unavailable and exposes GET-only recovery', async () => {
    const create = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => ({ status: 'unavailable' as const }));
    const outcome = await executeTransferMutation({
      deviceId: device.id,
      expectedVersion: device.version,
      input: transferInput,
      snapshot: transferSnapshot,
      create,
      reconcile,
      isCurrent: () => true,
    });

    expect(outcome).toMatchObject({ status: 'unavailable', knownSuccess: true });
    expect(shouldCloseTransferDialog(outcome)).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();

    const recoveryMessage = 'Pemindahan berhasil, tetapi data terbaru belum dapat dimuat.';
    const markup = renderToStaticMarkup(
      <DeviceDetailView
        state={{ status: 'ready', device }}
        canUpdate={false}
        transferRecoveryMessage={recoveryMessage}
        onRetryReconciliation={vi.fn()}
        onRetry={vi.fn()}
        onBack={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    expect(markup).toContain(recoveryMessage);
    expect(markup).toContain('Muat ulang data');
  });

  it('keeps an ambiguous unconfirmed Transfer dialog open without mutation replay', async () => {
    const create = vi.fn(async () => {
      throw new ApiClientError('offline', { kind: 'network' });
    });
    const reconcile = vi.fn(async () => ({ status: 'unconfirmed' as const, device }));
    const outcome = await executeTransferMutation({
      deviceId: device.id,
      expectedVersion: device.version,
      input: transferInput,
      snapshot: transferSnapshot,
      create,
      reconcile,
      isCurrent: () => true,
    });

    expect(outcome.status).toBe('unconfirmed');
    expect(shouldCloseTransferDialog(outcome)).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('keeps ordinary confirmed Transfer success closing behavior unchanged', async () => {
    const create = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => ({
      status: 'confirmed' as const,
      device: { ...device, homeLaboratoryId: destinationLaboratoryId, version: device.version + 1 },
      knownSuccess: true,
    }));
    const outcome = await executeTransferMutation({
      deviceId: device.id,
      expectedVersion: device.version,
      input: transferInput,
      snapshot: transferSnapshot,
      create,
      reconcile,
      isCurrent: () => true,
    });

    expect(outcome.status).toBe('confirmed');
    expect(shouldCloseTransferDialog(outcome)).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });
});
