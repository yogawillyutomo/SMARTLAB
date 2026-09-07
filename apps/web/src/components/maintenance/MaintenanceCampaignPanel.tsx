import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Layers3, Play, Plus } from 'lucide-react';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { assetGateway, type AssetDto } from '@/services/assetApi';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  MAINTENANCE_FREQUENCIES,
  maintenanceGateway,
  type MaintenanceCampaignDto,
  type MaintenanceFrequency,
} from '@/services/maintenanceApi';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/States';
import { FormDialog } from '@/components/forms/FormDialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

const FREQUENCY_LABELS: Record<MaintenanceFrequency, string> = {
  weekly: 'Mingguan',
  monthly: 'Bulanan',
  quarterly: 'Tiga Bulanan',
  semester: 'Semester',
  yearly: 'Tahunan',
  custom_interval: 'Interval Khusus',
};

type CampaignForm = {
  laboratoryId: string;
  name: string;
  description: string;
  frequencyKind: MaintenanceFrequency;
  intervalDays: string;
  checklistTemplate: string[];
  assignedTechnicianReference: string;
  assignedTechnicianName: string;
  nextDueDate: string;
  assetIds: string[];
};

type BatchState = {
  campaign: MaintenanceCampaignDto;
  scheduledFor: string;
  technicianReference: string;
  technicianName: string;
  assetIds: string[];
} | null;

