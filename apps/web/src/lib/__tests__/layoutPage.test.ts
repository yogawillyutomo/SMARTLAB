import { describe, expect, it, vi } from 'vitest';
import { addStructuralElement, layoutEditorStateFromServer, removeDevicePlacement } from '@/domain/server-layout';
import {
  activateCanonicalLayoutDraft,
  canCreateLayoutDraft,
  canEditLayoutDraft,
  canDeleteLayoutDraft,
  deleteCanonicalLayoutDraft,
  initialLayoutSection,
  layoutEditorIsDirty,
  LayoutMutationGate,
  LayoutRouteScope,
  LayoutDeviceMetadataCache,
  assertLayoutOwnership,
  loadLayoutWorkspaceData,
  layoutMetadataFromDevice,
  placementRoleOptions,
  saveCanonicalLayoutDraft,
  validateLayoutCreateForm,
  visibleUnplacedCandidates,
  shouldLoadPlacementMetadata,
  workspaceAfterActivation,
  workspaceAfterDraftDeletion,
  mutationReconciliationIssue,
} from '@/lib/layoutPage';
import type { LayoutCapabilities } from '@/lib/layoutPresentation';
import { LayoutContractError, type LayoutDto, type LayoutGateway, type LayoutPage, type ReplaceLayoutInput, type UnplacedDeviceCandidateDto } from '@/services/layoutApi';
import { ApiClientError } from '@/lib/apiClient';
import type { LaboratoryDto } from '@/services/laboratoryApi';
import type { DeviceDto, DeviceType } from '@/services/deviceApi';

