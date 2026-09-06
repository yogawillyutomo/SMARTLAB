import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Boxes, Download, Link2, Pencil, Plus, Unlink } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { FormDialog } from '@/components/forms/FormDialog';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { downloadCSV, formatCurrency } from '@/utils';
import {
  ASSET_CONDITIONS,
  assetGateway,
  type AssetCondition,
  type AssetDto,
  type CreateAssetInput,
  type UpdateAssetInput,
} from '@/services/assetApi';
import { deviceGateway, type DeviceDto } from '@/services/deviceApi';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

const CONDITION_LABELS: Record<AssetCondition, string> = {
  good: 'Baik',
  minor_damage: 'Rusak Ringan',
  moderate_damage: 'Rusak Sedang',
  major_damage: 'Rusak Berat',
  unknown: 'Tidak Diketahui',
};

const LIFECYCLE_LABELS: Record<AssetDto['lifecycleStatus'], string> = {
  active: 'Aktif',
  retired: 'Pensiun',
  disposed: 'Dihapuskan',
};

type AssetForm = {
  assetCode: string;
  name: string;
  category: string;
  brand: string;
  model: string;
  serialNumber: string;
  homeLaboratoryId: string;
  condition: AssetCondition;
  acquisitionDate: string;
  acquisitionYear: string;
  fundingSource: string;
  purchasePrice: string;
  supplierName: string;
  warrantyUntil: string;
  notes: string;
};

const EMPTY_FORM: AssetForm = {
  assetCode: '',
  name: '',
  category: '',
  brand: '',
  model: '',
  serialNumber: '',
  homeLaboratoryId: '',
  condition: 'unknown',
  acquisitionDate: '',
  acquisitionYear: '',
  fundingSource: '',
  purchasePrice: '',
  supplierName: '',
  warrantyUntil: '',
  notes: '',
};

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toForm(asset: AssetDto): AssetForm {
  return {
    assetCode: asset.assetCode,
    name: asset.name,
    category: asset.category,
    brand: asset.brand ?? '',
    model: asset.model ?? '',
    serialNumber: asset.serialNumber ?? '',
    homeLaboratoryId: asset.homeLaboratoryId ?? '',
    condition: asset.condition,
    acquisitionDate: asset.acquisitionDate ?? '',
    acquisitionYear: asset.acquisitionYear === null ? '' : String(asset.acquisitionYear),
    fundingSource: asset.fundingSource ?? '',
    purchasePrice: asset.purchasePrice === null ? '' : String(asset.purchasePrice),
    supplierName: asset.supplierName ?? '',
    warrantyUntil: asset.warrantyUntil ?? '',
    notes: asset.notes ?? '',
  };
}

function createInput(form: AssetForm): CreateAssetInput {
  return {
    assetCode: form.assetCode,
    name: form.name,
    category: form.category,
    brand: nullIfBlank(form.brand),
    model: nullIfBlank(form.model),
    serialNumber: nullIfBlank(form.serialNumber),
    homeLaboratoryId: nullIfBlank(form.homeLaboratoryId),
    condition: form.condition,
    acquisitionDate: nullIfBlank(form.acquisitionDate),
    acquisitionYear: form.acquisitionYear === '' ? null : Number(form.acquisitionYear),
    fundingSource: nullIfBlank(form.fundingSource),
    purchasePrice: form.purchasePrice === '' ? null : Number(form.purchasePrice),
    supplierName: nullIfBlank(form.supplierName),
    warrantyUntil: nullIfBlank(form.warrantyUntil),
    notes: nullIfBlank(form.notes),
  };
}

function updateInput(form: AssetForm): UpdateAssetInput {
  const { assetCode: _assetCode, ...input } = createInput(form);
  void _assetCode;
  return input;
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Asset gagal.';
}

function conditionTone(condition: AssetCondition): 'success' | 'warning' | 'danger' | 'muted' {
  if (condition === 'good') return 'success';
  if (condition === 'minor_damage' || condition === 'unknown') return 'warning';
  return 'danger';
}

function lifecycleTone(status: AssetDto['lifecycleStatus']): 'success' | 'warning' | 'muted' {
  if (status === 'active') return 'success';
  if (status === 'retired') return 'warning';
  return 'muted';
}

