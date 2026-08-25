import { ApiClientError } from '@/lib/apiClient';
import {
  layoutEditorStateFromServer,
  replaceEditorStateWithServer,
  serializeLayoutEditorState,
  type CanonicalLayoutEditorState,
  type LayoutDeviceMetadataById,
} from '@/domain/server-layout';
import { LaboratoryContractError, type LaboratoryDto, type LaboratoryGateway } from '@/services/laboratoryApi';
import {
  LayoutContractError,
  type CreateLayoutDraftInput,
  type LayoutDto,
  type LayoutGateway,
  type LayoutPage,
  type UnplacedDeviceCandidateDto,
} from '@/services/layoutApi';
import type { LayoutCapabilities, LayoutPresentationIssue } from '@/lib/layoutPresentation';
import type { DeviceDto, DeviceGateway, DeviceType } from '@/services/deviceApi';
import type { DevicePlacementRole } from '@/services/layoutApi';

export const ARCHIVE_PAGE_SIZE = 10;
export const UNPLACED_PAGE_SIZE = 10;

export type LayoutSection = 'active' | 'draft' | 'history';

export interface LayoutWorkspaceData {
  laboratory: LaboratoryDto;
  active: LayoutDto | null;
  draft: LayoutDto | null;
  archives: LayoutPage;
}

export interface LayoutCreateFormValues {
  name: string;
  rows: string;
  columns: string;
  templateKey: string;
}

export interface LayoutCreateFormErrors {
  name?: string;
  rows?: string;
  columns?: string;
  templateKey?: string;
  request?: string;
}

export type LayoutCreateValidation =
  | { ok: true; input: CreateLayoutDraftInput }
  | { ok: false; errors: LayoutCreateFormErrors };

export class LayoutMutationGate {
  private pending = false;

  begin(): boolean {
    if (this.pending) return false;
    this.pending = true;
    return true;
  }

  end(): void {
    this.pending = false;
  }
}

export interface LayoutRouteScopeToken {
  laboratoryId: string | null;
  generation: number;
}

export class LayoutRouteScope {
  private laboratoryId: string | null = null;
  private generation = 0;
  private token: LayoutRouteScopeToken = { laboratoryId: null, generation: 0 };

  enter(laboratoryId: string | null): { token: LayoutRouteScopeToken; changed: boolean } {
    const changed = laboratoryId !== this.laboratoryId;
    if (changed) {
      this.laboratoryId = laboratoryId;
      this.generation += 1;
      this.token = { laboratoryId: this.laboratoryId, generation: this.generation };
    }
    return { token: this.token, changed };
  }

  isCurrent(token: LayoutRouteScopeToken): boolean {
    return token.laboratoryId === this.laboratoryId && token.generation === this.generation;
  }

  commit(token: LayoutRouteScopeToken, write: () => void): boolean {
    if (!this.isCurrent(token)) return false;
    write();
    return true;
  }
}

export class LayoutDeviceMetadataCache {
  private readonly requests = new Map<string, Promise<ReturnType<typeof layoutMetadataFromDevice>>>();

  load(
    deviceId: string,
    show: Pick<DeviceGateway, 'show'>['show'],
    validate?: (device: DeviceDto) => void,
  ): Promise<ReturnType<typeof layoutMetadataFromDevice>> {
    const existing = this.requests.get(deviceId);
    if (existing) return existing;
    const request = show(deviceId).then((device) => {
      validate?.(device);
      return layoutMetadataFromDevice(device);
    });
    this.requests.set(deviceId, request);
    return request;
  }
}

function onlyCurrentLayout(page: LayoutPage, status: 'active' | 'draft'): LayoutDto['id'] | null {
  if (page.data.length > 1) {
    throw new LayoutContractError(`Server mengembalikan lebih dari satu Layout ${status}.`);
  }
  return page.data[0]?.id ?? null;
}

export function assertLayoutOwnership(
  layout: Pick<LayoutDto, 'laboratoryId' | 'schoolId'>,
  laboratory: Pick<LaboratoryDto, 'id' | 'schoolId'>,
): void {
  if (layout.laboratoryId !== laboratory.id || layout.schoolId !== laboratory.schoolId) {
    throw new LayoutContractError('Layout tidak dimiliki Laboratory dan sekolah canonical yang sedang dibuka.');
  }
}

export function assertLayoutPageOwnership(page: LayoutPage, laboratory: Pick<LaboratoryDto, 'id' | 'schoolId'>): void {
  page.data.forEach((layout) => assertLayoutOwnership(layout, laboratory));
}