function defaultCampaignForm(): CampaignForm {
  return {
    laboratoryId: '',
    name: '',
    description: '',
    frequencyKind: 'monthly',
    intervalDays: '',
    checklistTemplate: [],
    assignedTechnicianReference: '',
    assignedTechnicianName: '',
    nextDueDate: new Date().toISOString().slice(0, 10),
    assetIds: [],
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Maintenance Campaign gagal.';
}

interface MaintenanceCampaignPanelProps {
  onChanged?: () => Promise<void> | void;
}

export function MaintenanceCampaignPanel({ onChanged }: MaintenanceCampaignPanelProps) {
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'maintenance.create-plan')
    && hasServerPermission(user, 'assets.view')
    && hasServerPermission(user, 'laboratories.view');
  const canSchedule = hasServerPermission(user, 'maintenance.schedule');
  const canToggle = hasServerPermission(user, 'maintenance.update-plan');

  const [campaigns, setCampaigns] = useState<MaintenanceCampaignDto[]>([]);
  const [laboratories, setLaboratories] = useState<LaboratoryDto[]>([]);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignForm>(defaultCampaignForm());
  const [checklistInput, setChecklistInput] = useState('');
  const [batchState, setBatchState] = useState<BatchState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextCampaigns, nextLabs, nextAssets] = await Promise.all([
        maintenanceGateway.listAllCampaigns(),
        canCreate ? laboratoryGateway.list() : Promise.resolve([]),
        canCreate ? assetGateway.listAll() : Promise.resolve([]),
      ]);
      setCampaigns(nextCampaigns);
      setLaboratories(nextLabs);
      setAssets(nextAssets);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [canCreate]);

  useEffect(() => { void load(); }, [load]);

  const selectedLabAssets = useMemo(() => assets
    .filter((asset) => asset.lifecycleStatus === 'active' && asset.homeLaboratoryId === form.laboratoryId)
    .sort((left, right) => left.assetCode.localeCompare(right.assetCode)), [assets, form.laboratoryId]);

  function openCreate() {
    const lab = laboratories.find((item) => item.status === 'active');
    const eligible = lab
      ? assets.filter((asset) => asset.lifecycleStatus === 'active' && asset.homeLaboratoryId === lab.id)
      : [];
    setForm({
      ...defaultCampaignForm(),
      laboratoryId: lab?.id ?? '',
      name: lab ? `Pemeliharaan Berkala ${lab.name}` : '',
      nextDueDate: new Date().toISOString().slice(0, 10),
      assetIds: eligible.map((asset) => asset.id),
    });
    setChecklistInput('');
    setCreateOpen(true);
  }

  function selectLaboratory(laboratoryId: string) {
    const lab = laboratories.find((item) => item.id === laboratoryId);
    const eligible = assets.filter((asset) =>
      asset.lifecycleStatus === 'active' && asset.homeLaboratoryId === laboratoryId);
    setForm((current) => ({
      ...current,
      laboratoryId,
      name: current.name.trim() === '' || current.name.startsWith('Pemeliharaan Berkala ')
        ? (lab ? `Pemeliharaan Berkala ${lab.name}` : current.name)
        : current.name,
      assetIds: eligible.map((asset) => asset.id),
    }));
  }

  function toggleAsset(assetId: string) {
    setForm((current) => ({
      ...current,
      assetIds: current.assetIds.includes(assetId)
        ? current.assetIds.filter((id) => id !== assetId)
        : [...current.assetIds, assetId],
    }));
  }

  function addChecklist() {
    const item = checklistInput.trim();
    if (!item || form.checklistTemplate.includes(item)) return;
    setForm((current) => ({ ...current, checklistTemplate: [...current.checklistTemplate, item] }));
    setChecklistInput('');
  }

  async function createCampaign() {
    if (!form.laboratoryId || form.name.trim().length < 3 || form.assetIds.length < 1 || form.checklistTemplate.length < 1) {
      toast('Lab, nama Campaign, minimal satu Asset, dan minimal satu checklist wajib diisi.', 'error');
      return;
    }
    if (form.frequencyKind === 'custom_interval' && Number(form.intervalDays) < 1) {
      toast('Interval hari Campaign tidak valid.', 'error');
      return;
    }

    setBusy(true);
    try {
      const campaign = await maintenanceGateway.createCampaign({
        laboratoryId: form.laboratoryId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        frequencyKind: form.frequencyKind,
        ...(form.frequencyKind === 'custom_interval' ? { intervalDays: Number(form.intervalDays) } : {}),
        checklistTemplate: form.checklistTemplate,
        assignedTechnicianReference: form.assignedTechnicianReference.trim() || null,
        assignedTechnicianName: form.assignedTechnicianName.trim() || null,
        nextDueDate: form.nextDueDate,
        assetIds: form.assetIds,
      });
      toast(`Campaign ${campaign.campaignCode} membuat ${campaign.itemCount} MaintenancePlan exact-Asset secara atomik.`, 'success');
      setCreateOpen(false);
      await load();
      await onChanged?.();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openBatch(campaign: MaintenanceCampaignDto) {
    setBatchState({
      campaign,
      scheduledFor: new Date().toISOString().slice(0, 10),
      technicianReference: campaign.assignedTechnicianReference ?? '',
      technicianName: campaign.assignedTechnicianNameSnapshot ?? '',
      assetIds: campaign.items.map((item) => item.assetId),
    });
  }

  function toggleBatchAsset(assetId: string) {
    if (!batchState) return;
    setBatchState({
      ...batchState,
      assetIds: batchState.assetIds.includes(assetId)
        ? batchState.assetIds.filter((id) => id !== assetId)
        : [...batchState.assetIds, assetId],
    });
  }

  async function scheduleBatch() {
    if (!batchState || batchState.assetIds.length < 1 || batchState.technicianName.trim().length < 2) {
      toast('Pilih minimal satu Asset dan isi teknisi batch.', 'error');
      return;
    }

    setBusy(true);
    try {
      const result = await maintenanceGateway.scheduleCampaign(
        batchState.campaign.id,
        batchState.campaign.version,
        {
          scheduledFor: batchState.scheduledFor,
          technicianReference: batchState.technicianReference.trim() || null,
          technicianName: batchState.technicianName.trim(),
          assetIds: batchState.assetIds,
        },
      );
      toast(`${result.executionCount} MaintenanceExecution exact-Asset berhasil dijadwalkan atomik.`, 'success');
      setBatchState(null);
      await load();
      await onChanged?.();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleCampaign(campaign: MaintenanceCampaignDto) {
    setBusy(true);
    try {
      if (campaign.status === 'active') {
        await maintenanceGateway.deactivateCampaign(campaign.id, campaign.version);
        toast('Campaign dinonaktifkan. Child MaintenancePlan tidak diubah.', 'success');
      } else {
        await maintenanceGateway.activateCampaign(campaign.id, campaign.version);
        toast('Campaign diaktifkan kembali untuk batch orchestration.', 'success');
      }
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Card><CardContent><p className="text-sm text-ink-muted">Memuat Maintenance Campaign...</p></CardContent></Card>;
  }
  if (loadError) {
    return <EmptyState title="Maintenance Campaign tidak dapat dimuat" description={loadError} action={<Button onClick={() => void load()}>Coba Lagi</Button>} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-accent-primary/20 bg-accent-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-primary"><Layers3 className="h-4 w-4" /> Maintenance Campaign / Batch Orchestration</div>
          <p className="mt-1 text-xs text-ink-muted">
            UX batch per Lab; authority tetap MaintenancePlan dan MaintenanceExecution exact-Asset. Campaign bukan custody dan tidak menutup Laboratorium.
          </p>
        </div>
        {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Campaign Baru</Button>}
      </div>

      {campaigns.length === 0 ? (
        <Card><EmptyState title="Belum ada Maintenance Campaign" description="Buat Campaign untuk memprovisi plan exact-Asset dan menjadwalkannya secara batch per Laboratorium." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink-primary">{campaign.name}</p>
                    <p className="text-xs text-ink-muted">{campaign.campaignCode} · {campaign.laboratoryCodeSnapshot} · {campaign.laboratoryNameSnapshot}</p>
                  </div>
                  <Badge tone={campaign.status === 'active' ? 'success' : 'muted'}>{campaign.status === 'active' ? 'Aktif' : 'Nonaktif'}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div><p className="text-ink-muted">Asset / Plan</p><p className="text-ink-secondary">{campaign.itemCount} exact Asset</p></div>
                  <div><p className="text-ink-muted">Frekuensi</p><p className="text-ink-secondary">{FREQUENCY_LABELS[campaign.frequencyKind]}{campaign.intervalDays ? ` · ${campaign.intervalDays} hari` : ''}</p></div>
                  <div><p className="text-ink-muted">Next Due Provisioning</p><p className="text-ink-secondary">{campaign.nextDueDate}</p></div>
                  <div><p className="text-ink-muted">Checklist</p><p className="text-ink-secondary">{campaign.checklistTemplate.length} item</p></div>
                </div>

                <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-base-700/60 p-2">
                  {campaign.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs">
                      <span className="min-w-0 truncate text-ink-secondary">{item.assetCodeSnapshot} · {item.assetNameSnapshot}</span>
                      <span className="shrink-0 text-ink-muted">{item.planCodeSnapshot}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-base-700/60 pt-3">
                  {canSchedule && campaign.status === 'active' && (
                    <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => openBatch(campaign)}>Jadwalkan Batch</Button>
                  )}
                  {canToggle && (
                    <Button size="sm" variant="secondary" loading={busy} onClick={() => void toggleCampaign(campaign)}>
                      {campaign.status === 'active' ? 'Nonaktifkan Campaign' : 'Aktifkan Campaign'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Maintenance Campaign Baru"
        description="Campaign memprovisi satu MaintenancePlan canonical untuk setiap Asset terpilih. Konfigurasi Campaign immutable; policy baru dibuat sebagai Campaign baru."
        onSubmit={() => void createCampaign()}
        submitLabel="Buat Campaign"
        loading={busy}
        size="xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Laboratorium"
            required
            value={form.laboratoryId}
            onChange={(event) => selectLaboratory(event.target.value)}
            placeholder="Pilih Lab"
            options={laboratories.filter((lab) => lab.status === 'active').map((lab) => ({ value: lab.id, label: `${lab.code} · ${lab.name}` }))}
          />
          <Input label="Nama Campaign" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Select
            label="Frekuensi"
            value={form.frequencyKind}
            onChange={(event) => setForm({ ...form, frequencyKind: event.target.value as MaintenanceFrequency, intervalDays: event.target.value === 'custom_interval' ? form.intervalDays : '' })}
            options={MAINTENANCE_FREQUENCIES.map((frequency) => ({ value: frequency, label: FREQUENCY_LABELS[frequency] }))}
          />
          {form.frequencyKind === 'custom_interval'
            ? <Input label="Interval Hari" type="number" min={1} max={3650} required value={form.intervalDays} onChange={(event) => setForm({ ...form, intervalDays: event.target.value })} />
            : <Input label="Next Due Date" type="date" required value={form.nextDueDate} onChange={(event) => setForm({ ...form, nextDueDate: event.target.value })} />}
          {form.frequencyKind === 'custom_interval' && <Input label="Next Due Date" type="date" required value={form.nextDueDate} onChange={(event) => setForm({ ...form, nextDueDate: event.target.value })} />}
          <Input label="Teknisi Default" value={form.assignedTechnicianName} onChange={(event) => setForm({ ...form, assignedTechnicianName: event.target.value })} />
          <Input label="Referensi Teknisi" value={form.assignedTechnicianReference} onChange={(event) => setForm({ ...form, assignedTechnicianReference: event.target.value })} />
          <div className="sm:col-span-2"><Textarea label="Deskripsi" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink-secondary">Asset exact di Laboratorium</p>
                <p className="text-xs text-ink-muted">Default semua Asset aktif dipilih. Uncheck Asset yang tidak masuk Campaign.</p>
              </div>
              <div className="flex gap-2">
                <Badge tone={form.assetIds.length > 0 ? 'success' : 'muted'}>{form.assetIds.length}/{selectedLabAssets.length} dipilih</Badge>
                {selectedLabAssets.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, assetIds: form.assetIds.length === selectedLabAssets.length ? [] : selectedLabAssets.map((asset) => asset.id) })}>
                    {form.assetIds.length === selectedLabAssets.length ? 'Kosongkan' : 'Pilih Semua'}
                  </Button>
                )}
              </div>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-base-700 bg-base-800/30 p-2">
              {selectedLabAssets.length === 0 ? (
                <p className="p-3 text-xs text-ink-muted">Lab ini belum memiliki Asset aktif canonical.</p>
              ) : selectedLabAssets.map((asset) => (
                <label key={asset.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-base-700/30">
                  <input type="checkbox" checked={form.assetIds.includes(asset.id)} onChange={() => toggleAsset(asset.id)} className="rounded border-base-600 text-accent-content" />
                  <span className="font-medium text-ink-secondary">{asset.assetCode}</span>
                  <span className="min-w-0 truncate text-ink-muted">{asset.name}</span>
                  <Badge tone="muted">{asset.category}</Badge>
                </label>
              ))}
            </div>
          </div>

          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink-secondary">Checklist Template</p>
            <div className="rounded-xl border border-base-700 bg-base-800/30 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <Input
                  value={checklistInput}
                  placeholder="Contoh: Bersihkan debu dan fan"
                  onChange={(event) => setChecklistInput(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addChecklist(); } }}
                />
                <Button onClick={addChecklist}>Tambah Checklist</Button>
              </div>
              <div className="mt-3 space-y-2">
                {form.checklistTemplate.map((item, index) => (
                  <div key={item} className="flex items-center gap-3 rounded-lg border border-base-700 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-ink-muted" />
                    <span className="flex-1 text-ink-secondary">{index + 1}. {item}</span>
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, checklistTemplate: form.checklistTemplate.filter((value) => value !== item) })}>Hapus</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      <Modal
        open={Boolean(batchState)}
        onClose={() => setBatchState(null)}
        title="Jadwalkan Maintenance Batch"
        description="Satu aksi menghasilkan ordinary MaintenanceExecution exact-Asset untuk setiap item terpilih. Tidak ada Campaign custody."
        size="xl"
        footer={<><Button variant="ghost" onClick={() => setBatchState(null)}>Batal</Button><Button loading={busy} onClick={() => void scheduleBatch()}>Jadwalkan Batch</Button></>}
      >
        {batchState && <div className="space-y-4">
          <div className="rounded-lg border border-base-700 p-3">
            <p className="text-sm font-medium text-ink-primary">{batchState.campaign.campaignCode} · {batchState.campaign.name}</p>
            <p className="text-xs text-ink-muted">{batchState.campaign.laboratoryCodeSnapshot} · {batchState.campaign.laboratoryNameSnapshot}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Tanggal Batch" type="date" required value={batchState.scheduledFor} onChange={(event) => setBatchState({ ...batchState, scheduledFor: event.target.value })} />
            <Input label="Teknisi" required value={batchState.technicianName} onChange={(event) => setBatchState({ ...batchState, technicianName: event.target.value })} />
            <Input label="Referensi Teknisi" value={batchState.technicianReference} onChange={(event) => setBatchState({ ...batchState, technicianReference: event.target.value })} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-ink-secondary">Asset yang dijadwalkan</p>
              <div className="flex items-center gap-2">
                <Badge tone={batchState.assetIds.length > 0 ? 'success' : 'danger'}>{batchState.assetIds.length}/{batchState.campaign.itemCount}</Badge>
                <Button size="sm" variant="ghost" onClick={() => setBatchState({
                  ...batchState,
                  assetIds: batchState.assetIds.length === batchState.campaign.itemCount ? [] : batchState.campaign.items.map((item) => item.assetId),
                })}>{batchState.assetIds.length === batchState.campaign.itemCount ? 'Kosongkan' : 'Pilih Semua'}</Button>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-base-700 p-2">
              {batchState.campaign.items.map((item) => (
                <label key={item.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-base-700/30">
                  <input type="checkbox" checked={batchState.assetIds.includes(item.assetId)} onChange={() => toggleBatchAsset(item.assetId)} className="rounded border-base-600 text-accent-content" />
                  <span className="font-medium text-ink-secondary">{item.assetCodeSnapshot}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">{item.assetNameSnapshot}</span>
                  <span className="text-xs text-ink-muted">{item.planCodeSnapshot}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs text-ink-secondary">
            Batch scheduling tidak memulai custody. Custody baru diperoleh ketika masing-masing MaintenanceExecution dijalankan, dengan guard Loan / Maintenance / Work Order yang sama.
          </div>
        </div>}
      </Modal>
    </div>
  );
}