async function listAllDevices(): Promise<DeviceDto[]> {
  const first = await deviceGateway.list({ page: 1, perPage: 100 });
  if (first.meta.lastPage === 1) return first.data;
  const pages = await Promise.all(
    Array.from({ length: first.meta.lastPage - 1 }, (_, index) =>
      deviceGateway.list({ page: index + 2, perPage: 100 })),
  );
  return [...first.data, ...pages.flatMap((page) => page.data)];
}

export function AssetsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'assets.create');
  const canUpdate = hasServerPermission(user, 'assets.update');
  const canExport = hasServerPermission(user, 'assets.export');
  const canLinkDevice = hasServerPermission(user, 'assets.link-device') && hasServerPermission(user, 'devices.view');
  const canRetire = hasServerPermission(user, 'assets.retire');
  const canDispose = hasServerPermission(user, 'assets.dispose');

  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AssetDto | null>(null);
  const [form, setForm] = useState<AssetForm>(EMPTY_FORM);
  const [linking, setLinking] = useState<AssetDto | null>(null);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [unlinking, setUnlinking] = useState<AssetDto | null>(null);
  const [retiring, setRetiring] = useState<AssetDto | null>(null);
  const [disposing, setDisposing] = useState<AssetDto | null>(null);
  const [reason, setReason] = useState('');
  const [filters, setFilters] = useState({ lab: 'all', condition: 'all', lifecycle: 'all' });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextAssets, nextLabs] = await Promise.all([assetGateway.listAll(), laboratoryGateway.list()]);
      setAssets(nextAssets);
      setLabs(nextLabs);
    } catch (error) {
      setLoadError(messageFrom(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => assets.filter((asset) => {
    if (filters.lab !== 'all' && asset.homeLaboratoryId !== filters.lab) return false;
    if (filters.condition !== 'all' && asset.condition !== filters.condition) return false;
    if (filters.lifecycle !== 'all' && asset.lifecycleStatus !== filters.lifecycle) return false;
    return true;
  }), [assets, filters]);

  const totalValue = assets.reduce((sum, asset) => sum + (asset.purchasePrice ?? 0), 0);
  const linkedCount = assets.filter((asset) => asset.linkedDeviceId !== null).length;

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, category: 'Komputer', homeLaboratoryId: labs[0]?.id ?? '' });
    setFormOpen(true);
  }

  function openEdit(asset: AssetDto) {
    setEditing(asset);
    setForm(toForm(asset));
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim() || !form.category.trim() || (!editing && !form.assetCode.trim())) {
      toast('Kode, nama, dan kategori wajib diisi.', 'error');
      return;
    }

    try {
      if (editing) {
        await assetGateway.update(editing.id, editing.version, updateInput(form));
        toast('Asset diperbarui pada server.', 'success');
      } else {
        await assetGateway.create(createInput(form));
        toast('Asset dibuat pada server.', 'success');
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  async function openLink(asset: AssetDto) {
    setLinking(asset);
    setDeviceId('');
    try {
      setDevices(await listAllDevices());
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  const linkCandidates = useMemo(() => {
    if (!linking) return [];
    return devices.filter((device) => {
      if (device.lifecycleStatus === 'decommissioned') return false;
      if (linking.homeLaboratoryId && device.homeLaboratoryId && linking.homeLaboratoryId !== device.homeLaboratoryId) return false;
      return true;
    });
  }, [devices, linking]);

  async function linkDevice() {
    if (!linking || !deviceId) return;
    try {
      await assetGateway.linkDevice(linking.id, linking.version, deviceId);
      toast('Asset ditautkan ke Device canonical.', 'success');
      setLinking(null);
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  async function runReasonAction(type: 'unlink' | 'retire' | 'dispose') {
    const target = type === 'unlink' ? unlinking : type === 'retire' ? retiring : disposing;
    if (!target || reason.trim().length < 3) {
      toast('Alasan minimal 3 karakter.', 'error');
      return;
    }
    try {
      if (type === 'unlink') await assetGateway.unlinkDevice(target.id, target.version, reason.trim());
      if (type === 'retire') await assetGateway.retire(target.id, target.version, reason.trim());
      if (type === 'dispose') await assetGateway.dispose(target.id, target.version, reason.trim());
      toast(type === 'unlink' ? 'Tautan Device dilepas.' : type === 'retire' ? 'Asset dipensiunkan.' : 'Asset dihapuskan secara administratif.', 'success');
      setUnlinking(null);
      setRetiring(null);
      setDisposing(null);
      setReason('');
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  function exportCsv() {
    downloadCSV('aset-canonical.csv', filtered.map((asset) => ({
      Kode: asset.assetCode,
      Nama: asset.name,
      Kategori: asset.category,
      Kondisi: CONDITION_LABELS[asset.condition],
      Lifecycle: LIFECYCLE_LABELS[asset.lifecycleStatus],
      Lab: labs.find((lab) => lab.id === asset.homeLaboratoryId)?.name ?? '',
      Device: asset.linkedDeviceId ?? '',
      Harga: asset.purchasePrice ?? '',
    })));
  }

  const columns: Column<AssetDto>[] = [
    { key: 'assetCode', header: 'Kode Aset', sortable: true, render: (asset) => <span className="font-medium text-ink-primary">{asset.assetCode}</span> },
    { key: 'name', header: 'Nama', sortable: true, render: (asset) => <button onClick={() => navigate(`/assets/${asset.id}`)} className="text-accent-content hover:underline">{asset.name}</button> },
    { key: 'category', header: 'Kategori', sortable: true },
    { key: 'lab', header: 'Home Lab', render: (asset) => labs.find((lab) => lab.id === asset.homeLaboratoryId)?.name ?? 'Belum ditetapkan' },
    { key: 'condition', header: 'Kondisi', render: (asset) => <Badge tone={conditionTone(asset.condition)}>{CONDITION_LABELS[asset.condition]}</Badge> },
    { key: 'lifecycle', header: 'Lifecycle', render: (asset) => <Badge tone={lifecycleTone(asset.lifecycleStatus)}>{LIFECYCLE_LABELS[asset.lifecycleStatus]}</Badge> },
    { key: 'device', header: 'Device', render: (asset) => asset.linkedDeviceId ? <Badge tone="accent">Tertaut</Badge> : <Badge tone="muted">Tidak tertaut</Badge> },
    { key: 'actions', header: 'Aksi', printHidden: true, render: (asset) => (
      <div className="flex flex-wrap gap-1">
        {canUpdate && asset.lifecycleStatus !== 'disposed' && <button title="Edit" onClick={() => openEdit(asset)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
        {canLinkDevice && asset.lifecycleStatus === 'active' && asset.linkedDeviceId === null && <button title="Tautkan Device" onClick={() => void openLink(asset)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-accent-content"><Link2 className="h-4 w-4" /></button>}
        {hasServerPermission(user, 'assets.link-device') && asset.linkedDeviceId !== null && <button title="Lepas Device" onClick={() => { setReason(''); setUnlinking(asset); }} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-warning-foreground"><Unlink className="h-4 w-4" /></button>}
        {canRetire && asset.lifecycleStatus === 'active' && <button title="Pensiunkan" onClick={() => { setReason(''); setRetiring(asset); }} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-warning-foreground"><Archive className="h-4 w-4" /></button>}
        {canDispose && asset.lifecycleStatus === 'retired' && <button title="Hapuskan administratif" onClick={() => { setReason(''); setDisposing(asset); }} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Archive className="h-4 w-4" /></button>}
      </div>
    ) },
  ];

  if (loading) return <Card><CardContent><p className="text-sm text-ink-muted">Memuat Asset canonical...</p></CardContent></Card>;
  if (loadError) return <EmptyState title="Asset tidak dapat dimuat" description={loadError} action={<Button onClick={() => void load()}>Coba Lagi</Button>} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aset Tetap"
        description="Aset Tetap sekarang membaca source canonical Laravel/PostgreSQL. Tidak ada lagi mutation Asset browser-local."
        icon={<Boxes className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Asset</Button>}
        </>}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{assets.length}</p><p className="text-xs text-ink-muted">Total Asset</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{assets.filter((a) => a.condition === 'good').length}</p><p className="text-xs text-ink-muted">Kondisi Baik</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{linkedCount}</p><p className="text-xs text-ink-muted">Tertaut Device</p></CardContent></Card>
        <Card><CardContent><p className="text-xl font-bold text-ink-primary">{formatCurrency(totalValue)}</p><p className="text-xs text-ink-muted">Nilai Snapshot</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select label="Home Lab" value={filters.lab} onChange={(event) => setFilters({ ...filters, lab: event.target.value })} options={[{ value: 'all', label: 'Semua' }, ...labs.map((lab) => ({ value: lab.id, label: lab.name }))]} />
          <Select label="Kondisi" value={filters.condition} onChange={(event) => setFilters({ ...filters, condition: event.target.value })} options={[{ value: 'all', label: 'Semua' }, ...ASSET_CONDITIONS.map((condition) => ({ value: condition, label: CONDITION_LABELS[condition] }))]} />
          <Select label="Lifecycle" value={filters.lifecycle} onChange={(event) => setFilters({ ...filters, lifecycle: event.target.value })} options={[{ value: 'all', label: 'Semua' }, ...Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))]} />
        </CardContent>
      </Card>

      <Card><DataTable columns={columns} data={filtered} rowKey={(asset) => asset.id} searchable searchKeys={(asset) => `${asset.assetCode} ${asset.name} ${asset.category} ${asset.brand ?? ''} ${asset.serialNumber ?? ''}`} /></Card>

      <FormDialog open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit Asset' : 'Tambah Asset'} onSubmit={() => void save()} size="lg">
        <div className="space-y-4">
          {editing?.linkedDeviceId && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">Asset tertaut Device: home Laboratory, brand, model, dan serial dikunci untuk mencegah identity drift.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Kode Asset" value={form.assetCode} disabled={Boolean(editing)} onChange={(event) => setForm({ ...form, assetCode: event.target.value })} />
            <Input label="Nama" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Input label="Kategori" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            <Input label="Brand" value={form.brand} disabled={Boolean(editing?.linkedDeviceId)} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
            <Input label="Model" value={form.model} disabled={Boolean(editing?.linkedDeviceId)} onChange={(event) => setForm({ ...form, model: event.target.value })} />
            <Input label="Serial Number" value={form.serialNumber} disabled={Boolean(editing?.linkedDeviceId)} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} />
            <Select label="Home Laboratory" value={form.homeLaboratoryId} disabled={Boolean(editing?.linkedDeviceId)} onChange={(event) => setForm({ ...form, homeLaboratoryId: event.target.value })} options={[{ value: '', label: 'Belum ditetapkan' }, ...labs.filter((lab) => lab.status === 'active').map((lab) => ({ value: lab.id, label: lab.name }))]} />
            <Select label="Kondisi" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value as AssetCondition })} options={ASSET_CONDITIONS.map((condition) => ({ value: condition, label: CONDITION_LABELS[condition] }))} />
            <Input label="Tanggal Perolehan" type="date" value={form.acquisitionDate} onChange={(event) => setForm({ ...form, acquisitionDate: event.target.value })} />
            <Input label="Tahun Perolehan" type="number" value={form.acquisitionYear} onChange={(event) => setForm({ ...form, acquisitionYear: event.target.value })} />
            <Input label="Harga Snapshot" type="number" min="0" value={form.purchasePrice} onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })} />
            <Input label="Sumber Dana" value={form.fundingSource} onChange={(event) => setForm({ ...form, fundingSource: event.target.value })} />
            <Input label="Supplier" value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} />
            <Input label="Garansi Sampai" type="date" value={form.warrantyUntil} onChange={(event) => setForm({ ...form, warrantyUntil: event.target.value })} />
            <div className="sm:col-span-2"><Textarea label="Catatan" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
          </div>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(linking)} onClose={() => setLinking(null)} title="Tautkan Device canonical" onSubmit={() => void linkDevice()} submitLabel="Tautkan" size="md">
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">Tautan bersifat 1:1 dan divalidasi lagi oleh server. Asset/Device lintas School atau home Laboratory yang bertentangan akan ditolak.</p>
          <Select label="Device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} options={[{ value: '', label: 'Pilih Device' }, ...linkCandidates.map((device) => ({ value: device.id, label: `${device.deviceCode} · ${device.brand ?? ''} ${device.model ?? ''}`.trim() }))]} />
        </div>
      </FormDialog>

      <ReasonDialog asset={unlinking} title="Lepas tautan Device" reason={reason} setReason={setReason} onClose={() => setUnlinking(null)} onSubmit={() => void runReasonAction('unlink')} />
      <ReasonDialog asset={retiring} title="Pensiunkan Asset" reason={reason} setReason={setReason} onClose={() => setRetiring(null)} onSubmit={() => void runReasonAction('retire')} />
      <ReasonDialog asset={disposing} title="Hapuskan Asset secara administratif" reason={reason} setReason={setReason} onClose={() => setDisposing(null)} onSubmit={() => void runReasonAction('dispose')} />
    </div>
  );
}

function ReasonDialog({ asset, title, reason, setReason, onClose, onSubmit }: {
  asset: AssetDto | null;
  title: string;
  reason: string;
  setReason: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <FormDialog open={Boolean(asset)} onClose={onClose} title={title} description={asset?.assetCode} onSubmit={onSubmit} submitLabel="Konfirmasi" size="md">
      <Textarea label="Alasan" value={reason} onChange={(event) => setReason(event.target.value)} />
    </FormDialog>
  );
}

export function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [asset, setAsset] = useState<AssetDto | null>(null);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [device, setDevice] = useState<DeviceDto | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const [nextAsset, nextLabs] = await Promise.all([assetGateway.show(id), laboratoryGateway.list()]);
        setAsset(nextAsset);
        setLabs(nextLabs);
        if (nextAsset.linkedDeviceId && hasServerPermission(user, 'devices.view')) {
          try {
            setDevice(await deviceGateway.show(nextAsset.linkedDeviceId));
          } catch {
            setDevice(null);
          }
        }
      } catch (reason) {
        setError(messageFrom(reason));
      }
    })();
  }, [id, user]);

  if (error) return <EmptyState title="Asset tidak dapat dimuat" description={error} action={<Button onClick={() => navigate('/assets')}>Kembali</Button>} />;
  if (!asset) return <Card><CardContent><p className="text-sm text-ink-muted">Memuat Asset...</p></CardContent></Card>;

  const labName = labs.find((lab) => lab.id === asset.homeLaboratoryId)?.name ?? 'Belum ditetapkan';

  return (
    <div className="space-y-6">
      <PageHeader title={asset.name} description={asset.assetCode} icon={<Boxes className="h-5 w-5" />} actions={<Button variant="secondary" size="sm" onClick={() => navigate('/assets')}>Kembali</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardContent className="space-y-3 text-sm">
          <Detail label="Kategori" value={asset.category} />
          <Detail label="Kondisi" value={CONDITION_LABELS[asset.condition]} />
          <Detail label="Lifecycle" value={LIFECYCLE_LABELS[asset.lifecycleStatus]} />
          <Detail label="Home Laboratory" value={labName} />
          <Detail label="Brand / Model" value={[asset.brand, asset.model].filter(Boolean).join(' ') || '-'} />
          <Detail label="Serial Number" value={asset.serialNumber ?? '-'} />
          <Detail label="Versi" value={String(asset.version)} />
        </CardContent></Card>
        <Card><CardContent className="space-y-3 text-sm">
          <Detail label="Tanggal Perolehan" value={asset.acquisitionDate ?? '-'} />
          <Detail label="Tahun Perolehan" value={asset.acquisitionYear === null ? '-' : String(asset.acquisitionYear)} />
          <Detail label="Harga Snapshot" value={asset.purchasePrice === null ? '-' : formatCurrency(asset.purchasePrice)} />
          <Detail label="Sumber Dana" value={asset.fundingSource ?? '-'} />
          <Detail label="Supplier" value={asset.supplierName ?? '-'} />
          <Detail label="Garansi" value={asset.warrantyUntil ?? '-'} />
        </CardContent></Card>
      </div>
      <Card><CardContent>
        <h3 className="text-sm font-semibold text-ink-primary">Device canonical</h3>
        {asset.linkedDeviceId ? (
          <div className="mt-2 text-sm">
            <p className="text-ink-secondary">{device ? `${device.deviceCode} · ${device.deviceType}` : asset.linkedDeviceId}</p>
            {device && <button className="mt-2 text-accent-content hover:underline" onClick={() => navigate(`/devices/${device.id}`)}>Buka Device</button>}
          </div>
        ) : <p className="mt-2 text-sm text-ink-muted">Belum tertaut ke Device.</p>}
      </CardContent></Card>
      <Card><CardContent>
        <h3 className="text-sm font-semibold text-ink-primary">Batas riwayat lintas domain</h3>
        <p className="mt-2 text-sm text-ink-muted">Incident, Preventive Maintenance, Loan, dan audit-query lintas domain tidak digabungkan dari AppData browser. Riwayat akan muncul di sini hanya setelah source canonical masing-masing tersedia.</p>
        {asset.notes && <p className="mt-4 whitespace-pre-wrap text-sm text-ink-secondary">{asset.notes}</p>}
      </CardContent></Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><span className="text-ink-muted">{label}</span><span className="text-right text-ink-primary">{value}</span></div>;
}
