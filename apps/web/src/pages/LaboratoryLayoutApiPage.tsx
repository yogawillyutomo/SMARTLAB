import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, CheckCircle2, History, Map as MapIcon, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { CanonicalLayoutEditor } from '@/components/server-layout/CanonicalLayoutEditor';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import {
  editorPairFromServer,
  initialLayoutSection,
  isDraftAlreadyExistsError,
  layoutEditorIsDirty,
  layoutPageContractIssue,
  loadLayoutWorkspaceData,
  LayoutMutationGate,
  LayoutRouteScope,
  LayoutDeviceMetadataCache,
  assertLayoutOwnership,
  assertLayoutPageOwnership,
  workspaceAfterActivation,
  workspaceAfterDraftDeletion,
  shouldLoadPlacementMetadata,
  mutationReconciliationIssue,
  saveCanonicalLayoutDraft,
  activateCanonicalLayoutDraft,
  deleteCanonicalLayoutDraft,
  canCreateLayoutDraft,
  canEditLayoutDraft,
  canDeleteLayoutDraft,
  createFormForWorkspace,
  validateLayoutCreateForm,
  ARCHIVE_PAGE_SIZE,
  UNPLACED_PAGE_SIZE,
  type LayoutCreateFormErrors,
  type LayoutCreateFormValues,
  type LayoutSection,
  type LayoutWorkspaceData,
  type LayoutRouteScopeToken,
} from '@/lib/layoutPage';
import { layoutCapabilities, layoutPresentationIssue, type LayoutPresentationIssue } from '@/lib/layoutPresentation';
import { laboratoryGateway } from '@/services/laboratoryApi';
import { LayoutContractError, layoutGateway, type LayoutDto, type UnplacedDeviceCandidateDto, type UnplacedDevicePage } from '@/services/layoutApi';
import { deviceGateway } from '@/services/deviceApi';
import { indexLayoutDeviceMetadata, type CanonicalLayoutEditorState, type LayoutDeviceMetadataById } from '@/domain/server-layout';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

type PageState =
  | { status: 'loading' }
  | { status: 'not_found'; message: string }
  | { status: 'error'; issue: LayoutPresentationIssue }
  | { status: 'ready'; workspace: LayoutWorkspaceData };

type UnplacedState =
  | { status: 'disabled'; data: []; meta: null }
  | { status: 'loading'; data: []; meta: null }
  | { status: 'error'; data: []; meta: null; message: string }
  | { status: 'ready'; data: UnplacedDeviceCandidateDto[]; meta: UnplacedDevicePage['meta'] };

function issueFor(error: unknown): LayoutPresentationIssue {
  return layoutPageContractIssue(error) ?? layoutPresentationIssue(error);
}

function statusLabel(status: LayoutDto['status']): string {
  return { draft: 'Draft', active: 'Aktif', archived: 'Diarsipkan' }[status];
}

