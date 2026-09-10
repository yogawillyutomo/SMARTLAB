import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Check, Download, KanbanSquare, Package, Pause, Play, Plus, Table as TableIcon, Wrench } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { FormDialog } from '@/components/forms/FormDialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { downloadCSV, relativeTime, cn } from '@/utils';
import { assetGateway, ASSET_CONDITIONS, type AssetCondition, type AssetDto } from '@/services/assetApi';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import { inventoryGateway, type InventoryItemDto } from '@/services/inventoryApi';
import { formatInventoryQuantity } from '@/lib/inventoryQuantityPresentation';
import { incidentGateway, type IncidentListItem } from '@/services/incidentApi';
import { identityAdminGateway, type IdentityMembershipDto } from '@/services/identityAdminApi';
import {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  workOrderGateway,
  type WorkOrderDto,
  type WorkOrderEventDto,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from '@/services/workOrderApi';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/stores/toastStore';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Draft',
  assigned: 'Ditugaskan',
  in_progress: 'Berlangsung',
  on_hold: 'Ditahan',
  waiting_part: 'Menunggu Part',
  completed: 'Selesai Teknis',
  verified: 'Terverifikasi',
  cancelled: 'Dibatalkan',
};
const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Rendah',
  normal: 'Normal',
  high: 'Tinggi',
  critical: 'Kritis',
};
const CONDITION_LABELS: Record<AssetCondition, string> = {
  good: 'Baik',
  minor_damage: 'Rusak Ringan',
  moderate_damage: 'Rusak Sedang',
  major_damage: 'Rusak Berat',
  unknown: 'Tidak Diketahui',
};

type CreateForm = {
  assetId: string;
  laboratoryId: string;
  incidentId: string;
  problemSummary: string;
  priority: WorkOrderPriority;
  scheduledFor: string;
  notes: string;
};
type CompleteForm = { diagnosis: string; actionTaken: string; conditionAfter: AssetCondition; testResult: string };
type ReasonAction = 'hold' | 'waiting' | 'rework' | 'cancel';
type ViewMode = 'table' | 'board' | 'calendar';

const EMPTY_CREATE: CreateForm = {
  assetId: '',
  laboratoryId: '',
  incidentId: '',
  problemSummary: '',
  priority: 'normal',
  scheduledFor: '',
  notes: '',
};
const EMPTY_COMPLETE: CompleteForm = {
  diagnosis: '',
  actionTaken: '',
  conditionAfter: 'good',
  testResult: '',
};

function messageFrom(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Work Order gagal.';
}
function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}
function statusTone(status: WorkOrderStatus): 'muted' | 'info' | 'warning' | 'success' | 'danger' {
  if (status === 'verified') return 'success';
  if (status === 'completed' || status === 'assigned') return 'info';
  if (status === 'in_progress' || status === 'waiting_part' || status === 'on_hold') return 'warning';
  if (status === 'cancelled') return 'danger';
  return 'muted';
}
function priorityTone(priority: WorkOrderPriority): 'muted' | 'info' | 'warning' | 'danger' {
  if (priority === 'critical') return 'danger';
  if (priority === 'high') return 'warning';
  if (priority === 'normal') return 'info';
  return 'muted';
}
function eventAssigneeName(event: WorkOrderEventDto): string | null {
  const assignee = event.payload.assignee;
  if (typeof assignee !== 'object' || assignee === null || Array.isArray(assignee)) return null;
  const name = (assignee as Record<string, unknown>).name;
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

function eventLabel(event: WorkOrderEventDto): string {
  if (event.eventType === 'work_order.assigned' || event.eventType === 'work_order.reassigned') {
    const assigneeName = eventAssigneeName(event);
    const action = event.eventType === 'work_order.assigned' ? 'Teknisi ditugaskan' : 'Teknisi diganti';
    return assigneeName ? `${action}: ${assigneeName}` : action;
  }

  const labels: Record<string, string> = {
    'work_order.created': 'Work Order dibuat',
    'work_order.updated': 'Work Order diperbarui',
    'work_order.started': 'Perbaikan dimulai',
    'work_order.held': 'Perbaikan ditahan',
    'work_order.waiting_part': 'Menunggu spare part',
    'work_order.resumed': 'Perbaikan dilanjutkan',
    'work_order.part_issued': 'Spare part digunakan',
    'work_order.completed': 'Pekerjaan teknis selesai',
    'work_order.rework_requested': 'Dikembalikan untuk rework',
    'work_order.verified': 'Perbaikan diverifikasi',
    'work_order.cancelled': 'Work Order dibatalkan',
  };
  return labels[event.eventType] ?? event.eventType;
}
async function listVisibleIncidents(): Promise<IncidentListItem[]> {
  const first = await incidentGateway.list({ page: 1, perPage: 100 });
  const remaining = first.meta.lastPage > 1
    ? await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
      incidentGateway.list({ page: index + 2, perPage: 100 })))
    : [];
  return [...first.data, ...remaining.flatMap((page) => page.data)]
    .filter((incident) => !['closed', 'rejected'].includes(incident.status));
}

