import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Pencil, Play, Plus, ShieldCheck, StopCircle, Wrench } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { hasServerPermission } from '@/lib/authIdentity';
import { ApiClientError } from '@/lib/apiClient';
import { PageHeader } from '@/components/common/PageHeader';
import { MaintenanceCampaignPanel } from '@/components/maintenance/MaintenanceCampaignPanel';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import { assetGateway, ASSET_CONDITIONS, type AssetCondition, type AssetDto } from '@/services/assetApi';
import { inventoryGateway, type InventoryItemDto } from '@/services/inventoryApi';
import {
  MAINTENANCE_FREQUENCIES,
  maintenanceGateway,
  type CompleteMaintenanceInventoryIssueInput,
  type MaintenanceExecutionDto,
  type MaintenanceFrequency,
  type MaintenancePlanDto,
} from '@/services/maintenanceApi';

const FREQUENCY_LABELS: Record<MaintenanceFrequency, string> = {
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  quarterly: 'Tiga Bulanan',
  semester: 'Semester',
  yearly: 'Tahunan',
  custom_interval: 'Interval Khusus',
};

const CONDITION_LABELS: Record<AssetCondition, string> = {
  good: 'Baik',
  minor_damage: 'Rusak Ringan',
  moderate_damage: 'Rusak Sedang',
  major_damage: 'Rusak Berat',
  unknown: 'Tidak Diketahui',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Preventive Maintenance gagal.';
}

function executionTone(status: MaintenanceExecutionDto['status']): 'muted' | 'warning' | 'success' | 'danger' {
  if (status === 'scheduled') return 'muted';
  if (status === 'in_progress') return 'warning';
  if (status === 'completed') return 'success';
  return 'danger';
}

function executionLabel(status: MaintenanceExecutionDto['status']): string {
  return {
    scheduled: 'Terjadwal',
    in_progress: 'Berlangsung',
    completed: 'Selesai',
    cancelled: 'Dibatalkan',
  }[status];
}

type PlanForm = {
  assetId: string;
  name: string;
  frequencyKind: MaintenanceFrequency;
  intervalDays: string;
  checklistTemplate: string[];
  assignedTechnicianReference: string;
  assignedTechnicianName: string;
  nextDueDate: string;
};

type ScheduleState = { plan: MaintenancePlanDto; scheduledFor: string; technicianReference: string; technicianName: string } | null;
type CancelState = { execution: MaintenanceExecutionDto; reason: string } | null;
type ChecklistProgressState = { execution: MaintenanceExecutionDto; checklistResults: boolean[] } | null;
type CompleteState = {
  execution: MaintenanceExecutionDto;
  checklistResults: boolean[];
  findings: string;
  actionTaken: string;
  conditionAfter: AssetCondition;
  inventoryIssues: CompleteMaintenanceInventoryIssueInput[];
} | null;

function checklistBooleans(execution: MaintenanceExecutionDto): boolean[] {
  const evidence = execution.checklistProgress ?? execution.checklistResults;
  return execution.checklistSnapshot.map((item, index) =>
    evidence?.[index]?.item === item ? evidence[index].done : false);
}

function defaultPlanForm(): PlanForm {
  return {
    assetId: '',
    name: '',
    frequencyKind: 'monthly',
    intervalDays: '',
    checklistTemplate: [],
    assignedTechnicianReference: '',
    assignedTechnicianName: '',
    nextDueDate: new Date().toISOString().slice(0, 10),
  };
}