export async function loadLayoutWorkspaceData(
  laboratoryId: string,
  gateways: { laboratory: Pick<LaboratoryGateway, 'show'>; layout: LayoutGateway },
  archivePage = 1,
): Promise<LayoutWorkspaceData> {
  const laboratory = await gateways.laboratory.show(laboratoryId);
  const [draftPage, activePage, archives] = await Promise.all([
    gateways.layout.list(laboratoryId, { status: 'draft', page: 1, perPage: 25 }),
    gateways.layout.list(laboratoryId, { status: 'active', page: 1, perPage: 25 }),
    gateways.layout.list(laboratoryId, { status: 'archived', page: archivePage, perPage: ARCHIVE_PAGE_SIZE }),
  ]);
  assertLayoutPageOwnership(draftPage, laboratory);
  assertLayoutPageOwnership(activePage, laboratory);
  assertLayoutPageOwnership(archives, laboratory);
  const draftId = onlyCurrentLayout(draftPage, 'draft');
  const activeId = onlyCurrentLayout(activePage, 'active');
  const [draft, active] = await Promise.all([
    draftId ? gateways.layout.show(draftId) : Promise.resolve(null),
    activeId ? gateways.layout.show(activeId) : Promise.resolve(null),
  ]);
  if (draft) assertLayoutOwnership(draft, laboratory);
  if (active) assertLayoutOwnership(active, laboratory);
  return { laboratory, draft, active, archives };
}

export function initialLayoutSection(
  workspace: Pick<LayoutWorkspaceData, 'active' | 'draft' | 'archives'>,
  canUpdate: boolean,
): LayoutSection {
  if (workspace.draft && canUpdate) return 'draft';
  if (workspace.active) return 'active';
  if (workspace.draft) return 'draft';
  return workspace.archives.data.length > 0 ? 'history' : 'draft';
}

export function createFormForWorkspace(active: LayoutDto | null): LayoutCreateFormValues {
  return active
    ? { name: '', rows: '', columns: '', templateKey: '' }
    : { name: 'Denah Utama', rows: '8', columns: '8', templateKey: '' };
}

export function validateLayoutCreateForm(
  values: LayoutCreateFormValues,
  active: LayoutDto | null,
): LayoutCreateValidation {
  const name = values.name.trim();
  const templateKey = values.templateKey.trim();
  const errors: LayoutCreateFormErrors = {};
  if (name.length > 255 || (!active && name === '')) errors.name = 'Nama denah wajib diisi dan maksimal 255 karakter.';
  if (templateKey.length > 100) errors.templateKey = 'Provenance template maksimal 100 karakter.';
  if (active) {
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, input: name === '' ? { mode: 'clone' } : { mode: 'clone', name } };
  }
  const rows = Number(values.rows);
  const columns = Number(values.columns);
  if (!Number.isSafeInteger(rows) || rows < 1 || rows > 50) errors.rows = 'Baris harus berupa bilangan bulat 1–50.';
  if (!Number.isSafeInteger(columns) || columns < 1 || columns > 50) errors.columns = 'Kolom harus berupa bilangan bulat 1–50.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      mode: 'empty',
      name,
      rows,
      columns,
      ...(templateKey === '' ? {} : { templateKey }),
    },
  };
}

export function canCreateLayoutDraft(
  laboratory: LaboratoryDto,
  capabilities: LayoutCapabilities,
  draft: LayoutDto | null,
): boolean {
  return capabilities.create && laboratory.status === 'active' && draft === null;
}

export function canEditLayoutDraft(
  laboratory: LaboratoryDto,
  capabilities: LayoutCapabilities,
  draft: Pick<LayoutDto, 'status' | 'laboratoryId' | 'schoolId'>,
): boolean {
  return draft.status === 'draft'
    && draft.laboratoryId === laboratory.id
    && draft.schoolId === laboratory.schoolId
    && laboratory.status === 'active'
    && capabilities.update;
}

export function canDeleteLayoutDraft(
  laboratory: Pick<LaboratoryDto, 'id' | 'schoolId'>,
  capabilities: LayoutCapabilities,
  layout: Pick<LayoutDto, 'status' | 'laboratoryId' | 'schoolId'>,
): boolean {
  return capabilities.delete
    && layout.status === 'draft'
    && layout.laboratoryId === laboratory.id
    && layout.schoolId === laboratory.schoolId;
}

export function layoutEditorIsDirty(
  baseline: CanonicalLayoutEditorState | null,
  editor: CanonicalLayoutEditorState | null,
): boolean {
  if (!baseline || !editor) return false;
  return JSON.stringify(serializeLayoutEditorState(baseline)) !== JSON.stringify(serializeLayoutEditorState(editor));
}

export function visibleUnplacedCandidates(
  candidates: readonly UnplacedDeviceCandidateDto[],
  editor: CanonicalLayoutEditorState,
): UnplacedDeviceCandidateDto[] {
  const locallyPlaced = new Set(editor.devicePlacements.map((placement) => placement.deviceId));
  return candidates.filter((candidate) => !locallyPlaced.has(candidate.id));
}

export function shortCanonicalId(id: string): string {
  return id.length <= 8 ? id : `…${id.slice(-6)}`;
}