function dateTime(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function LayoutReadSummary({ layout }: { layout: Pick<LayoutDto, 'status' | 'version' | 'rows' | 'columns' | 'updatedAt'> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card><CardContent><p className="text-xs text-ink-muted">Status</p><p className="mt-1 font-semibold text-ink-primary">{statusLabel(layout.status)}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs text-ink-muted">Versi</p><p className="mt-1 font-semibold text-ink-primary">{layout.version}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs text-ink-muted">Dimensi</p><p className="mt-1 font-semibold text-ink-primary">{layout.rows} × {layout.columns}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs text-ink-muted">Diperbarui</p><p className="mt-1 text-sm font-semibold text-ink-primary">{dateTime(layout.updatedAt)}</p></CardContent></Card>
    </div>
  );
}

export default function LaboratoryLayoutApiPage() {
  const { laboratoryId } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const capabilities = layoutCapabilities(user);
  const [pageState, setPageState] = useState<PageState>({ status: 'loading' });
  const [section, setSection] = useState<LayoutSection>('draft');
  const [baseline, setBaseline] = useState<CanonicalLayoutEditorState | null>(null);
  const [editor, setEditor] = useState<CanonicalLayoutEditorState | null>(null);
  const [archiveDetail, setArchiveDetail] = useState<LayoutDto | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archivePage, setArchivePage] = useState(1);
  const [metadataById, setMetadataById] = useState<LayoutDeviceMetadataById>({});
  const [metadataLoadingIds, setMetadataLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const [metadataErrors, setMetadataErrors] = useState<Readonly<Record<string, string>>>({});
  const [unplaced, setUnplaced] = useState<UnplacedState>({ status: 'disabled', data: [], meta: null });
  const [unplacedPage, setUnplacedPage] = useState(1);
  const [unplacedSearchInput, setUnplacedSearchInput] = useState('');
  const [unplacedSearch, setUnplacedSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<LayoutCreateFormValues>({ name: '', rows: '', columns: '', templateKey: '' });
  const [createErrors, setCreateErrors] = useState<LayoutCreateFormErrors>({});
  const [mutation, setMutation] = useState<'create' | 'save' | 'activate' | 'delete' | null>(null);
  const [actionIssue, setActionIssue] = useState<LayoutPresentationIssue | null>(null);
  const [reconciliationPending, setReconciliationPending] = useState<'activate' | 'delete' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'activate' | 'delete' | 'reload' | null>(null);
  const loadGeneration = useRef(0);
  const unplacedGeneration = useRef(0);
  const archiveGeneration = useRef(0);
  const archiveListGeneration = useRef(0);
  const metadataGeneration = useRef(0);
  const mutationGate = useRef(new LayoutMutationGate());
  const metadataCache = useRef(new LayoutDeviceMetadataCache());
  const routeScope = useRef(new LayoutRouteScope());
  const routeEntry = routeScope.current.enter(laboratoryId ?? null);
  const routeToken = routeEntry.token;

  if (routeEntry.changed) {
    loadGeneration.current += 1;
    unplacedGeneration.current += 1;
    archiveGeneration.current += 1;
    archiveListGeneration.current += 1;
    metadataGeneration.current += 1;
    mutationGate.current = new LayoutMutationGate();
    metadataCache.current = new LayoutDeviceMetadataCache();
  }

  const dirty = layoutEditorIsDirty(baseline, editor);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const recoverAuth = useCallback(async () => {
    await bootstrapSession({ force: true });
  }, [bootstrapSession]);

  const installDraft = useCallback((draft: LayoutDto | null) => {
    if (!draft) {
      setBaseline(null);
      setEditor(null);
      return;
    }
    const pair = editorPairFromServer(draft);
    setBaseline(pair.baseline);
    setEditor(pair.editor);
  }, []);

  const loadWorkspace = useCallback(async (
    targetArchivePage = 1,
    preserveSection = false,
    scope: LayoutRouteScopeToken = routeToken,
  ) => {
    if (!routeScope.current.isCurrent(scope)) return false;
    if (!scope.laboratoryId) {
      setPageState({ status: 'not_found', message: 'ID Laboratory pada route tidak tersedia.' });
      return false;
    }
    const generation = ++loadGeneration.current;
    setPageState({ status: 'loading' });
    try {
      const workspace = await loadLayoutWorkspaceData(scope.laboratoryId, { laboratory: laboratoryGateway, layout: layoutGateway }, targetArchivePage);
      if (!routeScope.current.isCurrent(scope) || generation !== loadGeneration.current) return false;
      setPageState({ status: 'ready', workspace });
      installDraft(workspace.draft);
      setArchiveDetail(null);
      if (!preserveSection) setSection(initialLayoutSection(workspace, capabilities.update));
      return true;
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== loadGeneration.current) return false;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return false;
      }
      else setPageState(issue.notFound ? { status: 'not_found', message: issue.message } : { status: 'error', issue });
      return false;
    }
  }, [capabilities.update, installDraft, recoverAuth, routeToken]);

  useEffect(() => {
    setPageState({ status: 'loading' });
    setSection('draft');
    setBaseline(null);
    setEditor(null);
    setArchiveDetail(null);
    setArchiveLoading(false);
    setArchivePage(1);
    setMetadataById({});
    setMetadataLoadingIds(new Set());
    setMetadataErrors({});
    setUnplaced({ status: 'disabled', data: [], meta: null });
    setUnplacedPage(1);
    setUnplacedSearchInput('');
    setUnplacedSearch('');
    setCreateOpen(false);
    setCreateErrors({});
    setMutation(null);
    setActionIssue(null);
    setReconciliationPending(null);
    setConfirmAction(null);
    void loadWorkspace(1, false, routeToken);
    return () => {
      loadGeneration.current += 1;
      unplacedGeneration.current += 1;
      archiveGeneration.current += 1;
      archiveListGeneration.current += 1;
      metadataGeneration.current += 1;
    };
  }, [loadWorkspace, routeToken]); // Route identity owns a fresh canonical workspace.

  const editorId = editor?.id;
  const editorStatus = editor?.status;
  const editorLaboratoryId = editor?.laboratoryId;
  const editorSchoolId = editor?.schoolId;
  const workspaceLaboratory = pageState.status === 'ready' ? pageState.workspace.laboratory : null;

  const loadUnplaced = useCallback(async (
    page = unplacedPage,
    search = unplacedSearch,
    scope: LayoutRouteScopeToken = routeToken,
  ) => {
    if (!routeScope.current.isCurrent(scope)) return;
    if (!workspaceLaboratory || workspaceLaboratory.id !== scope.laboratoryId) return;
    if (!editorId || editorStatus !== 'draft' || !capabilities.viewUnplacedDevices) {
      setUnplaced({ status: 'disabled', data: [], meta: null });
      return;
    }
    if (editorLaboratoryId !== workspaceLaboratory.id || editorSchoolId !== workspaceLaboratory.schoolId) {
      setUnplaced({ status: 'error', data: [], meta: null, message: 'Ownership draft Layout tidak sesuai Laboratory canonical.' });
      return;
    }
    const generation = ++unplacedGeneration.current;
    setUnplaced({ status: 'loading', data: [], meta: null });
    try {
      const response = await layoutGateway.unplacedDevices(editorId, {
        page,
        perPage: UNPLACED_PAGE_SIZE,
        ...(search.trim() === '' ? {} : { search: search.trim() }),
      });
      if (!routeScope.current.isCurrent(scope) || generation !== unplacedGeneration.current) return;
      setUnplaced({ status: 'ready', data: response.data, meta: response.meta });
      setMetadataById((current) => ({ ...current, ...indexLayoutDeviceMetadata(response.data) }));
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== unplacedGeneration.current) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      }
      else setUnplaced({ status: 'error', data: [], meta: null, message: issue.message });
    }
  }, [
    capabilities.viewUnplacedDevices,
    editorId,
    editorLaboratoryId,
    editorSchoolId,
    editorStatus,
    recoverAuth,
    routeToken,
    unplacedPage,
    unplacedSearch,
    workspaceLaboratory,
  ]);

  useEffect(() => {
    void loadUnplaced(unplacedPage, unplacedSearch, routeToken);
    return () => { unplacedGeneration.current += 1; };
  }, [loadUnplaced, routeToken, unplacedPage, unplacedSearch]);

  function openCreate(workspace: LayoutWorkspaceData) {
    setCreateForm(createFormForWorkspace(workspace.active));
    setCreateErrors({});
    setCreateOpen(true);
  }

  async function createDraft(workspace: LayoutWorkspaceData) {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope)) return;
    const validation = validateLayoutCreateForm(createForm, workspace.active);
    if (!validation.ok) {
      setCreateErrors(validation.errors);
      return;
    }
    const gate = mutationGate.current;
    if (!gate.begin()) return;
    setMutation('create');
    setActionIssue(null);
    setCreateErrors({});
    try {
      const created = await layoutGateway.createDraft(workspace.laboratory.id, validation.input);
      if (!routeScope.current.isCurrent(scope)) return;
      assertLayoutOwnership(created, workspace.laboratory);
      installDraft(created);
      setPageState({ status: 'ready', workspace: { ...workspace, draft: created } });
      setSection('draft');
      setCreateOpen(false);
      toast('Draft Layout dibuat dari respons server.', 'success');
    } catch (error) {
      if (!routeScope.current.isCurrent(scope)) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      }
      else {
        setActionIssue(issue);
        setCreateErrors({ request: issue.message, ...issue.fieldErrors });
        if (isDraftAlreadyExistsError(error) && routeScope.current.isCurrent(scope)) {
          await loadWorkspace(archivePage, true, scope);
          if (!routeScope.current.isCurrent(scope)) return;
        }
      }
    } finally {
      if (routeScope.current.isCurrent(scope)) setMutation(null);
      gate.end();
    }
  }

  async function saveDraft() {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || !baseline || !editor) return;
    const gate = mutationGate.current;
    if (!gate.begin()) return;
    setMutation('save');
    setActionIssue(null);
    try {
      if (pageState.status !== 'ready') throw new LayoutContractError();
      assertLayoutOwnership(baseline, pageState.workspace.laboratory);
      assertLayoutOwnership(editor, pageState.workspace.laboratory);
      const saved = await saveCanonicalLayoutDraft(layoutGateway, baseline, editor);
      if (!routeScope.current.isCurrent(scope)) return;
      if (pageState.status !== 'ready') return;
      assertLayoutOwnership(saved.layout, pageState.workspace.laboratory);
      setBaseline(saved.editor);
      setEditor(saved.editor);
      setPageState((current) => current.status === 'ready'
        ? { status: 'ready', workspace: { ...current.workspace, draft: saved.layout } }
        : current);
      toast('Draft Layout tersimpan pada server.', 'success');
      setUnplacedPage(1);
      if (unplacedPage === 1 && routeScope.current.isCurrent(scope)) void loadUnplaced(1, unplacedSearch, scope);
    } catch (error) {
      if (!routeScope.current.isCurrent(scope)) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      }
      else {
        setActionIssue(issue);
        toast(issue.message, 'error');
        if (issue.versionConflict) setConfirmAction('reload');
      }
    } finally {
      if (routeScope.current.isCurrent(scope)) setMutation(null);
      gate.end();
    }
  }

  async function reloadDraft() {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || !baseline || pageState.status !== 'ready') return;
    const workspace = pageState.workspace;
    const gate = mutationGate.current;
    if (!gate.begin()) return;
    setMutation('save');
    setActionIssue(null);
    try {
      assertLayoutOwnership(baseline, workspace.laboratory);
      const canonical = await layoutGateway.show(baseline.id);
      if (!routeScope.current.isCurrent(scope)) return;
      assertLayoutOwnership(canonical, workspace.laboratory);
      installDraft(canonical);
      setPageState((current) => current.status === 'ready'
        ? { status: 'ready', workspace: { ...current.workspace, draft: canonical } }
        : current);
      setConfirmAction(null);
      setUnplacedPage(1);
      if (unplacedPage === 1 && routeScope.current.isCurrent(scope)) void loadUnplaced(1, unplacedSearch, scope);
      toast('Draft dimuat ulang dari server.', 'info');
    } catch (error) {
      if (!routeScope.current.isCurrent(scope)) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else { setActionIssue(issue); toast(issue.message, 'error'); }
    } finally {
      if (routeScope.current.isCurrent(scope)) setMutation(null);
      gate.end();
    }
  }

  async function reconcileWorkspace(
    kind: 'activate' | 'delete',
    scope: LayoutRouteScopeToken = routeToken,
    targetArchivePage = 1,
  ) {
    if (!routeScope.current.isCurrent(scope) || !scope.laboratoryId) return;
    const generation = ++loadGeneration.current;
    try {
      const workspace = await loadLayoutWorkspaceData(
        scope.laboratoryId,
        { laboratory: laboratoryGateway, layout: layoutGateway },
        targetArchivePage,
      );
      if (!routeScope.current.isCurrent(scope) || generation !== loadGeneration.current) return;
      setPageState({ status: 'ready', workspace });
      installDraft(workspace.draft);
      setArchiveDetail(null);
      setSection(initialLayoutSection(workspace, capabilities.update));
      setReconciliationPending(null);
      setActionIssue(null);
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== loadGeneration.current) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
        return;
      }
      setReconciliationPending(kind);
      setActionIssue(mutationReconciliationIssue(kind, issue));
    }
  }

  async function activateDraft() {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || !baseline || !editor || pageState.status !== 'ready') return;
    const workspace = pageState.workspace;
    const gate = mutationGate.current;
    if (!gate.begin()) return;
    setMutation('activate');
    setActionIssue(null);
    try {
      assertLayoutOwnership(baseline, workspace.laboratory);
      assertLayoutOwnership(editor, workspace.laboratory);
      const activated = await activateCanonicalLayoutDraft(layoutGateway, baseline, editor);
      if (!routeScope.current.isCurrent(scope)) return;
      const committedWorkspace = workspaceAfterActivation(workspace, activated);
      setPageState({ status: 'ready', workspace: committedWorkspace });
      setBaseline(null);
      setEditor(null);
      setConfirmAction(null);
      setSection('active');
      setReconciliationPending(null);
      toast('Layout berhasil diaktifkan.', 'success');
      setArchivePage(1);
      if (!routeScope.current.isCurrent(scope)) return;
      await reconcileWorkspace('activate', scope, 1);
      if (!routeScope.current.isCurrent(scope)) return;
    } catch (error) {
      if (!routeScope.current.isCurrent(scope)) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else { setActionIssue(issue); toast(issue.message, 'error'); }
    } finally {
      if (routeScope.current.isCurrent(scope)) setMutation(null);
      gate.end();
    }
  }

  async function deleteDraft() {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || !baseline || pageState.status !== 'ready') return;
    const workspace = pageState.workspace;
    const gate = mutationGate.current;
    if (!gate.begin()) return;
    setMutation('delete');
    setActionIssue(null);
    try {
      assertLayoutOwnership(baseline, workspace.laboratory);
      if (!canDeleteLayoutDraft(workspace.laboratory, capabilities, baseline)) {
        throw new LayoutContractError('Draft Layout tidak aman untuk dihapus dari workspace ini.');
      }
      await deleteCanonicalLayoutDraft(layoutGateway, baseline);
      if (!routeScope.current.isCurrent(scope)) return;
      const committedWorkspace = workspaceAfterDraftDeletion(workspace);
      setPageState({ status: 'ready', workspace: committedWorkspace });
      setBaseline(null);
      setEditor(null);
      setConfirmAction(null);
      setReconciliationPending(null);
      setSection(committedWorkspace.active ? 'active' : committedWorkspace.archives.data.length > 0 ? 'history' : 'draft');
      toast('Draft Layout dihapus.', 'success');
      if (!routeScope.current.isCurrent(scope)) return;
      await reconcileWorkspace('delete', scope, archivePage);
      if (!routeScope.current.isCurrent(scope)) return;
    } catch (error) {
      if (!routeScope.current.isCurrent(scope)) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else { setActionIssue(issue); toast(issue.message, 'error'); }
    } finally {
      if (routeScope.current.isCurrent(scope)) setMutation(null);
      gate.end();
    }
  }

  async function selectArchive(layout: LayoutDto | LayoutWorkspaceData['archives']['data'][number]) {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || pageState.status !== 'ready') return;
    const laboratory = pageState.workspace.laboratory;
    const generation = ++archiveGeneration.current;
    setArchiveLoading(true);
    setActionIssue(null);
    try {
      const canonical = await layoutGateway.show(layout.id);
      if (!routeScope.current.isCurrent(scope) || generation !== archiveGeneration.current) return;
      assertLayoutOwnership(canonical, laboratory);
      setArchiveDetail(canonical);
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== archiveGeneration.current) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else { setActionIssue(issue); setArchiveDetail(null); toast(issue.message, 'error'); }
    } finally {
      if (routeScope.current.isCurrent(scope) && generation === archiveGeneration.current) setArchiveLoading(false);
    }
  }

  async function loadArchivePage(page: number) {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope) || !scope.laboratoryId || pageState.status !== 'ready') return;
    const laboratory = pageState.workspace.laboratory;
    const generation = ++archiveListGeneration.current;
    setActionIssue(null);
    try {
      const archives = await layoutGateway.list(scope.laboratoryId, { status: 'archived', page, perPage: ARCHIVE_PAGE_SIZE });
      if (!routeScope.current.isCurrent(scope) || generation !== archiveListGeneration.current) return;
      assertLayoutPageOwnership(archives, laboratory);
      setArchivePage(page);
      setArchiveDetail(null);
      setPageState((current) => current.status === 'ready'
        ? { status: 'ready', workspace: { ...current.workspace, archives } }
        : current);
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== archiveListGeneration.current) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else { setActionIssue(issue); toast(issue.message, 'error'); }
    }
  }

  async function loadSelectedDeviceMetadata(deviceId: string) {
    const scope = routeToken;
    if (!routeScope.current.isCurrent(scope)
      || pageState.status !== 'ready'
      || pageState.workspace.laboratory.id !== scope.laboratoryId
      || !editor) return;
    const editableDraft = canEditLayoutDraft(pageState.workspace.laboratory, capabilities, editor);
    if (!shouldLoadPlacementMetadata(editableDraft, capabilities, Boolean(metadataById[deviceId]))) return;
    const laboratory = pageState.workspace.laboratory;
    const generation = metadataGeneration.current;
    setMetadataLoadingIds((current) => new Set(current).add(deviceId));
    setMetadataErrors((current) => {
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
    try {
      const metadata = await metadataCache.current.load(deviceId, deviceGateway.show, (device) => {
        if (device.id !== deviceId || device.schoolId !== laboratory.schoolId) {
          throw new LayoutContractError('Metadata Device tidak dimiliki sekolah canonical yang sedang dibuka.');
        }
      });
      if (!routeScope.current.isCurrent(scope) || generation !== metadataGeneration.current) return;
      setMetadataById((current) => ({ ...current, [deviceId]: metadata }));
    } catch (error) {
      if (!routeScope.current.isCurrent(scope) || generation !== metadataGeneration.current) return;
      const issue = issueFor(error);
      if (issue.authBoundary) {
        await recoverAuth();
        if (!routeScope.current.isCurrent(scope)) return;
      } else setMetadataErrors((current) => ({ ...current, [deviceId]: issue.message }));
    } finally {
      if (routeScope.current.isCurrent(scope) && generation === metadataGeneration.current) {
        setMetadataLoadingIds((current) => {
          const next = new Set(current);
          next.delete(deviceId);
          return next;
        });
      }
    }
  }

  function submitUnplacedSearch() {
    const search = unplacedSearchInput.trim();
    if (search === unplacedSearch && unplacedPage === 1) void loadUnplaced(1, search);
    else {
      setUnplacedSearch(search);
      setUnplacedPage(1);
    }
  }

  function changeUnplacedPage(page: number) {
    if (page === unplacedPage) void loadUnplaced(page, unplacedSearch);
    else setUnplacedPage(page);
  }

  if (pageState.status === 'loading') return <Card><LoadingState label="Memuat workspace Layout canonical..." /></Card>;
  if (pageState.status === 'not_found') return <EmptyState title="Data Layout tidak ditemukan" description={pageState.message} action={<Button onClick={() => navigate('/laboratories')}>Kembali</Button>} />;
  if (pageState.status === 'error') return <Card><ErrorState message={pageState.issue.message} onRetry={pageState.issue.retryable ? () => void loadWorkspace() : undefined} /></Card>;
  if (pageState.workspace.laboratory.id !== routeToken.laboratoryId) return <Card><LoadingState label="Mengganti workspace Laboratory..." /></Card>;

  const workspace = pageState.workspace;
  const canCreate = canCreateLayoutDraft(workspace.laboratory, capabilities, workspace.draft);
  const editable = Boolean(editor && canEditLayoutDraft(workspace.laboratory, capabilities, editor));
  const activePair = workspace.active ? editorPairFromServer(workspace.active).editor : null;
  const displayedEditor = section === 'draft' ? editor : section === 'active' ? activePair : archiveDetail ? editorPairFromServer(archiveDetail).editor : null;
  const isInactive = workspace.laboratory.status === 'inactive';
  const tabs = [
    ...(workspace.active ? [{ key: 'active', label: 'Aktif', icon: <CheckCircle2 className="h-4 w-4" /> }] : []),
    ...(workspace.draft || canCreate ? [{ key: 'draft', label: 'Draft', icon: <MapIcon className="h-4 w-4" /> }] : []),
    ...(workspace.archives.meta.total > 0 ? [{ key: 'history', label: `Riwayat (${workspace.archives.meta.total})`, icon: <History className="h-4 w-4" /> }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Denah · ${workspace.laboratory.name}`}
        description={`${workspace.laboratory.code} · ${workspace.laboratory.location} · sumber canonical server`}
        icon={<MapIcon className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(`/laboratories/${workspace.laboratory.id}`)}>Kembali</Button>
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate(workspace)}>Buat Draft</Button>}
          </>
        }
      />

      {isInactive && <div role="status" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">Laboratorium nonaktif: Layout tetap dapat dibaca dan draft dapat dihapus, tetapi create, edit, save, dan activate diblokir.</div>}
      {dirty && <div role="status" className="rounded-xl border border-info/40 bg-info/10 p-3 text-sm text-info">Ada perubahan draft yang belum disimpan.</div>}
      {actionIssue && (
        <div role="alert" className={`rounded-xl border p-3 text-sm ${reconciliationPending ? 'border-warning/40 bg-warning/10 text-warning-foreground' : 'border-danger/40 bg-danger/10 text-danger'}`}>
          <p>{actionIssue.message}</p>
          {Object.entries(actionIssue.fieldErrors).length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {Object.entries(actionIssue.fieldErrors).map(([field, message]) => <li key={field}><span className="font-semibold">{field}:</span> {message}</li>)}
            </ul>
          )}
          {reconciliationPending && (
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => void reconcileWorkspace(reconciliationPending, routeToken, archivePage)}>
              Sinkronkan ulang
            </Button>
          )}
        </div>
      )}

      {tabs.length > 0 && <Tabs active={section} onChange={(key) => setSection(key as LayoutSection)} tabs={tabs} />}

      {section === 'draft' && !workspace.draft && (
        <Card><EmptyState icon={<MapIcon className="h-7 w-7" />} title="Belum ada draft Layout" description={workspace.active ? 'Buat draft baru dengan clone server dari Layout aktif.' : 'Buat draft kosong untuk mulai menyusun denah.'} action={canCreate ? <Button onClick={() => openCreate(workspace)}>Buat Draft</Button> : undefined} /></Card>
      )}
      {section === 'active' && !workspace.active && <Card><EmptyState title="Belum ada Layout aktif" description="Aktifkan draft yang sudah tersimpan untuk menerbitkan denah operasional." /></Card>}

      {(section === 'draft' || section === 'active') && displayedEditor && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted">{statusLabel(displayedEditor.status)} · versi {displayedEditor.version}</p>
            {section === 'draft' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} disabled={Boolean(mutation)} onClick={() => dirty ? setConfirmAction('reload') : void reloadDraft()}>Muat ulang</Button>
                {canDeleteLayoutDraft(workspace.laboratory, capabilities, displayedEditor) && <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={Boolean(mutation)} onClick={() => setConfirmAction('delete')}>Hapus Draft</Button>}
                {editable && <Button size="sm" icon={<Save className="h-4 w-4" />} loading={mutation === 'save'} disabled={!dirty || Boolean(mutation)} onClick={() => void saveDraft()}>Simpan</Button>}
                {editable && <Button variant="success" size="sm" icon={<CheckCircle2 className="h-4 w-4" />} disabled={dirty || Boolean(mutation)} onClick={() => setConfirmAction('activate')}>Aktifkan</Button>}
              </div>
            )}
          </div>
          <LayoutReadSummary layout={displayedEditor} />
          <CanonicalLayoutEditor
            key={`${displayedEditor.id}:${displayedEditor.version}:${section}`}
            editor={displayedEditor}
            editable={section === 'draft' && editable}
            metadataById={metadataById}
            metadataLoadingIds={metadataLoadingIds}
            metadataErrors={metadataErrors}
            canResolveDeviceMetadata={section === 'draft' && editable && capabilities.viewUnplacedDevices}
            onDevicePlacementSelect={(deviceId) => void loadSelectedDeviceMetadata(deviceId)}
            unplaced={section === 'draft' ? unplaced : { status: 'disabled', data: [], meta: null }}
            showUnplacedPanel={section === 'draft'}
            unplacedSearch={unplacedSearchInput}
            onUnplacedSearchChange={setUnplacedSearchInput}
            onUnplacedSearch={submitUnplacedSearch}
            onUnplacedPage={changeUnplacedPage}
            onRetryUnplaced={() => void loadUnplaced()}
            onEditorChange={setEditor}
            onMetadata={(candidate) => setMetadataById((current) => ({ ...current, [candidate.id]: candidate }))}
          />
        </>
      )}

      {section === 'history' && (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card><CardContent className="space-y-2">
            {workspace.archives.data.length === 0 && <EmptyState icon={<Archive className="h-6 w-6" />} title="Belum ada arsip" className="py-6" />}
            {workspace.archives.data.map((layout) => (
              <button key={layout.id} type="button" className="w-full rounded-lg border border-base-700 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus" onClick={() => void selectArchive(layout)}>
                <span className="block text-sm font-semibold text-ink-primary">{layout.name}</span><span className="text-xs text-ink-muted">Versi {layout.version} · {dateTime(layout.archivedAt)}</span>
              </button>
            ))}
            <div className="flex items-center justify-between pt-2 text-xs text-ink-muted">
              <Button size="sm" variant="secondary" disabled={archivePage <= 1} onClick={() => void loadArchivePage(archivePage - 1)}>Sebelumnya</Button>
              <span>{workspace.archives.meta.page}/{workspace.archives.meta.lastPage}</span>
              <Button size="sm" variant="secondary" disabled={archivePage >= workspace.archives.meta.lastPage} onClick={() => void loadArchivePage(archivePage + 1)}>Berikutnya</Button>
            </div>
          </CardContent></Card>
          <div>{archiveLoading ? <Card><LoadingState label="Memuat arsip..." /></Card> : archiveDetail && displayedEditor ? <><LayoutReadSummary layout={archiveDetail} /><div className="mt-4"><CanonicalLayoutEditor key={archiveDetail.id} editor={displayedEditor} editable={false} metadataById={{}} unplaced={{ status: 'disabled', data: [], meta: null }} unplacedSearch="" onUnplacedSearchChange={() => undefined} onUnplacedSearch={() => undefined} onUnplacedPage={() => undefined} onRetryUnplaced={() => undefined} onEditorChange={() => undefined} onMetadata={() => undefined} showUnplacedPanel={false} /></div></> : <Card><EmptyState title="Pilih Layout arsip" description="Detail baru dimuat saat dipilih; daftar tidak melakukan N+1 request." /></Card>}</div>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => { if (!mutation) setCreateOpen(false); }}
        title={workspace.active ? 'Clone Layout aktif menjadi draft' : 'Buat draft Layout kosong'}
        description={workspace.active ? 'Server menentukan sumber clone; UI hanya mengirim nama opsional.' : 'Tentukan identitas dan dimensi awal draft.'}
        footer={<><Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={Boolean(mutation)}>Batal</Button><Button loading={mutation === 'create'} onClick={() => void createDraft(workspace)}>Buat Draft</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input className="sm:col-span-2" label={workspace.active ? 'Nama baru (opsional)' : 'Nama'} value={createForm.name} error={createErrors.name} maxLength={255} onChange={(event) => setCreateForm((current) => ({ ...current, name: event.target.value }))} />
          {!workspace.active && <><Input label="Baris" type="number" min={1} max={50} value={createForm.rows} error={createErrors.rows} onChange={(event) => setCreateForm((current) => ({ ...current, rows: event.target.value }))} /><Input label="Kolom" type="number" min={1} max={50} value={createForm.columns} error={createErrors.columns} onChange={(event) => setCreateForm((current) => ({ ...current, columns: event.target.value }))} /><Input className="sm:col-span-2" label="Provenance template (opsional)" value={createForm.templateKey} error={createErrors.templateKey} maxLength={100} onChange={(event) => setCreateForm((current) => ({ ...current, templateKey: event.target.value }))} /></>}
        </div>
        {createErrors.request && <p role="alert" className="mt-3 text-sm text-danger">{createErrors.request}</p>}
      </Modal>

      <ConfirmDialog open={confirmAction === 'activate'} onClose={() => setConfirmAction(null)} onConfirm={() => void activateDraft()} title="Aktifkan Layout" message="Draft bersih ini akan menjadi Layout aktif dan server akan mengarsipkan predecessor secara transactional." confirmLabel="Aktifkan" danger={false} loading={mutation === 'activate'} />
      <ConfirmDialog open={confirmAction === 'delete'} onClose={() => setConfirmAction(null)} onConfirm={() => void deleteDraft()} title="Hapus draft" message={dirty ? 'Draft memiliki perubahan lokal yang belum disimpan. Hapus draft canonical dan buang perubahan tersebut?' : 'Hapus draft Layout canonical ini?'} confirmLabel="Hapus Draft" loading={mutation === 'delete'} />
      <ConfirmDialog open={confirmAction === 'reload'} onClose={() => setConfirmAction(null)} onConfirm={() => void reloadDraft()} title="Muat ulang draft" message="Perubahan lokal akan dibuang dan versi canonical terbaru akan dimuat dari server. Mutasi lama tidak akan dikirim ulang." confirmLabel="Muat Ulang" danger={false} loading={mutation === 'save'} />
      <ConfirmDialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} title="Tinggalkan editor?" message="Perubahan draft belum disimpan dan akan hilang." confirmLabel="Tinggalkan" />
    </div>
  );
}
