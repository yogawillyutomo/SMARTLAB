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
  loadLayoutWorkspaceData,
  placementRoleOptions,
  saveCanonicalLayoutDraft,
  validateLayoutCreateForm,
  visibleUnplacedCandidates,
} from '@/lib/layoutPage';
import type { LayoutCapabilities } from '@/lib/layoutPresentation';
import { LayoutContractError, type LayoutDto, type LayoutGateway, type LayoutPage, type UnplacedDeviceCandidateDto } from '@/services/layoutApi';
import { ApiClientError } from '@/lib/apiClient';
import type { LaboratoryDto } from '@/services/laboratoryApi';

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
    expect(canDeleteLayoutDraft(capabilities, draft)).toBe(true);
    expect(canDeleteLayoutDraft(capabilities, layout('active', 'A'))).toBe(false);
    expect(canDeleteLayoutDraft({ ...capabilities, delete: false }, draft)).toBe(false);
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
});