export function placementDisplayLabel(placement: CanonicalLayoutEditorState['devicePlacements'][number]): string {
  if (placement.label) return placement.label;
  if (placement.role === 'teacher_station') return `PC Guru · ${shortCanonicalId(placement.deviceId)}`;
  if (placement.role === 'student_station') return `PC Siswa · ${shortCanonicalId(placement.deviceId)}`;
  return `Device • ${shortCanonicalId(placement.deviceId)}`;
}

export function placementRoleOptions(
  deviceType: DeviceType | undefined,
  currentRole: DevicePlacementRole,
): Array<{ value: string; label: string }> {
  const options = [{ value: '', label: 'Tanpa role' }];
  if (deviceType === 'desktop_pc' || deviceType === 'laptop') {
    return [...options, { value: 'student_station', label: 'PC Siswa' }, { value: 'teacher_station', label: 'PC Guru' }];
  }
  if (currentRole === 'student_station') options.push({ value: currentRole, label: 'PC Siswa (metadata tidak tersedia)' });
  if (currentRole === 'teacher_station') options.push({ value: currentRole, label: 'PC Guru (metadata tidak tersedia)' });
  return options;
}

export function shouldLoadPlacementMetadata(
  editable: boolean,
  capabilities: LayoutCapabilities,
  hasMetadata: boolean,
): boolean {
  return editable && capabilities.viewUnplacedDevices && !hasMetadata;
}

export function layoutMetadataFromDevice(device: DeviceDto): LayoutDeviceMetadataById[string] {
  return {
    id: device.id,
    deviceCode: device.deviceCode,
    deviceType: device.deviceType,
    lifecycleStatus: device.lifecycleStatus,
    hostname: device.hostname,
    brand: device.brand,
    model: device.model,
  };
}

export function workspaceAfterActivation(workspace: LayoutWorkspaceData, active: LayoutDto): LayoutWorkspaceData {
  assertLayoutOwnership(active, workspace.laboratory);
  if (active.status !== 'active') throw new LayoutContractError('Respons aktivasi tidak berstatus active.');
  return { ...workspace, active, draft: null };
}

export function workspaceAfterDraftDeletion(workspace: LayoutWorkspaceData): LayoutWorkspaceData {
  return { ...workspace, draft: null };
}

export function mutationReconciliationIssue(
  kind: 'activate' | 'delete',
  issue: LayoutPresentationIssue,
): LayoutPresentationIssue {
  return {
    ...issue,
    message: `${kind === 'activate' ? 'Layout sudah berhasil diaktifkan' : 'Draft sudah berhasil dihapus'}, tetapi sinkronisasi daftar terbaru gagal. Coba sinkronkan kembali; mutasi tidak akan diulang.`,
    retryable: true,
  };
}

export function isDraftAlreadyExistsError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'LAYOUT_DRAFT_ALREADY_EXISTS';
}

export function layoutPageContractIssue(error: unknown): LayoutPresentationIssue | null {
  if (!(error instanceof LaboratoryContractError)) return null;
  return {
    message: 'Respons Laboratory dari server tidak sesuai kontrak yang diharapkan.',
    retryable: false,
    authBoundary: false,
    notFound: false,
    versionConflict: false,
    preconditionFailure: false,
    contractFailure: true,
    fieldErrors: {},
  };
}

export async function saveCanonicalLayoutDraft(
  gateway: Pick<LayoutGateway, 'replace'>,
  baseline: CanonicalLayoutEditorState,
  editor: CanonicalLayoutEditorState,
): Promise<{ layout: LayoutDto; editor: CanonicalLayoutEditorState }> {
  const layout = await gateway.replace(editor.id, baseline.version, serializeLayoutEditorState(editor));
  return { layout, editor: replaceEditorStateWithServer(layout) };
}

export async function activateCanonicalLayoutDraft(
  gateway: Pick<LayoutGateway, 'activate'>,
  baseline: CanonicalLayoutEditorState,
  editor: CanonicalLayoutEditorState,
): Promise<LayoutDto> {
  if (layoutEditorIsDirty(baseline, editor)) {
    throw new LayoutContractError('Draft yang belum disimpan tidak dapat diaktifkan.');
  }
  return gateway.activate(baseline.id, baseline.version);
}

export async function deleteCanonicalLayoutDraft(
  gateway: Pick<LayoutGateway, 'deleteDraft'>,
  baseline: CanonicalLayoutEditorState,
): Promise<void> {
  await gateway.deleteDraft(baseline.id, baseline.version);
}

export function editorPairFromServer(layout: LayoutDto): {
  baseline: CanonicalLayoutEditorState;
  editor: CanonicalLayoutEditorState;
} {
  const baseline = layoutEditorStateFromServer(layout);
  return { baseline, editor: layoutEditorStateFromServer(layout) };
}