async function listEligibleAssignees(): Promise<IdentityMembershipDto[]> {
  const [roles, first] = await Promise.all([
    identityAdminGateway.listRoles(),
    identityAdminGateway.listMemberships({ status: 'active', page: 1, perPage: 100 }),
  ]);
  const eligibleRoleKeys = new Set(
    roles.filter((role) => role.permissions.includes('work-orders.update')).map((role) => role.key),
  );
  const remaining = first.meta.lastPage > 1
    ? await Promise.all(Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
      identityAdminGateway.listMemberships({ status: 'active', page: index + 2, perPage: 100 })))
    : [];
  return [...first.data, ...remaining.flatMap((page) => page.data)]
    .filter((membership) => membership.user.status === 'active'
      && membership.roles.some((role) => eligibleRoleKeys.has(role.key)));
}

function partsFromHistory(history: WorkOrderEventDto[]) {
  return history.flatMap((event) => {
    if (event.eventType !== 'work_order.part_issued') return [];
    const name = event.payload.itemNameSnapshot;
    const quantity = event.payload.quantity;
    const unit = event.payload.unitSnapshot;
    const inventoryItemId = event.payload.inventoryItemId;
    if (typeof name !== 'string' || (typeof quantity !== 'string' && typeof quantity !== 'number')) return [];
    return [{
      key: event.id,
      name,
      quantity: String(quantity),
      unit: typeof unit === 'string' ? unit : '',
      inventoryItemId: typeof inventoryItemId === 'string' ? inventoryItemId : '',
    }];
  });
}