export function MaintenancePage() {
  const user = useAuthStore((state) => state.user);
  const canViewAssets = hasServerPermission(user, 'assets.view');
  const canCreatePlan = hasServerPermission(user, 'maintenance.create-plan') && canViewAssets;
  const canUpdatePlan = hasServerPermission(user, 'maintenance.update-plan');
  const canSchedule = hasServerPermission(user, 'maintenance.schedule');
  const canStart = hasServerPermission(user, 'maintenance.start');
  const canComplete = hasServerPermission(user, 'maintenance.complete');
  const canCancel = hasServerPermission(user, 'maintenance.cancel');
  const canConsumeStock = hasServerPermission(user, 'maintenance.consume-stock') && hasServerPermission(user, 'stock.view');
  const canExport = hasServerPermission(user, 'maintenance.export');

  const [tab, setTab] = useState<'plans' | 'executions' | 'campaigns'>('plans');
  const [plans, setPlans] = useState<MaintenancePlanDto[]>([]);
  const [executions, setExecutions] = useState<MaintenanceExecutionDto[]>([]);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [stockItems, setStockItems] = useState<InventoryItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MaintenancePlanDto | null>(null);
  const [planForm, setPlanForm] = useState<PlanForm>(defaultPlanForm());
  const [checklistInput, setChecklistInput] = useState('');
  const [scheduleState, setScheduleState] = useState<ScheduleState>(null);
  const [checklistProgressState, setChecklistProgressState] = useState<ChecklistProgressState>(null);
  const [completeState, setCompleteState] = useState<CompleteState>(null);
  const [cancelState, setCancelState] = useState<CancelState>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextPlans, nextExecutions, nextAssets, nextStock] = await Promise.all([
        maintenanceGateway.listAllPlans(),
        maintenanceGateway.listAllExecutions(),
        canViewAssets ? assetGateway.listAll() : Promise.resolve([]),
        canConsumeStock ? inventoryGateway.listAllItems() : Promise.resolve([]),
      ]);
      setPlans(nextPlans);
      setExecutions(nextExecutions);
      setAssets(nextAssets);
      setStockItems(nextStock);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [canConsumeStock, canViewAssets]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeAssets = useMemo(() => assets.filter((asset) => asset.lifecycleStatus === 'active'), [assets]);
  const stats = useMemo(() => ({
    overdue: plans.filter((plan) => plan.isOverdue).length,
    activePlans: plans.filter((plan) => plan.status === 'active').length,
    scheduled: executions.filter((execution) => execution.status === 'scheduled').length,
    inProgress: executions.filter((execution) => execution.status === 'in_progress').length,
    completed: executions.filter((execution) => execution.status === 'completed').length,
  }), [executions, plans]);

  function openCreatePlan() {
    setEditingPlan(null);
    setPlanForm(defaultPlanForm());
    setChecklistInput('');
    setPlanOpen(true);
  }

  function openEditPlan(plan: MaintenancePlanDto) {
    setEditingPlan(plan);
    setPlanForm({
      assetId: plan.assetId,
      name: plan.name,
      frequencyKind: plan.frequencyKind,
      intervalDays: plan.intervalDays === null ? '' : String(plan.intervalDays),
      checklistTemplate: [...plan.checklistTemplate],
      assignedTechnicianReference: plan.assignedTechnicianReference ?? '',
      assignedTechnicianName: plan.assignedTechnicianNameSnapshot ?? '',
      nextDueDate: plan.nextDueDate,
    });
    setChecklistInput('');
    setPlanOpen(true);
  }

  function addChecklist() {
    const item = checklistInput.trim();
    if (!item || planForm.checklistTemplate.includes(item)) return;
    setPlanForm((current) => ({ ...current, checklistTemplate: [...current.checklistTemplate, item] }));
    setChecklistInput('');
  }

  async function savePlan() {
    if (planForm.name.trim().length < 3 || planForm.checklistTemplate.length === 0 || planForm.nextDueDate === '') {
      toast('Nama, checklist, dan jadwal berikutnya wajib diisi.', 'error');
      return;
    }
    if (!editingPlan && planForm.assetId === '') {
      toast('Pilih satu Asset canonical.', 'error');
      return;
    }
    const interval = planForm.frequencyKind === 'custom_interval' ? Number(planForm.intervalDays) : null;
    if (planForm.frequencyKind === 'custom_interval' && (!Number.isSafeInteger(interval) || (interval as number) < 1)) {
      toast('Interval khusus wajib berupa jumlah hari positif.', 'error');
      return;
    }

    try {
      if (editingPlan) {
        await maintenanceGateway.updatePlan(editingPlan.id, editingPlan.version, {
          name: planForm.name.trim(),
          frequencyKind: planForm.frequencyKind,
          intervalDays: interval,
          checklistTemplate: planForm.checklistTemplate,
          assignedTechnicianReference: planForm.assignedTechnicianReference.trim() || null,
          assignedTechnicianName: planForm.assignedTechnicianName.trim() || null,
          nextDueDate: planForm.nextDueDate,
        });
        toast('Rencana Preventive Maintenance diperbarui.', 'success');
      } else {
        await maintenanceGateway.createPlan({
          assetId: planForm.assetId,
          name: planForm.name.trim(),
          frequencyKind: planForm.frequencyKind,
          intervalDays: interval,
          checklistTemplate: planForm.checklistTemplate,
          assignedTechnicianReference: planForm.assignedTechnicianReference.trim() || null,
          assignedTechnicianName: planForm.assignedTechnicianName.trim() || null,
          nextDueDate: planForm.nextDueDate,
        });
        toast('Rencana terikat ke satu Asset canonical.', 'success');
      }
      setPlanOpen(false);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function togglePlan(plan: MaintenancePlanDto) {
    try {
      if (plan.status === 'active') {
        await maintenanceGateway.deactivatePlan(plan.id, plan.version);
        toast('Rencana dinonaktifkan tanpa menghapus history.', 'success');
      } else {
        await maintenanceGateway.activatePlan(plan.id, plan.version);
        toast('Rencana diaktifkan kembali setelah Asset direvalidasi.', 'success');
      }
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function scheduleExecution() {
    if (!scheduleState || scheduleState.technicianName.trim().length < 2 || !scheduleState.scheduledFor) {
      toast('Tanggal dan nama teknisi wajib diisi.', 'error');
      return;
    }
    try {
      await maintenanceGateway.scheduleExecution(scheduleState.plan.id, scheduleState.plan.version, {
        scheduledFor: scheduleState.scheduledFor,
        technicianReference: scheduleState.technicianReference.trim() || null,
        technicianName: scheduleState.technicianName.trim(),
      });
      toast('Execution disnapshot dari plan exact-Asset.', 'success');
      setScheduleState(null);
      setTab('executions');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function startExecution(execution: MaintenanceExecutionDto) {
    try {
      await maintenanceGateway.startExecution(execution.id, execution.version);
      toast('Maintenance custody aktif; Loan checkout untuk Asset ini sekarang fail-closed.', 'success');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function openChecklistProgress(execution: MaintenanceExecutionDto) {
    setChecklistProgressState({
      execution,
      checklistResults: checklistBooleans(execution),
    });
  }

  async function saveChecklistProgress() {
    if (!checklistProgressState) return;

    try {
      await maintenanceGateway.updateChecklistProgress(
        checklistProgressState.execution.id,
        checklistProgressState.execution.version,
        { checklistResults: checklistProgressState.checklistResults },
      );
      toast('Progress checklist tersimpan tanpa menyelesaikan Maintenance.', 'success');
      setChecklistProgressState(null);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function openComplete(execution: MaintenanceExecutionDto) {
    setCompleteState({
      execution,
      checklistResults: checklistBooleans(execution),
      findings: '',
      actionTaken: '',
      conditionAfter: execution.conditionBefore ?? 'good',
      inventoryIssues: [],
    });
  }

  function addInventoryIssue() {
    if (!completeState || stockItems.length === 0) return;
    const firstUnused = stockItems.find((item) => !completeState.inventoryIssues.some((issue) => issue.inventoryItemId === item.id));
    if (!firstUnused) return;
    setCompleteState({
      ...completeState,
      inventoryIssues: [...completeState.inventoryIssues, {
        inventoryItemId: firstUnused.id,
        clientMutationId: crypto.randomUUID(),
        quantity: 1,
      }],
    });
  }

  async function completeExecution() {
    if (!completeState || completeState.actionTaken.trim().length < 3) {
      toast('Tindakan preventif wajib dicatat.', 'error');
      return;
    }
    try {
      await maintenanceGateway.completeExecution(completeState.execution.id, completeState.execution.version, {
        checklistResults: completeState.checklistResults,
        findings: completeState.findings.trim() || null,
        actionTaken: completeState.actionTaken.trim(),
        conditionAfter: completeState.conditionAfter,
        inventoryIssues: completeState.inventoryIssues,
      });
      toast('Maintenance selesai atomik: evidence, Asset audit, Inventory ledger, custody release, dan next due tersimpan.', 'success');
      setCompleteState(null);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function cancelExecution() {
    if (!cancelState || cancelState.reason.trim().length < 3) {
      toast('Alasan pembatalan minimal 3 karakter.', 'error');
      return;
    }
    try {
      await maintenanceGateway.cancelExecution(cancelState.execution.id, cancelState.execution.version, cancelState.reason.trim());
      toast('Execution dibatalkan; custody dilepas tanpa mengubah Asset.', 'success');
      setCancelState(null);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function exportCsv() {
    downloadCSV('preventive-maintenance-canonical.csv', plans.map((plan) => ({
      Plan: plan.planCode,
      Asset: `${plan.assetCodeSnapshot} · ${plan.assetNameSnapshot}`,
      Nama: plan.name,
      Frekuensi: FREQUENCY_LABELS[plan.frequencyKind],
      NextDue: plan.nextDueDate,
      Status: plan.status,
      Overdue: plan.isOverdue ? 'Ya' : 'Tidak',
    })));
  }

  if (loading) return <Card><CardContent><p className="text-sm text-ink-muted">Memuat Preventive Maintenance canonical...</p></CardContent></Card>;
  if (loadError) return <EmptyState title="Preventive Maintenance tidak dapat dimuat" description={loadError} action={<Button onClick={() => void load()}>Coba Lagi</Button>} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pemeliharaan Berkala"
        description="Preventive Maintenance exact-Asset dengan Campaign/Batch orchestration per Lab. Custody, kondisi Asset, dan spare part tetap memakai authority canonical masing-masing."
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export</Button>}
          {canCreatePlan && tab === 'plans' && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreatePlan}>Rencana Baru</Button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card><CardContent><p className="text-2xl font-bold text-danger">{stats.overdue}</p><p className="text-xs text-ink-muted">Plan Overdue</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{stats.activePlans}</p><p className="text-xs text-ink-muted">Plan Aktif</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{stats.scheduled}</p><p className="text-xs text-ink-muted">Terjadwal</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-warning-foreground">{stats.inProgress}</p><p className="text-xs text-ink-muted">Custody Aktif</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{stats.completed}</p><p className="text-xs text-ink-muted">Selesai</p></CardContent></Card>
      </div>

      {stats.inProgress > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4" /> {stats.inProgress} Asset sedang berada dalam Maintenance custody dan tidak boleh di-checkout melalui Loan.
        </div>
      )}

      <div className="flex gap-2 border-b border-base-700">
        <button onClick={() => setTab('plans')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'plans' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Rencana</button>
        <button onClick={() => setTab('executions')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'executions' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Eksekusi & History</button>
        <button onClick={() => setTab('campaigns')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'campaigns' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Campaign & Batch</button>
      </div>

      {tab === 'plans' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {plans.length === 0 ? <Card className="lg:col-span-2"><EmptyState title="Belum ada rencana Preventive Maintenance" /></Card> : plans.map((plan) => (
            <Card key={plan.id}>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink-primary">{plan.name}</p>
                    <p className="text-xs text-ink-muted">{plan.planCode} · {plan.assetCodeSnapshot} · {plan.assetNameSnapshot}</p>
                  </div>
                  <div className="flex gap-1">
                    <Badge tone={plan.status === 'active' ? 'success' : 'muted'}>{plan.status === 'active' ? 'Aktif' : 'Nonaktif'}</Badge>
                    {plan.isOverdue && <Badge tone="danger">Overdue</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-ink-muted">Frekuensi</p><p className="text-ink-secondary">{FREQUENCY_LABELS[plan.frequencyKind]}{plan.intervalDays ? ` · ${plan.intervalDays} hari` : ''}</p></div>
                  <div><p className="text-ink-muted">Next Due</p><p className={plan.isOverdue ? 'text-danger' : 'text-ink-secondary'}>{plan.nextDueDate}</p></div>
                  <div><p className="text-ink-muted">Teknisi Default</p><p className="text-ink-secondary">{plan.assignedTechnicianNameSnapshot ?? '-'}</p></div>
                  <div><p className="text-ink-muted">Checklist</p><p className="text-ink-secondary">{plan.checklistTemplate.length} item</p></div>
                </div>
                <div className="space-y-1">
                  {plan.checklistTemplate.slice(0, 4).map((item) => <p key={item} className="flex items-center gap-2 text-xs text-ink-secondary"><CheckCircle2 className="h-3 w-3 text-ink-muted" />{item}</p>)}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-base-700/60 pt-3">
                  {canSchedule && plan.status === 'active' && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setScheduleState({
                    plan,
                    scheduledFor: new Date().toISOString().slice(0, 10),
                    technicianReference: plan.assignedTechnicianReference ?? '',
                    technicianName: plan.assignedTechnicianNameSnapshot ?? '',
                  })}>Jadwalkan Eksekusi</Button>}
                  {canUpdatePlan && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEditPlan(plan)}>Edit</Button>}
                  {canUpdatePlan && <Button size="sm" variant="secondary" onClick={() => void togglePlan(plan)}>{plan.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'}</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tab === 'executions' ? (
        <Card>
          {executions.length === 0 ? <EmptyState title="Belum ada execution Preventive Maintenance" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Execution</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Jadwal</th>
                  <th className="px-4 py-3 font-medium">Teknisi</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Kondisi</th>
                  <th className="px-4 py-3 font-medium">Spare Part</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr></thead>
                <tbody>
                  {executions.map((execution) => (
                    <tr key={execution.id} className="border-b border-base-700/40">
                      <td className="px-4 py-3 font-medium text-ink-primary">{execution.executionNumber}</td>
                      <td className="px-4 py-3 text-ink-secondary">{execution.assetCodeSnapshot}<div className="text-xs text-ink-muted">{execution.assetNameSnapshot}</div></td>
                      <td className="px-4 py-3 text-ink-secondary">{execution.scheduledFor}</td>
                      <td className="px-4 py-3 text-ink-secondary">{execution.technicianNameSnapshot}</td>
                      <td className="px-4 py-3"><Badge tone={executionTone(execution.status)}>{executionLabel(execution.status)}</Badge></td>
                      <td className="px-4 py-3 text-xs text-ink-secondary">{execution.conditionBefore ? CONDITION_LABELS[execution.conditionBefore] : '-'} → {execution.conditionAfter ? CONDITION_LABELS[execution.conditionAfter] : '-'}</td>
                      <td className="px-4 py-3 text-ink-secondary">{execution.inventoryTransactions.length}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {canStart && execution.status === 'scheduled' && <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => void startExecution(execution)}>Mulai</Button>}
                          {canComplete && execution.status === 'in_progress' && <Button size="sm" variant="secondary" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => openChecklistProgress(execution)}>Checklist</Button>}
                          {canComplete && execution.status === 'in_progress' && <Button size="sm" variant="success" icon={<Wrench className="h-3.5 w-3.5" />} onClick={() => openComplete(execution)}>Selesaikan</Button>}
                          {canCancel && (execution.status === 'scheduled' || execution.status === 'in_progress') && <Button size="sm" variant="ghost" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={() => setCancelState({ execution, reason: '' })}>Batalkan</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <MaintenanceCampaignPanel onChanged={load} />
      )}

      <FormDialog open={planOpen} onClose={() => setPlanOpen(false)} title={editingPlan ? 'Edit Rencana Preventive Maintenance' : 'Rencana Preventive Maintenance Baru'} onSubmit={() => void savePlan()} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          {!editingPlan ? (
            <Select
              label="Asset Canonical"
              required
              value={planForm.assetId}
              onChange={(event) => setPlanForm({ ...planForm, assetId: event.target.value })}
              placeholder="Pilih Asset exact"
              options={activeAssets.map((asset) => ({ value: asset.id, label: `${asset.assetCode} · ${asset.name}` }))}
            />
          ) : (
            <div><p className="text-sm font-medium text-ink-secondary">Asset Canonical</p><p className="mt-2 text-sm text-ink-primary">{editingPlan.assetCodeSnapshot} · {editingPlan.assetNameSnapshot}</p><p className="text-xs text-ink-muted">Asset target immutable untuk plan ini.</p></div>
          )}
          <Input label="Nama Rencana" required value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} />
          <Select label="Frekuensi" value={planForm.frequencyKind} onChange={(event) => setPlanForm({ ...planForm, frequencyKind: event.target.value as MaintenanceFrequency, intervalDays: event.target.value === 'custom_interval' ? planForm.intervalDays : '' })} options={MAINTENANCE_FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_LABELS[frequency] }))} />
          {planForm.frequencyKind === 'custom_interval' && <Input label="Interval Hari" required type="number" min={1} max={3650} value={planForm.intervalDays} onChange={(event) => setPlanForm({ ...planForm, intervalDays: event.target.value })} />}
          <Input label="Teknisi Default" value={planForm.assignedTechnicianName} onChange={(event) => setPlanForm({ ...planForm, assignedTechnicianName: event.target.value })} />
          <Input label="Referensi Teknisi (opsional)" value={planForm.assignedTechnicianReference} onChange={(event) => setPlanForm({ ...planForm, assignedTechnicianReference: event.target.value })} />
          <Input label="Next Due Date" required type="date" value={planForm.nextDueDate} onChange={(event) => setPlanForm({ ...planForm, nextDueDate: event.target.value })} />
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-secondary">Checklist Template</p>
                <p className="mt-0.5 text-xs text-ink-muted">Item di sini akan dibekukan menjadi checklist execution saat dijadwalkan.</p>
              </div>
              <Badge tone={planForm.checklistTemplate.length > 0 ? 'success' : 'muted'}>
                {planForm.checklistTemplate.length} item
              </Badge>
            </div>
            <div className="rounded-xl border border-base-700 bg-base-800/35 p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  value={checklistInput}
                  placeholder="Contoh: Periksa kondisi fisik"
                  onChange={(event) => setChecklistInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addChecklist(); } }}
                />
                <Button className="w-full sm:w-auto" onClick={addChecklist}>Tambah Checklist</Button>
              </div>
              {planForm.checklistTemplate.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-base-700 px-3 py-3 text-xs text-ink-muted">
                  Belum ada item. Tambahkan minimal satu checklist sebelum menyimpan rencana.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {planForm.checklistTemplate.map((item, index) => (
                    <div key={item} className="flex items-center gap-3 rounded-lg border border-base-700 bg-base-900/35 px-3 py-2.5 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-base-700 text-xs font-semibold text-ink-secondary">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-ink-secondary">{item}</span>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10"
                        onClick={() => setPlanForm({ ...planForm, checklistTemplate: planForm.checklistTemplate.filter((value) => value !== item) })}
                      >
                        Hapus
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </FormDialog>

      <Modal
        open={Boolean(scheduleState)}
        onClose={() => setScheduleState(null)}
        title="Jadwalkan Execution"
        description="Execution akan membekukan exact Asset, checklist, plan code, dan teknisi sebagai historical evidence."
        footer={<><Button variant="ghost" onClick={() => setScheduleState(null)}>Batal</Button><Button onClick={() => void scheduleExecution()}>Jadwalkan</Button></>}
      >
        {scheduleState && <div className="space-y-4">
          <div className="rounded-lg border border-base-700 p-3 text-sm text-ink-secondary">{scheduleState.plan.assetCodeSnapshot} · {scheduleState.plan.assetNameSnapshot}</div>
          <Input label="Tanggal" type="date" required value={scheduleState.scheduledFor} onChange={(event) => setScheduleState({ ...scheduleState, scheduledFor: event.target.value })} />
          <Input label="Teknisi" required value={scheduleState.technicianName} onChange={(event) => setScheduleState({ ...scheduleState, technicianName: event.target.value })} />
          <Input label="Referensi Teknisi" value={scheduleState.technicianReference} onChange={(event) => setScheduleState({ ...scheduleState, technicianReference: event.target.value })} />
        </div>}
      </Modal>

      <Modal
        open={Boolean(checklistProgressState)}
        onClose={() => setChecklistProgressState(null)}
        title="Progress Checklist Maintenance"
        description="Centang pekerjaan yang sudah dilakukan lalu simpan. Execution tetap Berlangsung dan custody tetap aktif sampai aksi Selesaikan dijalankan."
        footer={<>
          <Button variant="ghost" onClick={() => setChecklistProgressState(null)}>Batal</Button>
          <Button onClick={() => void saveChecklistProgress()}>Simpan Progress</Button>
        </>}
      >
        {checklistProgressState && <div className="space-y-3">
          <div className="rounded-lg border border-base-700 p-3 text-sm">
            <p className="font-medium text-ink-primary">{checklistProgressState.execution.assetCodeSnapshot} · {checklistProgressState.execution.assetNameSnapshot}</p>
            <p className="mt-1 text-xs text-ink-muted">Progress ini versioned dan diaudit di server; completion evidence tetap dikunci hanya saat Maintenance diselesaikan.</p>
          </div>
          {checklistProgressState.execution.checklistSnapshot.map((item, index) => (
            <label key={item} className="flex items-center gap-3 rounded-lg border border-base-700 bg-base-800/40 px-3 py-2.5 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={checklistProgressState.checklistResults[index]}
                onChange={(event) => {
                  const next = [...checklistProgressState.checklistResults];
                  next[index] = event.target.checked;
                  setChecklistProgressState({ ...checklistProgressState, checklistResults: next });
                }}
                className="rounded border-base-600 text-accent-content"
              />
              <span>{item}</span>
            </label>
          ))}
        </div>}
      </Modal>

      <Modal
        open={Boolean(completeState)}
        onClose={() => setCompleteState(null)}
        title="Selesaikan Preventive Maintenance"
        description="Completion atomik: checklist evidence, audited Asset condition, immutable stock issue, custody release, dan plan next-due."
        size="xl"
        footer={<><Button variant="ghost" onClick={() => setCompleteState(null)}>Batal</Button><Button onClick={() => void completeExecution()}>Selesaikan</Button></>}
      >
        {completeState && <div className="space-y-5">
          <div className="rounded-lg border border-base-700 p-3 text-sm">
            <p className="font-medium text-ink-primary">{completeState.execution.assetCodeSnapshot} · {completeState.execution.assetNameSnapshot}</p>
            <p className="text-xs text-ink-muted">Kondisi sebelum: {completeState.execution.conditionBefore ? CONDITION_LABELS[completeState.execution.conditionBefore] : '-'}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-secondary">Checklist Snapshot</p>
            <div className="space-y-2">{completeState.execution.checklistSnapshot.map((item, index) => (
              <label key={item} className="flex items-center gap-2 rounded-lg border border-base-700 px-3 py-2 text-sm text-ink-secondary">
                <input type="checkbox" checked={completeState.checklistResults[index]} onChange={(event) => {
                  const next = [...completeState.checklistResults];
                  next[index] = event.target.checked;
                  setCompleteState({ ...completeState, checklistResults: next });
                }} className="rounded border-base-600 text-accent-content" />
                {item}
              </label>
            ))}</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Kondisi Setelah Maintenance" value={completeState.conditionAfter} onChange={(event) => setCompleteState({ ...completeState, conditionAfter: event.target.value as AssetCondition })} options={ASSET_CONDITIONS.map((condition) => ({ value: condition, label: CONDITION_LABELS[condition] }))} />
            <div><p className="text-xs text-ink-muted">Asset authority</p><p className="mt-2 text-sm text-ink-secondary">Perubahan kondisi dicatat melalui AssetChangeEvent; tidak ada direct local Asset mutation.</p></div>
            <div className="sm:col-span-2"><Textarea label="Temuan" value={completeState.findings} onChange={(event) => setCompleteState({ ...completeState, findings: event.target.value })} /></div>
            <div className="sm:col-span-2"><Textarea label="Tindakan Preventif" required value={completeState.actionTaken} onChange={(event) => setCompleteState({ ...completeState, actionTaken: event.target.value })} /></div>
          </div>
          {canConsumeStock && <div>
            <div className="mb-2 flex items-center justify-between"><div><p className="text-sm font-medium text-ink-secondary">Spare Part Inventory</p><p className="text-xs text-ink-muted">Setiap row menjadi immutable InventoryTransaction issue dengan source MaintenanceExecution.</p></div><Button size="sm" variant="secondary" onClick={addInventoryIssue}>Tambah Spare Part</Button></div>
            <div className="space-y-2">{completeState.inventoryIssues.map((issue, index) => (
              <div key={issue.clientMutationId} className="grid gap-2 rounded-lg border border-base-700 p-3 sm:grid-cols-[1fr_130px_auto]">
                <Select value={issue.inventoryItemId} onChange={(event) => {
                  const next = [...completeState.inventoryIssues];
                  next[index] = { ...next[index], inventoryItemId: event.target.value };
                  setCompleteState({ ...completeState, inventoryIssues: next });
                }} options={stockItems.filter((item) => item.id === issue.inventoryItemId || !completeState.inventoryIssues.some((other) => other.inventoryItemId === item.id)).map((item) => ({ value: item.id, label: `${item.itemCode} · ${item.name} (stok ${item.onHandQuantity} ${item.unit})` }))} />
                <Input type="number" min={0.001} step={0.001} value={issue.quantity} onChange={(event) => {
                  const next = [...completeState.inventoryIssues];
                  next[index] = { ...next[index], quantity: Number(event.target.value) };
                  setCompleteState({ ...completeState, inventoryIssues: next });
                }} />
                <Button variant="ghost" size="sm" onClick={() => setCompleteState({ ...completeState, inventoryIssues: completeState.inventoryIssues.filter((_, itemIndex) => itemIndex !== index) })}>Hapus</Button>
              </div>
            ))}</div>
          </div>}
          <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-ink-secondary">Corrective repair tetap S5 Work Order. Menyelesaikan Preventive Maintenance ini tidak membuat Work Order atau Incident secara otomatis.</div>
        </div>}
      </Modal>

      <Modal
        open={Boolean(cancelState)}
        onClose={() => setCancelState(null)}
        title="Batalkan Execution"
        description="Jika execution sedang in-progress, Maintenance custody dilepas tanpa mengubah kondisi Asset."
        footer={<><Button variant="ghost" onClick={() => setCancelState(null)}>Kembali</Button><Button onClick={() => void cancelExecution()}>Batalkan Execution</Button></>}
      >
        {cancelState && <Textarea label="Alasan" required value={cancelState.reason} onChange={(event) => setCancelState({ ...cancelState, reason: event.target.value })} />}
      </Modal>
    </div>
  );
}