const NOW = '2026-08-24T10:00:00.000Z';
const id = (last: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${last}`;

function layout(status: LayoutDto['status'], last: string, overrides: Partial<LayoutDto> = {}): LayoutDto {
  return {
    id: id(last), schoolId: id('W'), laboratoryId: id('X'), name: `${status} Layout`, templateKey: null,
    rows: 8, columns: 8, status, version: 3, structuralElements: [], devicePlacements: [],
    activatedAt: status === 'draft' ? null : NOW, archivedAt: status === 'archived' ? NOW : null,
    createdAt: NOW, updatedAt: NOW, ...overrides,
  };
}

const laboratory: LaboratoryDto = {
  id: id('X'), schoolId: id('W'), code: 'LAB-01', name: 'Lab Komputer', location: 'Gedung A',
  capacity: 36, status: 'active', createdAt: NOW, updatedAt: NOW,
};

function page(data: LayoutDto[], pageNumber = 1): LayoutPage {
  return { data, meta: { page: pageNumber, perPage: 10, total: data.length, lastPage: 1 } };
}

const capabilities: LayoutCapabilities = { view: true, create: true, update: true, delete: true, viewUnplacedDevices: true };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function device(deviceType: DeviceType, last: string): DeviceDto {
  return {
    id: id(last), schoolId: laboratory.schoolId, deviceCode: `DEV-${last}`, qrPublicId: `qr-${last}`,
    deviceType, lifecycleStatus: 'in_service', homeLaboratoryId: laboratory.id, serialNumber: null,
    hostname: null, brand: null, model: null, technicalProfileVersion: 1, technicalProfile: {},
    version: 1, createdAt: NOW, updatedAt: NOW,
  } as DeviceDto;
}

describe('Layout page canonical orchestration', () => {
  it('prevents duplicate mutations until the pending request settles', () => {
    const gate = new LayoutMutationGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.end();
    expect(gate.begin()).toBe(true);
  });
  it('loads Laboratory first, separates status/pagination queries, and fetches full current DTOs only', async () => {
    const draft = layout('draft', 'D');
    const active = layout('active', 'A');
    const archived = layout('archived', 'H');
    const sequence: string[] = [];
    const list = vi.fn(async (_laboratoryId: string, filters?: Parameters<LayoutGateway['list']>[1]) => {
      sequence.push(`list:${filters?.status}:${filters?.page}`);
      return filters?.status === 'draft' ? page([draft]) : filters?.status === 'active' ? page([active]) : page([archived], 2);
    });
    const show = vi.fn(async (layoutId: string) => layoutId === draft.id ? draft : active);
    const laboratoryShow = vi.fn(async () => { sequence.push('laboratory'); return laboratory; });

    const result = await loadLayoutWorkspaceData(laboratory.id, {
      laboratory: { show: laboratoryShow },
      layout: { list, show } as unknown as LayoutGateway,
    }, 2);

    expect(sequence[0]).toBe('laboratory');
    expect(list.mock.calls.map((call) => call[1])).toEqual([
      { status: 'draft', page: 1, perPage: 25 },
      { status: 'active', page: 1, perPage: 25 },
      { status: 'archived', page: 2, perPage: 10 },
    ]);
    expect(show).toHaveBeenCalledTimes(2);
    expect(show).not.toHaveBeenCalledWith(archived.id);
    expect(result).toEqual({ laboratory, draft, active, archives: page([archived], 2) });
  });

  it('fails closed when the server violates the single active/draft invariant', async () => {
    const gateway = {
      list: vi.fn(async (_id: string, filters?: Parameters<LayoutGateway['list']>[1]) => filters?.status === 'draft'
        ? page([layout('draft', 'D'), layout('draft', 'E')]) : page([])),
    } as unknown as LayoutGateway;
    await expect(loadLayoutWorkspaceData(laboratory.id, { laboratory: { show: vi.fn(async () => laboratory) }, layout: gateway }))
      .rejects.toBeInstanceOf(LayoutContractError);
  });

  it('prefers editable draft, otherwise active, then readable draft/history', () => {
    const draft = layout('draft', 'D');
    const active = layout('active', 'A');
    const archives = page([layout('archived', 'H')]);
    expect(initialLayoutSection({ draft, active, archives }, true)).toBe('draft');
    expect(initialLayoutSection({ draft, active, archives }, false)).toBe('active');
    expect(initialLayoutSection({ draft, active: null, archives }, false)).toBe('draft');
    expect(initialLayoutSection({ draft: null, active: null, archives }, false)).toBe('history');
  });

  it('builds strict empty vs server-clone create payloads without legacy fields', () => {
    expect(validateLayoutCreateForm({ name: 'Draft Baru', rows: '10', columns: '12', templateKey: 'computer-lab' }, null))
      .toEqual({ ok: true, input: { mode: 'empty', name: 'Draft Baru', rows: 10, columns: 12, templateKey: 'computer-lab' } });
    expect(validateLayoutCreateForm({ name: '', rows: '999', columns: '', templateKey: '' }, layout('active', 'A')))
      .toEqual({ ok: true, input: { mode: 'clone' } });
    expect(validateLayoutCreateForm({ name: 'Clone', rows: '', columns: '', templateKey: '' }, layout('active', 'A')))
      .toEqual({ ok: true, input: { mode: 'clone', name: 'Clone' } });
    expect(validateLayoutCreateForm({ name: '', rows: '0', columns: '51', templateKey: '' }, null)).toMatchObject({ ok: false });
  });

  it('enforces active Laboratory and exact independent capabilities for create/edit/delete boundaries', () => {
    const draft = layout('draft', 'D');
    expect(canCreateLayoutDraft(laboratory, capabilities, null)).toBe(true);
    expect(canCreateLayoutDraft({ ...laboratory, status: 'inactive' }, capabilities, null)).toBe(false);
    expect(canCreateLayoutDraft(laboratory, { ...capabilities, create: false }, null)).toBe(false);
    expect(canEditLayoutDraft(laboratory, capabilities, draft)).toBe(true);
    expect(canEditLayoutDraft({ ...laboratory, status: 'inactive' }, capabilities, draft)).toBe(false);
    expect(canEditLayoutDraft(laboratory, { ...capabilities, update: false }, draft)).toBe(false);
    expect(canEditLayoutDraft(laboratory, capabilities, layout('active', 'A'))).toBe(false);
    expect(canEditLayoutDraft(laboratory, capabilities, layout('archived', 'H'))).toBe(false);
    expect(canDeleteLayoutDraft(laboratory, capabilities, draft)).toBe(true);
    expect(canDeleteLayoutDraft(laboratory, capabilities, layout('active', 'A'))).toBe(false);
    expect(canDeleteLayoutDraft(laboratory, { ...capabilities, delete: false }, draft)).toBe(false);
  });

  it('detects serialized dirty state and filters server candidates already placed locally', () => {
    const baseline = layoutEditorStateFromServer(layout('draft', 'D'));
    const result = addStructuralElement(baseline, { clientKey: 'wall-1', type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 });
    if (!result.ok) throw new Error(result.message);
    expect(layoutEditorIsDirty(baseline, baseline)).toBe(false);
    expect(layoutEditorIsDirty(baseline, result.state)).toBe(true);

    const first: UnplacedDeviceCandidateDto = { id: id('1'), deviceCode: 'DEV-001', deviceType: 'desktop_pc', lifecycleStatus: 'in_service', hostname: null, brand: null, model: null };
    const second = { ...first, id: id('2'), deviceCode: 'DEV-002' };
    expect(visibleUnplacedCandidates([first, second], { ...baseline, devicePlacements: [{ clientKey: 'local', deviceId: first.id, role: null, label: null, row: 2, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0 }] }))
      .toEqual([second]);
  });

  it('offers station roles only for canonical desktop/laptop metadata', () => {
    expect(placementRoleOptions('desktop_pc', null).map(({ value }) => value)).toEqual(['', 'student_station', 'teacher_station']);
    expect(placementRoleOptions('laptop', null).map(({ value }) => value)).toEqual(['', 'student_station', 'teacher_station']);
    expect(placementRoleOptions('printer', null).map(({ value }) => value)).toEqual(['']);
    expect(placementRoleOptions('router', null).map(({ value }) => value)).toEqual(['']);
    expect(placementRoleOptions(undefined, 'teacher_station')).toEqual([
      { value: '', label: 'Tanpa role' },
      { value: 'teacher_station', label: 'PC Guru (metadata tidak tersedia)' },
    ]);
  });

  it('does not fabricate an unplaced candidate after removing an existing placement locally', () => {
    const existing = layoutEditorStateFromServer(layout('draft', 'D', {
      devicePlacements: [{ id: id('P'), deviceId: id('1'), role: null, label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 }],
    }));
    const removed = removeDevicePlacement(existing, id('P'));
    if (!removed.ok) throw new Error(removed.message);
    expect(visibleUnplacedCandidates([], removed.state)).toEqual([]);
  });

  it('uses the baseline version for full PUT/save and replaces client keys with canonical response', async () => {
    const baseline = layoutEditorStateFromServer(layout('draft', 'D'));
    const result = addStructuralElement(baseline, { clientKey: 'wall-1', type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 });
    if (!result.ok) throw new Error(result.message);
    const canonical = layout('draft', 'D', { version: 4, structuralElements: [{ id: id('X'), type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 }] });
    const replace = vi.fn(async () => canonical);
    const saved = await saveCanonicalLayoutDraft({ replace }, baseline, result.state);
    expect(replace).toHaveBeenCalledWith(baseline.id, 3, expect.objectContaining({ name: baseline.name, structuralElements: [expect.not.objectContaining({ clientKey: expect.anything() })] }));
    expect(saved.layout).toBe(canonical);
    expect(saved.editor.version).toBe(4);
    expect(saved.editor.structuralElements[0]).toHaveProperty('id', id('X'));
  });

  it('accepts a server-authoritative semantic no-op response with the same version', async () => {
    const canonical = layout('draft', 'D', { version: 3 });
    const baseline = layoutEditorStateFromServer(canonical);
    const saved = await saveCanonicalLayoutDraft({ replace: vi.fn(async () => canonical) }, baseline, baseline);
    expect(saved.layout.version).toBe(3);
    expect(layoutEditorIsDirty(saved.editor, saved.editor)).toBe(false);
  });

  it('blocks dirty activation and passes the baseline version to clean activate/delete mutations', async () => {
    const baseline = layoutEditorStateFromServer(layout('draft', 'D'));
    const dirtyResult = addStructuralElement(baseline, { clientKey: 'wall-1', type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 });
    if (!dirtyResult.ok) throw new Error(dirtyResult.message);
    const activate = vi.fn(async () => layout('active', 'D'));
    await expect(activateCanonicalLayoutDraft({ activate }, baseline, dirtyResult.state)).rejects.toBeInstanceOf(LayoutContractError);
    expect(activate).not.toHaveBeenCalled();
    await activateCanonicalLayoutDraft({ activate }, baseline, baseline);
    expect(activate).toHaveBeenCalledWith(baseline.id, baseline.version);
    const deleteDraft = vi.fn(async () => undefined);
    await deleteCanonicalLayoutDraft({ deleteDraft }, baseline);
    expect(deleteDraft).toHaveBeenCalledWith(baseline.id, baseline.version);
  });

  it('propagates a 412 once without resubmit or local version mutation', async () => {
    const baseline = layoutEditorStateFromServer(layout('draft', 'D'));
    const conflict = new ApiClientError('conflict', { kind: 'api', status: 412, code: 'LAYOUT_VERSION_CONFLICT' });
    const replace = vi.fn(async () => { throw conflict; });
    await expect(saveCanonicalLayoutDraft({ replace }, baseline, baseline)).rejects.toBe(conflict);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(baseline.version).toBe(3);
  });

  it('fails closed for mismatched Layout laboratory and school ownership', () => {
    const wrongLaboratory = layout('draft', 'D', { laboratoryId: id('B') });
    const wrongSchool = layout('draft', 'D', { schoolId: id('C') });
    expect(() => assertLayoutOwnership(wrongLaboratory, laboratory)).toThrow(LayoutContractError);
    expect(() => assertLayoutOwnership(wrongSchool, laboratory)).toThrow(LayoutContractError);
    expect(canEditLayoutDraft(laboratory, capabilities, wrongLaboratory)).toBe(false);
    expect(canEditLayoutDraft(laboratory, capabilities, wrongSchool)).toBe(false);
    expect(canDeleteLayoutDraft(laboratory, capabilities, wrongLaboratory)).toBe(false);
    expect(canDeleteLayoutDraft(laboratory, capabilities, wrongSchool)).toBe(false);
  });

  it('rejects mismatched current and archived summaries during workspace loading', async () => {
    const mismatched = layout('archived', 'H', { laboratoryId: id('B') });
    const gateway = {
      list: vi.fn(async (_id: string, filters?: Parameters<LayoutGateway['list']>[1]) => filters?.status === 'archived' ? page([mismatched]) : page([])),
    } as unknown as LayoutGateway;
    await expect(loadLayoutWorkspaceData(laboratory.id, { laboratory: { show: vi.fn(async () => laboratory) }, layout: gateway }))
      .rejects.toBeInstanceOf(LayoutContractError);
  });

  it('keeps Lab B workspace when deferred Lab A workspace resolves late', async () => {
    const scope = new LayoutRouteScope();
    const tokenA = scope.enter(laboratory.id).token;
    const request = deferred<string>();
    let visible = 'Lab A';
    const continuation = request.promise.then((value) => scope.commit(tokenA, () => { visible = value; }));
    scope.enter(id('B'));
    visible = 'Lab B';
    request.resolve('Late Lab A workspace');
    expect(await continuation).toBe(false);
    expect(visible).toBe('Lab B');
  });

  it('keeps Lab B archive list and detail when Lab A archive requests resolve late', async () => {
    const scope = new LayoutRouteScope();
    const tokenA = scope.enter(laboratory.id).token;
    const archiveList = deferred<string>();
    const archiveDetail = deferred<string>();
    let visibleList = 'B list';
    let visibleDetail = 'B detail';
    const listContinuation = archiveList.promise.then((value) => scope.commit(tokenA, () => { visibleList = value; }));
    const detailContinuation = archiveDetail.promise.then((value) => scope.commit(tokenA, () => { visibleDetail = value; }));
    scope.enter(id('B'));
    archiveList.resolve('A list');
    archiveDetail.resolve('A detail');
    expect(await listContinuation).toBe(false);
    expect(await detailContinuation).toBe(false);
    expect({ visibleList, visibleDetail }).toEqual({ visibleList: 'B list', visibleDetail: 'B detail' });
  });

  it('keeps Lab B unplaced and lazy metadata projections when Lab A reads resolve late', async () => {
    const scope = new LayoutRouteScope();
    const tokenA = scope.enter(laboratory.id).token;
    const unplaced = deferred<string>();
    const metadata = deferred<string>();
    let visibleUnplaced = 'B candidates';
    let visibleMetadata = 'B metadata';
    const unplacedContinuation = unplaced.promise.then((value) => scope.commit(tokenA, () => { visibleUnplaced = value; }));
    const metadataContinuation = metadata.promise.then((value) => scope.commit(tokenA, () => { visibleMetadata = value; }));
    scope.enter(id('B'));
    unplaced.resolve('A candidates');
    metadata.resolve('A metadata');
    expect(await unplacedContinuation).toBe(false);
    expect(await metadataContinuation).toBe(false);
    expect({ visibleUnplaced, visibleMetadata }).toEqual({ visibleUnplaced: 'B candidates', visibleMetadata: 'B metadata' });
  });

  it.each(['save', 'create', 'delete'] as const)(
    'discards stale %s UI completion after intentional navigation to Lab B',
    async (operation) => {
      const scope = new LayoutRouteScope();
      const tokenA = scope.enter(laboratory.id).token;
      const mutation = deferred<string>();
      let visible = `${operation} B`;
      const continuation = mutation.promise.then((value) => scope.commit(tokenA, () => { visible = value; }));
      scope.enter(id('B'));
      mutation.resolve(`${operation} A`);
      expect(await continuation).toBe(false);
      expect(visible).toBe(`${operation} B`);
    },
  );

  it('does not start the old Lab A activation reconciliation after route scope changes', async () => {
    const scope = new LayoutRouteScope();
    const tokenA = scope.enter(laboratory.id).token;
    const activation = deferred<LayoutDto>();
    const followUpGet = vi.fn();
    let visible = 'Lab B';
    const continuation = activation.promise.then((active) => scope.commit(tokenA, () => {
      visible = active.name;
      followUpGet();
    }));
    scope.enter(id('B'));
    activation.resolve(layout('active', 'A'));
    expect(await continuation).toBe(false);
    expect(visible).toBe('Lab B');
    expect(followUpGet).not.toHaveBeenCalled();
  });

  it('lazily caches canonical Device metadata and keeps only Layout presentation fields', async () => {
    const cache = new LayoutDeviceMetadataCache();
    const desktop = device('desktop_pc', '1');
    const show = vi.fn(async () => desktop);
    expect(show).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([cache.load(desktop.id, show), cache.load(desktop.id, show)]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(first).toEqual(layoutMetadataFromDevice(desktop));
    expect(second).toBe(first);
    expect(first).toEqual({
      id: desktop.id, deviceCode: desktop.deviceCode, deviceType: 'desktop_pc', lifecycleStatus: 'in_service',
      hostname: null, brand: null, model: null,
    });
    expect(first).not.toHaveProperty('technicalProfile');
    expect(first).not.toHaveProperty('qrPublicId');
    expect(first).not.toHaveProperty('version');
  });

  it('never includes lazily fetched Device metadata in the Layout PUT payload', async () => {
    const desktop = device('desktop_pc', '1');
    const canonical = layout('draft', 'D', {
      devicePlacements: [{ id: id('P'), deviceId: desktop.id, role: null, label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 }],
    });
    const baseline = layoutEditorStateFromServer(canonical);
    await new LayoutDeviceMetadataCache().load(desktop.id, vi.fn(async () => desktop));
    let payload: ReplaceLayoutInput | undefined;
    const replace = vi.fn(async (_layoutId: string, _version: number, input: ReplaceLayoutInput) => {
      payload = input;
      return canonical;
    });
    await saveCanonicalLayoutDraft({ replace }, baseline, baseline);
    expect(payload).toBeDefined();
    if (!payload) throw new Error('PUT payload was not captured.');
    expect(JSON.stringify(payload)).not.toContain(desktop.deviceCode);
    expect(JSON.stringify(payload)).not.toContain('technicalProfile');
    expect(payload.devicePlacements[0]).toEqual(expect.objectContaining({ deviceId: desktop.id }));
  });

  it('enables existing desktop/laptop station roles lazily while keeping printer null-only', async () => {
    for (const deviceType of ['desktop_pc', 'laptop', 'printer'] as const) {
      const canonical = device(deviceType, deviceType === 'desktop_pc' ? '1' : deviceType === 'laptop' ? '2' : '3');
      const metadata = await new LayoutDeviceMetadataCache().load(canonical.id, vi.fn(async () => canonical));
      const values = placementRoleOptions(metadata.deviceType, null).map(({ value }) => value);
      expect(values).toEqual(deviceType === 'printer' ? [''] : ['', 'student_station', 'teacher_station']);
    }
  });

  it('requires editable draft and devices.view before lazy Device metadata resolution', () => {
    expect(shouldLoadPlacementMetadata(true, capabilities, false)).toBe(true);
    expect(shouldLoadPlacementMetadata(false, capabilities, false)).toBe(false);
    expect(shouldLoadPlacementMetadata(true, { ...capabilities, viewUnplacedDevices: false }, false)).toBe(false);
    expect(shouldLoadPlacementMetadata(true, capabilities, true)).toBe(false);
  });

  it('applies committed activation/deletion DTO facts before reconciliation', () => {
    const draft = layout('draft', 'D');
    const active = layout('active', 'A');
    const workspace = { laboratory, draft, active: null, archives: page([]) };
    expect(workspaceAfterActivation(workspace, active)).toMatchObject({ active, draft: null });
    expect(workspaceAfterDraftDeletion(workspace)).toMatchObject({ active: null, draft: null });
    expect(() => workspaceAfterActivation(workspace, layout('draft', 'D'))).toThrow(LayoutContractError);
  });

  it('keeps a committed activation when reconciliation fails and retries GET without replaying activate', async () => {
    const draft = layout('draft', 'D');
    const active = layout('active', 'A');
    const baseline = layoutEditorStateFromServer(draft);
    const workspace = { laboratory, draft, active: null, archives: page([]) };
    const activate = vi.fn(async () => active);
    const reconcile = vi.fn()
      .mockRejectedValueOnce(new Error('temporary GET failure'))
      .mockResolvedValueOnce({ ...workspace, active, draft: null });

    const canonical = await activateCanonicalLayoutDraft({ activate }, baseline, baseline);
    const committed = workspaceAfterActivation(workspace, canonical);
    let issue;
    try {
      await reconcile();
    } catch {
      issue = mutationReconciliationIssue('activate', {
        message: 'Network error', retryable: true, authBoundary: false, notFound: false,
        versionConflict: false, preconditionFailure: false, contractFailure: false, fieldErrors: {},
      });
    }

    expect(committed).toMatchObject({ active, draft: null });
    expect(issue?.message).toContain('sudah berhasil diaktifkan');
    await reconcile();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('keeps a committed deletion when reconciliation fails and retries GET without replaying delete', async () => {
    const draft = layout('draft', 'D');
    const workspace = { laboratory, draft, active: null, archives: page([]) };
    const deleteDraft = vi.fn(async () => undefined);
    const reconcile = vi.fn()
      .mockRejectedValueOnce(new Error('temporary GET failure'))
      .mockResolvedValueOnce({ ...workspace, draft: null });

    await deleteCanonicalLayoutDraft({ deleteDraft }, layoutEditorStateFromServer(draft));
    const committed = workspaceAfterDraftDeletion(workspace);
    let issue;
    try {
      await reconcile();
    } catch {
      issue = mutationReconciliationIssue('delete', {
        message: 'Network error', retryable: true, authBoundary: false, notFound: false,
        versionConflict: false, preconditionFailure: false, contractFailure: false, fieldErrors: {},
      });
    }

    expect(committed).toMatchObject({ draft: null });
    expect(issue?.message).toContain('sudah berhasil dihapus');
    await reconcile();
    expect(deleteDraft).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('represents failed GET reconciliation as retryable without converting committed mutation success', () => {
    const baseIssue = {
      message: 'Network error', retryable: true, authBoundary: false, notFound: false,
      versionConflict: false, preconditionFailure: false, contractFailure: false, fieldErrors: {},
    };
    expect(mutationReconciliationIssue('activate', baseIssue)).toMatchObject({
      retryable: true,
      message: expect.stringContaining('sudah berhasil diaktifkan'),
    });
    expect(mutationReconciliationIssue('delete', baseIssue)).toMatchObject({
      retryable: true,
      message: expect.stringContaining('sudah berhasil dihapus'),
    });
  });
});