export function WorkOrdersPage() {
  const { id: routeId } = useParams();
  const user = useAuthStore((state) => state.user);
  const activeLabId = useUIStore((state) => state.activeLabId);
  const canCreate = hasServerPermission(user, 'work-orders.create');
  const canUpdate = hasServerPermission(user, 'work-orders.update');
  const canAssign = hasServerPermission(user, 'work-orders.assign');
  const canApprove = hasServerPermission(user, 'work-orders.approve');
  const canConsumeStock = hasServerPermission(user, 'work-orders.consume-stock');
  const canExport = hasServerPermission(user, 'work-orders.export');
  const canViewIncidents = hasServerPermission(user, 'incidents.view');

  const [workOrders, setWorkOrders] = useState<WorkOrderDto[]>([]);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItemDto[]>([]);
  const [incidents, setIncidents] = useState<IncidentListItem[]>([]);
  const [technicians, setTechnicians] = useState<IdentityMembershipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<ViewMode>('table');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [detail, setDetail] = useState<WorkOrderDto | null>(null);
  const [history, setHistory] = useState<WorkOrderEventDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assigneeMembershipId, setAssigneeMembershipId] = useState('');
  const [assignmentReason, setAssignmentReason] = useState('');
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeForm, setCompleteForm] = useState<CompleteForm>(EMPTY_COMPLETE);
  const [partOpen, setPartOpen] = useState(false);
  const [partItemId, setPartItemId] = useState('');
  const [partQuantity, setPartQuantity] = useState('1');
  const [partMutationId, setPartMutationId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextWorkOrders, nextAssets, nextLabs] = await Promise.all([
        workOrderGateway.listAll(),
        assetGateway.listAll(),
        laboratoryGateway.list(),
      ]);
      setWorkOrders(nextWorkOrders);
      setAssets(nextAssets);
      setLabs(nextLabs);

      if (canConsumeStock) {
        setInventoryItems(await inventoryGateway.listAllItems());
      } else {
        setInventoryItems([]);
      }
      if (canViewIncidents) {
        setIncidents(await listVisibleIncidents());
      } else {
        setIncidents([]);
      }
      if (canAssign) {
        setTechnicians(await listEligibleAssignees());
      } else {
        setTechnicians([]);
      }
    } catch (error) {
      setLoadError(messageFrom(error));
    } finally {
      setLoading(false);
    }
  }, [canAssign, canConsumeStock, canViewIncidents]);

  useEffect(() => { void load(); }, [load]);

  const scopedWorkOrders = useMemo(
    () => activeLabId ? workOrders.filter((workOrder) => workOrder.laboratoryId === activeLabId) : workOrders,
    [activeLabId, workOrders],
  );
  const scopedAssets = useMemo(
    () => activeLabId ? assets.filter((asset) => asset.homeLaboratoryId === activeLabId) : assets,
    [activeLabId, assets],
  );
  const scopedLabs = useMemo(
    () => activeLabId ? labs.filter((lab) => lab.id === activeLabId) : labs,
    [activeLabId, labs],
  );
  const scopedIncidents = useMemo(
    () => activeLabId ? incidents.filter((incident) => incident.laboratory.id === activeLabId) : incidents,
    [activeLabId, incidents],
  );

  const openDetail = useCallback(async (workOrder: WorkOrderDto) => {
    setDetail(workOrder);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const [fresh, events] = await Promise.all([
        workOrderGateway.show(workOrder.id),
        workOrderGateway.history(workOrder.id),
      ]);
      setDetail(fresh);
      setHistory(events);
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!routeId || loading) return;
    const candidate = workOrders.find((workOrder) => workOrder.id === routeId);
    if (candidate) void openDetail(candidate);
  }, [routeId, loading, workOrders, openDetail]);

  const counts = useMemo(() => Object.fromEntries(
    WORK_ORDER_STATUSES.map((status) => [status, scopedWorkOrders.filter((item) => item.status === status).length]),
  ) as Record<WorkOrderStatus, number>, [scopedWorkOrders]);

  const parts = useMemo(() => partsFromHistory(history), [history]);

  async function refreshAfterMutation(workOrder?: WorkOrderDto) {
    const next = await workOrderGateway.listAll();
    setWorkOrders(next);
    if (workOrder) {
      const fresh = await workOrderGateway.show(workOrder.id);
      setDetail(fresh);
      setHistory(await workOrderGateway.history(workOrder.id));
    }
  }

  function openCreate() {
    const firstAsset = scopedAssets.find((asset) => asset.lifecycleStatus === 'active');
    setCreateForm({
      ...EMPTY_CREATE,
      assetId: firstAsset?.id ?? '',
      laboratoryId: firstAsset?.homeLaboratoryId ?? scopedLabs.find((lab) => lab.status === 'active')?.id ?? '',
      incidentId: '',
      scheduledFor: new Date().toISOString().slice(0, 10),
    });
    setCreateOpen(true);
  }

  async function createWorkOrder() {
    if (!createForm.assetId || !createForm.laboratoryId || createForm.problemSummary.trim().length < 3) {
      toast('Asset, Laboratorium, dan ringkasan masalah wajib diisi.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await workOrderGateway.create({
        assetId: createForm.assetId,
        laboratoryId: createForm.laboratoryId,
        incidentId: nullable(createForm.incidentId),
        problemSummary: createForm.problemSummary.trim(),
        priority: createForm.priority,
        scheduledFor: nullable(createForm.scheduledFor),
        notes: nullable(createForm.notes),
      });
      setCreateOpen(false);
      await refreshAfterMutation();
      toast('Work Order canonical dibuat sebagai Draft.', 'success');
      await openDetail(created);
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function selectAsset(assetId: string) {
    const asset = assets.find((candidate) => candidate.id === assetId);
    setCreateForm((form) => {
      const selectedIncident = incidents.find((incident) => incident.id === form.incidentId);
      const incidentStillCompatible = !selectedIncident?.device || selectedIncident.device.id === asset?.linkedDeviceId;
      return {
        ...form,
        assetId,
        incidentId: incidentStillCompatible ? form.incidentId : '',
        laboratoryId: asset?.homeLaboratoryId ?? form.laboratoryId,
      };
    });
  }

  function selectIncident(incidentId: string) {
    const incident = incidents.find((candidate) => candidate.id === incidentId);
    setCreateForm((form) => ({
      ...form,
      incidentId,
      laboratoryId: incident?.laboratory.id ?? form.laboratoryId,
    }));
  }

  function openAssignment(workOrder: WorkOrderDto) {
    setDetail(workOrder);
    setAssigneeMembershipId(workOrder.assigneeMembershipId ?? technicians[0]?.id ?? '');
    setAssignmentReason('');
    setAssignmentOpen(true);
  }

  async function submitAssignment() {
    if (!detail || !assigneeMembershipId) return;
    const reassignment = detail.status !== 'draft';
    if (reassignment && assignmentReason.trim().length < 3) {
      toast('Alasan reassignment minimal 3 karakter.', 'error');
      return;
    }
    setBusy(true);
    try {
      const updated = await workOrderGateway.assign(detail.id, detail.version, {
        assigneeMembershipId,
        ...(reassignment ? { reason: assignmentReason.trim() } : {}),
      });
      setAssignmentOpen(false);
      await refreshAfterMutation(updated);
      toast(reassignment ? 'Teknisi Work Order diganti.' : 'Teknisi Work Order ditugaskan.', 'success');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function directAction(action: 'start' | 'resume' | 'verify') {
    if (!detail) return;
    setBusy(true);
    try {
      const updated = action === 'start'
        ? await workOrderGateway.start(detail.id, detail.version)
        : action === 'resume'
          ? await workOrderGateway.resume(detail.id, detail.version)
          : await workOrderGateway.verify(detail.id, detail.version);
      await refreshAfterMutation(updated);
      toast(action === 'verify'
        ? 'Work Order terverifikasi; Asset condition diterapkan oleh Asset authority dan custody dilepas.'
        : 'Status Work Order diperbarui pada server.', 'success');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openReason(action: ReasonAction) {
    setReasonAction(action);
    setReasonText('');
  }

  async function submitReason() {
    if (!detail || !reasonAction || reasonText.trim().length < 3) {
      toast('Alasan minimal 3 karakter.', 'error');
      return;
    }
    setBusy(true);
    try {
      const reason = reasonText.trim();
      const updated = reasonAction === 'hold'
        ? await workOrderGateway.hold(detail.id, detail.version, reason)
        : reasonAction === 'waiting'
          ? await workOrderGateway.waitingPart(detail.id, detail.version, reason)
          : reasonAction === 'rework'
            ? await workOrderGateway.rework(detail.id, detail.version, reason)
            : await workOrderGateway.cancel(detail.id, detail.version, reason);
      setReasonAction(null);
      await refreshAfterMutation(updated);
      toast('Aksi Work Order tersimpan sebagai evidence server.', 'success');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openComplete() {
    if (!detail) return;
    setCompleteForm({
      diagnosis: detail.diagnosis ?? '',
      actionTaken: detail.actionTaken ?? '',
      conditionAfter: detail.conditionAfter ?? detail.conditionBefore ?? 'good',
      testResult: detail.testResult ?? '',
    });
    setCompleteOpen(true);
  }

  async function submitComplete() {
    if (!detail || completeForm.diagnosis.trim().length < 3 || completeForm.actionTaken.trim().length < 3) {
      toast('Diagnosis dan tindakan minimal 3 karakter.', 'error');
      return;
    }
    setBusy(true);
    try {
      const updated = await workOrderGateway.complete(detail.id, detail.version, {
        diagnosis: completeForm.diagnosis.trim(),
        actionTaken: completeForm.actionTaken.trim(),
        conditionAfter: completeForm.conditionAfter,
        testResult: nullable(completeForm.testResult),
      });
      setCompleteOpen(false);
      await refreshAfterMutation(updated);
      toast('Completion evidence tersimpan; Asset belum berubah sebelum verifikasi.', 'success');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openPart() {
    setPartItemId(inventoryItems.find((item) => item.onHandQuantity > 0)?.id ?? '');
    setPartQuantity('1');
    setPartMutationId(crypto.randomUUID());
    setPartOpen(true);
  }

  async function submitPart() {
    if (!detail || !partItemId || Number(partQuantity) <= 0 || !partMutationId) {
      toast('Pilih spare part dan jumlah yang valid.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await workOrderGateway.usePart(detail.id, detail.version, {
        inventoryItemId: partItemId,
        clientMutationId: partMutationId,
        quantity: Number(partQuantity),
      });
      setPartOpen(false);
      setInventoryItems(await inventoryGateway.listAllItems());
      await refreshAfterMutation(result.workOrder);
      toast(result.replayed ? 'Retry idempotent: stok tidak dikurangi ulang.' : 'Spare part diterbitkan melalui Inventory ledger.', 'success');
    } catch (error) {
      toast(messageFrom(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    downloadCSV('work-orders.csv', scopedWorkOrders.map((item) => ({
      WorkOrder: item.workOrderNumber,
      Asset: item.assetCodeSnapshot,
      AssetName: item.assetNameSnapshot,
      Laboratory: item.laboratoryNameSnapshot,
      Technician: item.assigneeNameSnapshot ?? '',
      Priority: PRIORITY_LABELS[item.priority],
      Status: STATUS_LABELS[item.status],
      ScheduledFor: item.scheduledFor ?? '',
      Problem: item.problemSummary,
    })));
  }

  const columns: Column<WorkOrderDto>[] = [
    { key: 'number', header: 'WO', sortable: true, sortValue: (item) => item.workOrderNumber, render: (item) => (
      <button className="font-medium text-accent-content hover:underline" onClick={() => void openDetail(item)}>{item.workOrderNumber}</button>
    ) },
    { key: 'asset', header: 'Asset', render: (item) => <div><p className="text-sm text-ink-primary">{item.assetCodeSnapshot}</p><p className="text-xs text-ink-muted">{item.assetNameSnapshot}</p></div> },
    { key: 'lab', header: 'Lab', render: (item) => item.laboratoryNameSnapshot },
    { key: 'technician', header: 'Teknisi', render: (item) => item.assigneeNameSnapshot ?? '-' },
    { key: 'priority', header: 'Prioritas', render: (item) => <Badge tone={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge> },
    { key: 'status', header: 'Status', render: (item) => <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge> },
  ];

  const boardStatuses = WORK_ORDER_STATUSES.filter((status) => counts[status] > 0);
  const selectedAsset = assets.find((asset) => asset.id === createForm.assetId);
  const compatibleIncidents = scopedIncidents.filter((incident) =>
    !incident.device || incident.device.id === selectedAsset?.linkedDeviceId);

  if (loading) return <LoadingState label="Memuat Work Order canonical..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tugas Perbaikan"
        description="Corrective Work Order exact-Asset mengikuti konteks Lab global di topbar; authority Inventory, Asset, custody, dan audit tetap server-side."
        icon={<Wrench className="h-5 w-5" />}
        actions={<>
          {canExport && <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Work Order Baru</Button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(['assigned','in_progress','completed','verified'] as WorkOrderStatus[]).map((status) => (
          <Card key={status}><CardContent><p className="text-2xl font-bold text-ink-primary">{counts[status]}</p><p className="text-xs text-ink-muted">{STATUS_LABELS[status]}</p></CardContent></Card>
        ))}
      </div>

      <div className="print-hidden flex w-fit items-center gap-1 rounded-lg border border-base-700 p-1">
        {([
          ['table', TableIcon, 'Tabel'],
          ['board', KanbanSquare, 'Board'],
          ['calendar', Calendar, 'Kalender'],
        ] as const).map(([mode, Icon, label]) => (
          <button key={mode} onClick={() => setView(mode)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === mode ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted')}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {scopedWorkOrders.length === 0 ? (
        <Card><EmptyState title="Belum ada Work Order" description="Buat Work Order dari exact Asset canonical ketika perbaikan corrective diperlukan." /></Card>
      ) : view === 'table' ? (
        <Card><DataTable columns={columns} data={scopedWorkOrders} rowKey={(item) => item.id} searchable searchKeys={(item) => `${item.workOrderNumber} ${item.assetCodeSnapshot} ${item.assetNameSnapshot} ${item.problemSummary} ${item.assigneeNameSnapshot ?? ''}`} /></Card>
      ) : view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {boardStatuses.map((status) => (
            <div key={status} className="space-y-2">
              <div className="flex items-center justify-between"><p className="text-sm font-semibold text-ink-secondary">{STATUS_LABELS[status]}</p><Badge tone="muted">{counts[status]}</Badge></div>
              {scopedWorkOrders.filter((item) => item.status === status).map((item) => (
                <button key={item.id} onClick={() => void openDetail(item)} className="w-full rounded-xl border border-base-700/70 bg-base-800/60 p-3 text-left hover:border-base-600">
                  <p className="text-sm font-medium text-ink-primary">{item.workOrderNumber}</p>
                  <p className="mt-1 truncate text-xs text-ink-muted">{item.assetCodeSnapshot} · {item.assetNameSnapshot}</p>
                  <div className="mt-2 flex items-center justify-between"><Badge tone={priorityTone(item.priority)}>{PRIORITY_LABELS[item.priority]}</Badge><span className="text-[10px] text-ink-muted">{item.assigneeNameSnapshot ?? 'Belum ditugaskan'}</span></div>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <Card><CardContent>
          <div className="space-y-2">
            {scopedWorkOrders.filter((item) => item.scheduledFor !== null).sort((a,b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '')).map((item) => (
              <button key={item.id} onClick={() => void openDetail(item)} className="flex w-full items-center justify-between rounded-lg border border-base-700/60 p-3 text-left hover:border-base-600">
                <div><p className="text-sm font-medium text-ink-primary">{item.scheduledFor} · {item.workOrderNumber}</p><p className="text-xs text-ink-muted">{item.assetCodeSnapshot} · {item.laboratoryNameSnapshot}</p></div>
                <Badge tone={statusTone(item.status)}>{STATUS_LABELS[item.status]}</Badge>
              </button>
            ))}
          </div>
        </CardContent></Card>
      )}

      <div className="rounded-xl border border-accent-primary/20 bg-accent-primary/5 p-4 text-xs text-ink-muted">
        Tidak ada lagi Work Order browser-local. Spare part hanya melalui InventoryTransaction sumber <code>work_order</code>; completion tidak mengubah Asset; verifikasi memakai Asset authority dan tidak mengubah Device atau Incident secara implisit.
      </div>

      <FormDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Work Order Baru" description="Satu Work Order selalu menarget satu exact Asset canonical." onSubmit={() => void createWorkOrder()} submitLabel="Buat Draft" loading={busy} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Asset" value={createForm.assetId} onChange={(e) => selectAsset(e.target.value)} options={scopedAssets.filter((asset) => asset.lifecycleStatus === 'active').map((asset) => ({ value: asset.id, label: `${asset.assetCode} · ${asset.name}` }))} placeholder="Pilih Asset" />
          <Select label="Laboratorium" value={createForm.laboratoryId} onChange={(e) => setCreateForm({...createForm,laboratoryId:e.target.value})} options={scopedLabs.filter((lab) => lab.status === 'active').map((lab) => ({value:lab.id,label:`${lab.code} · ${lab.name}`}))} placeholder="Pilih Lab" />
          {canViewIncidents && <Select label="Incident (opsional)" value={createForm.incidentId} onChange={(e) => selectIncident(e.target.value)} options={compatibleIncidents.map((incident) => ({value:incident.id,label:`${incident.ticketNumber} · ${incident.title}`}))} placeholder="Tanpa Incident" />}
          <Select label="Prioritas" value={createForm.priority} onChange={(e) => setCreateForm({...createForm,priority:e.target.value as WorkOrderPriority})} options={WORK_ORDER_PRIORITIES.map((priority)=>({value:priority,label:PRIORITY_LABELS[priority]}))} />
          <Input label="Jadwal" type="date" value={createForm.scheduledFor} onChange={(e)=>setCreateForm({...createForm,scheduledFor:e.target.value})} />
          <div className="sm:col-span-2"><Textarea label="Ringkasan Masalah" required value={createForm.problemSummary} onChange={(e)=>setCreateForm({...createForm,problemSummary:e.target.value})} /></div>
          <div className="sm:col-span-2"><Textarea label="Catatan" value={createForm.notes} onChange={(e)=>setCreateForm({...createForm,notes:e.target.value})} /></div>
        </div>
      </FormDialog>

      <Drawer open={detail !== null} onClose={() => setDetail(null)} title={detail?.workOrderNumber} description={detail ? `${detail.assetCodeSnapshot} · ${detail.assetNameSnapshot}` : ''} width="max-w-2xl">
        {detail && <div className="space-y-5">
          <div className="flex flex-wrap gap-2"><Badge tone={statusTone(detail.status)}>{STATUS_LABELS[detail.status]}</Badge><Badge tone={priorityTone(detail.priority)}>{PRIORITY_LABELS[detail.priority]}</Badge>{detail.custodyActive && <Badge tone="warning">Corrective Custody Aktif</Badge>}</div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div><p className="text-xs text-ink-muted">Asset</p><p className="text-ink-primary">{detail.assetCodeSnapshot} · {detail.assetNameSnapshot}</p></div>
            <div><p className="text-xs text-ink-muted">Laboratorium</p><p className="text-ink-primary">{detail.laboratoryCodeSnapshot} · {detail.laboratoryNameSnapshot}</p></div>
            <div><p className="text-xs text-ink-muted">Teknisi</p><p className="text-ink-primary">{detail.assigneeNameSnapshot ?? '-'}</p></div>
            <div><p className="text-xs text-ink-muted">Jadwal</p><p className="text-ink-primary">{detail.scheduledFor ?? '-'}</p></div>
            <div><p className="text-xs text-ink-muted">Mulai</p><p className="text-ink-primary">{detail.startedAt ? relativeTime(detail.startedAt) : '-'}</p></div>
            <div><p className="text-xs text-ink-muted">Versi</p><p className="text-ink-primary">{detail.version}</p></div>
          </div>
          <div><p className="text-xs text-ink-muted">Masalah</p><p className="text-sm text-ink-secondary">{detail.problemSummary}</p></div>
          {detail.diagnosis && <div><p className="text-xs text-ink-muted">Diagnosis</p><p className="text-sm text-ink-secondary">{detail.diagnosis}</p></div>}
          {detail.actionTaken && <div><p className="text-xs text-ink-muted">Tindakan</p><p className="text-sm text-ink-secondary">{detail.actionTaken}</p></div>}
          {detail.testResult && <div><p className="text-xs text-ink-muted">Hasil Uji</p><p className="text-sm text-ink-secondary">{detail.testResult}</p></div>}
          {(detail.conditionBefore || detail.conditionAfter) && <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-ink-muted">Kondisi Awal</p><p className="text-ink-primary">{detail.conditionBefore ? CONDITION_LABELS[detail.conditionBefore] : '-'}</p></div>
            <div><p className="text-xs text-ink-muted">Kondisi Usulan/Akhir</p><p className="text-ink-primary">{detail.conditionAfter ? CONDITION_LABELS[detail.conditionAfter] : '-'}</p></div>
          </div>}

          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Spare Part Evidence ({parts.length})</p>
            {parts.length === 0 ? <p className="text-xs text-ink-muted">Belum ada part issue.</p> : <div className="space-y-1">{parts.map((part)=><div key={part.key} className="flex justify-between rounded-lg border border-base-700/60 p-2 text-sm"><span>{part.name}</span><span className="text-ink-muted">{formatInventoryQuantity(part.quantity, part.unit)} {part.unit}</span></div>)}</div>}
          </div>

          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline</p>
            {historyLoading ? <LoadingState label="Memuat history..." className="py-4" /> : <ActivityTimeline items={history.map((event)=>({label:eventLabel(event),by:event.actorNameSnapshot,at:relativeTime(event.createdAt),tone:'accent' as const}))} />}
          </div>

          <div className="space-y-2 border-t border-base-700 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Aksi Server</p>
            <div className="flex flex-wrap gap-2">
              {canAssign && ['draft','assigned','in_progress','on_hold','waiting_part'].includes(detail.status) && <Button size="sm" variant="secondary" onClick={()=>openAssignment(detail)}>{detail.status === 'draft' ? 'Assign Teknisi' : 'Ganti Teknisi'}</Button>}
              {canUpdate && detail.status === 'assigned' && <Button size="sm" variant="warning" icon={<Play className="h-4 w-4" />} loading={busy} onClick={()=>void directAction('start')}>Mulai</Button>}
              {canUpdate && detail.status === 'in_progress' && <Button size="sm" variant="secondary" icon={<Pause className="h-4 w-4" />} onClick={()=>openReason('hold')}>Tahan</Button>}
              {canUpdate && ['in_progress','on_hold'].includes(detail.status) && <Button size="sm" variant="secondary" onClick={()=>openReason('waiting')}>Menunggu Part</Button>}
              {canUpdate && ['on_hold','waiting_part'].includes(detail.status) && <Button size="sm" variant="warning" icon={<Play className="h-4 w-4" />} loading={busy} onClick={()=>void directAction('resume')}>Lanjutkan</Button>}
              {canUpdate && canConsumeStock && detail.status === 'in_progress' && <Button size="sm" variant="secondary" icon={<Package className="h-4 w-4" />} onClick={openPart}>Gunakan Spare Part</Button>}
              {canUpdate && detail.status === 'in_progress' && <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={openComplete}>Selesaikan Teknis</Button>}
              {canApprove && detail.status === 'completed' && <Button size="sm" variant="success" loading={busy} onClick={()=>void directAction('verify')}>Verifikasi</Button>}
              {canApprove && detail.status === 'completed' && <Button size="sm" variant="secondary" onClick={()=>openReason('rework')}>Minta Rework</Button>}
              {(canAssign || canApprove) && ['draft','assigned','in_progress','on_hold','waiting_part'].includes(detail.status) && <Button size="sm" variant="danger" onClick={()=>openReason('cancel')}>Batalkan</Button>}
            </div>
          </div>
        </div>}
      </Drawer>

      <FormDialog open={assignmentOpen} onClose={()=>setAssignmentOpen(false)} title={detail?.status === 'draft' ? 'Assign Teknisi' : 'Ganti Teknisi'} onSubmit={()=>void submitAssignment()} submitLabel="Simpan Assignment" loading={busy}>
        <div className="space-y-4">
          <Select label="Teknisi" value={assigneeMembershipId} onChange={(e)=>setAssigneeMembershipId(e.target.value)} options={technicians.map((membership)=>({value:membership.id,label:`${membership.user.name} · ${membership.user.email}`}))} placeholder="Pilih teknisi" />
          {detail?.status !== 'draft' && <Textarea label="Alasan Reassignment" required value={assignmentReason} onChange={(e)=>setAssignmentReason(e.target.value)} />}
        </div>
      </FormDialog>

      <FormDialog open={reasonAction !== null} onClose={()=>setReasonAction(null)} title={reasonAction === 'hold' ? 'Tahan Perbaikan' : reasonAction === 'waiting' ? 'Menunggu Spare Part' : reasonAction === 'rework' ? 'Minta Rework' : 'Batalkan Work Order'} onSubmit={()=>void submitReason()} submitLabel="Simpan Evidence" loading={busy}>
        <Textarea label="Alasan" required value={reasonText} onChange={(e)=>setReasonText(e.target.value)} />
      </FormDialog>

      <FormDialog open={completeOpen} onClose={()=>setCompleteOpen(false)} title="Selesaikan Pekerjaan Teknis" description="Completion hanya menyimpan evidence. Asset condition baru diterapkan saat verifikasi." onSubmit={()=>void submitComplete()} submitLabel="Simpan Completion" loading={busy} size="lg">
        <div className="space-y-4">
          <Textarea label="Diagnosis" required value={completeForm.diagnosis} onChange={(e)=>setCompleteForm({...completeForm,diagnosis:e.target.value})} />
          <Textarea label="Tindakan" required value={completeForm.actionTaken} onChange={(e)=>setCompleteForm({...completeForm,actionTaken:e.target.value})} />
          <Select label="Kondisi Setelah Perbaikan" value={completeForm.conditionAfter} onChange={(e)=>setCompleteForm({...completeForm,conditionAfter:e.target.value as AssetCondition})} options={ASSET_CONDITIONS.map((condition)=>({value:condition,label:CONDITION_LABELS[condition]}))} />
          <Textarea label="Hasil Pengujian" value={completeForm.testResult} onChange={(e)=>setCompleteForm({...completeForm,testResult:e.target.value})} />
        </div>
      </FormDialog>

      <FormDialog open={partOpen} onClose={()=>setPartOpen(false)} title="Gunakan Spare Part" description="Stok berkurang hanya melalui immutable InventoryTransaction sourceType=work_order." onSubmit={()=>void submitPart()} submitLabel="Issue Spare Part" loading={busy}>
        <div className="space-y-4">
          <Select label="Inventory Item" value={partItemId} onChange={(e)=>setPartItemId(e.target.value)} options={inventoryItems.map((item)=>({value:item.id,label:`${item.itemCode} · ${item.name} (stok ${item.onHandQuantity} ${item.unit})`}))} placeholder="Pilih spare part" />
          <Input label="Jumlah" type="number" min="0.001" step="0.001" value={partQuantity} onChange={(e)=>setPartQuantity(e.target.value)} />
          <Input label="Mutation ID" value={partMutationId} readOnly hint="Dipertahankan selama retry dialog yang sama untuk idempotensi." />
        </div>
      </FormDialog>
    </div>
  );
}
