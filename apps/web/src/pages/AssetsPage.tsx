import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Boxes, Plus, Pencil, Trash2, Download, Printer, ArrowRightLeft, ScanLine, QrCode } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge, ConditionBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV, formatCurrency } from '@/utils';
import type { Asset } from '@/types';

export function AssetsPage() {
  const { db, mutate } = useAppData();
  const navigate = useNavigate();
  const canCreate = usePermission('assets', 'create');
  const canUpdate = usePermission('assets', 'update');
  const canDelete = usePermission('assets', 'delete');
  const canExport = usePermission('assets', 'export');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [confirmDel, setConfirmDel] = useState<Asset | null>(null);
  const [transferOpen, setTransferOpen] = useState<Asset | null>(null);
  const [opnameOpen, setOpnameOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState<Asset | null>(null);
  const [form, setForm] = useState<Partial<Asset>>({});
  const [transferForm, setTransferForm] = useState({ toLabId: '', toPosition: '', reason: '', by: '' });
  const [filters, setFilters] = useState({ category: 'all', lab: 'all', condition: 'all', status: 'all' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => db.assets.filter((a) => {
    if (filters.category !== 'all' && a.category !== filters.category) return false;
    if (filters.lab !== 'all' && a.laboratoryId !== filters.lab) return false;
    if (filters.condition !== 'all' && a.condition !== filters.condition) return false;
    if (filters.status !== 'all' && a.status !== filters.status) return false;
    return true;
  }), [db.assets, filters]);

  const categories = [...new Set(db.assets.map((a) => a.category))];
  const totalValue = db.assets.reduce((sum, a) => sum + a.price, 0);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ category: 'Komputer', condition: 'Baik', status: 'Aktif', yearAcquired: 2026, fundingSource: 'BOS', price: 0, purchaseDate: new Date().toISOString().split('T')[0], laboratoryId: db.labs[0]?.id });
    setOpen(true);
  }
  function openEdit(a: Asset) {
    if (!canUpdate) return;
    setEditing(a);
    setForm(a);
    setOpen(true);
  }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.name || !form.assetCode) { toast('Nama dan kode aset wajib diisi', 'error'); return; }
    mutate((d) => {
      if (editing) {
        const idx = d.assets.findIndex((a) => a.id === editing.id);
        if (idx >= 0) d.assets[idx] = { ...d.assets[idx], ...form } as Asset;
      } else {
        d.assets.push({ ...form, id: `ast-${Date.now()}` } as Asset);
      }
    });
    toast(editing ? 'Aset diperbarui' : 'Aset ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.assets = d.assets.filter((a) => a.id !== confirmDel.id); });
    toast('Aset dihapus', 'success');
    setConfirmDel(null);
  }

  function doTransfer() {
    if (!canUpdate) return;
    if (!transferOpen || !transferForm.toLabId) { toast('Pilih lokasi tujuan', 'error'); return; }
    mutate((d) => {
      const idx = d.assets.findIndex((a) => a.id === transferOpen.id);
      if (idx >= 0) {
        d.assets[idx].laboratoryId = transferForm.toLabId;
        d.assets[idx].position = transferForm.toPosition;
        d.auditLogs.unshift({
          id: `al-${Date.now()}`, at: new Date().toISOString(), userName: transferForm.by || 'Admin', role: 'Admin Lab', module: 'assets', action: 'transfer', object: transferOpen.assetCode,
          oldValue: transferOpen.laboratoryId, newValue: transferForm.toLabId, device: 'Web',
        });
      }
    });
    toast('Mutasi aset berhasil', 'success');
    setTransferOpen(null);
    setTransferForm({ toLabId: '', toPosition: '', reason: '', by: '' });
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('aset-tetap.csv', filtered.map((a) => ({
      Kode: a.assetCode, Nama: a.name, Kategori: a.category, Brand: a.brand, Serial: a.serialNumber, Lab: db.labs.find((l) => l.id === a.laboratoryId)?.name, Posisi: a.position, Kondisi: a.condition, Status: a.status, Harga: a.price,
    })));
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: Column<Asset>[] = [
    { key: 'select', header: '', render: (a) => <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} className="rounded border-base-600" />, width: '40px' },
    { key: 'assetCode', header: 'Kode Aset', sortable: true, render: (a) => <span className="font-medium text-ink-primary">{a.assetCode}</span> },
    { key: 'name', header: 'Nama', sortable: true, render: (a) => <button onClick={() => navigate(`/assets/${a.id}`)} className="text-accent-blue hover:underline">{a.name}</button> },
    { key: 'category', header: 'Kategori', sortable: true },
    { key: 'lab', header: 'Lab', render: (a) => db.labs.find((l) => l.id === a.laboratoryId)?.name ?? '-' },
    { key: 'condition', header: 'Kondisi', render: (a) => <ConditionBadge condition={a.condition} /> },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    { key: 'price', header: 'Harga', sortable: true, sortValue: (a) => a.price, render: (a) => <span className="text-ink-muted">{formatCurrency(a.price)}</span> },
    { key: 'actions', header: 'Aksi', render: (a) => (
      <div className="flex gap-1">
        <button onClick={() => navigate(`/assets/${a.id}`)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><QrCode className="h-4 w-4" /></button>
        {canUpdate && <button onClick={() => openEdit(a)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
        {canUpdate && <button onClick={() => { setTransferOpen(a); setTransferForm({ toLabId: '', toPosition: '', reason: '', by: '' }); }} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><ArrowRightLeft className="h-4 w-4" /></button>}
        {canDelete && <button onClick={() => setConfirmDel(a)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
      </div>
    ) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aset Tetap"
        description="Kelola identitas, kondisi, lokasi, dan riwayat aset tetap laboratorium."
        icon={<Boxes className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<ScanLine className="h-4 w-4" />} onClick={() => setOpnameOpen(true)}>Stock Opname</Button>
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canExport && <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Aset</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-blue">{db.assets.length}</p><p className="text-xs text-ink-muted">Total Aset</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-emerald-400">{db.assets.filter((a) => a.condition === 'Baik').length}</p><p className="text-xs text-ink-muted">Kondisi Baik</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-amber-400">{db.assets.filter((a) => a.status === 'Maintenance').length}</p><p className="text-xs text-ink-muted">Maintenance</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{formatCurrency(totalValue)}</p><p className="text-xs text-ink-muted">Nilai Total</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select label="Kategori" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} placeholder="Semua" options={categories.map((c) => ({ value: c, label: c }))} />
          <Select label="Lab" value={filters.lab} onChange={(e) => setFilters({ ...filters, lab: e.target.value })} placeholder="Semua" options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Select label="Kondisi" value={filters.condition} onChange={(e) => setFilters({ ...filters, condition: e.target.value })} placeholder="Semua" options={['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'].map((c) => ({ value: c, label: c }))} />
          <Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} placeholder="Semua" options={['Aktif', 'Cadangan', 'Dipinjam', 'Maintenance', 'Rusak', 'Hilang', 'Dihapuskan'].map((s) => ({ value: s, label: s }))} />
          {selected.size > 0 && <Badge tone="accent">{selected.size} dipilih</Badge>}
        </CardContent>
      </Card>

      <Card>
        <DataTable columns={columns} data={filtered} rowKey={(a) => a.id} searchable searchKeys={(a) => `${a.assetCode} ${a.name} ${a.serialNumber} ${a.brand}`} />
      </Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Aset' : 'Tambah Aset'} onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Kode Aset" value={form.assetCode ?? ''} onChange={(e) => setForm({ ...form, assetCode: e.target.value })} />
          <Input label="Nama" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Kategori" value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label="Brand" value={form.brand ?? ''} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
          <Input label="Model" value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <Input label="Serial Number" value={form.serialNumber ?? ''} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
          <Select label="Lab" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Posisi" value={form.position ?? ''} onChange={(e) => setForm({ ...form, position: e.target.value })} />
          <Select label="Kondisi" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as Asset['condition'] })} options={['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'].map((c) => ({ value: c, label: c }))} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Asset['status'] })} options={['Aktif', 'Cadangan', 'Dipinjam', 'Maintenance', 'Rusak', 'Hilang', 'Dihapuskan'].map((s) => ({ value: s, label: s }))} />
          <Input label="Tahun Perolehan" type="number" value={form.yearAcquired ?? 2026} onChange={(e) => setForm({ ...form, yearAcquired: Number(e.target.value) })} />
          <Input label="Harga" type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
          <Input label="Tanggal Pembelian" type="date" value={form.purchaseDate ?? ''} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
          <Input label="Garansi Sampai" type="date" value={form.warrantyUntil ?? ''} onChange={(e) => setForm({ ...form, warrantyUntil: e.target.value })} />
          <Input label="Supplier" value={form.supplier ?? ''} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          <Input label="Sumber Dana" value={form.fundingSource ?? ''} onChange={(e) => setForm({ ...form, fundingSource: e.target.value })} />
          <div className="sm:col-span-2"><Textarea label="Catatan" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(transferOpen)} onClose={() => setTransferOpen(null)} title="Mutasi Aset" description={transferOpen?.assetCode} onSubmit={doTransfer} size="md" submitLabel="Mutasi">
        <div className="space-y-4">
          <div className="rounded-lg border border-base-700 bg-base-800/60 p-3 text-sm">
            <p className="text-ink-muted">Lokasi saat ini</p>
            <p className="text-ink-primary">{db.labs.find((l) => l.id === transferOpen?.laboratoryId)?.name} · {transferOpen?.position}</p>
          </div>
          <Select label="Lab Tujuan" value={transferForm.toLabId} onChange={(e) => setTransferForm({ ...transferForm, toLabId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Posisi Tujuan" value={transferForm.toPosition} onChange={(e) => setTransferForm({ ...transferForm, toPosition: e.target.value })} />
          <Input label="Penanggung Jawab" value={transferForm.by} onChange={(e) => setTransferForm({ ...transferForm, by: e.target.value })} />
          <Textarea label="Alasan Mutasi" value={transferForm.reason} onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })} />
        </div>
      </FormDialog>

      <Modal open={opnameOpen} onClose={() => setOpnameOpen(false)} title="Stock Opname" description="Simulasi scan QR untuk mengecek keberadaan aset" size="md">
        <OpnameSimulator assets={db.assets} labs={db.labs} onComplete={() => setOpnameOpen(false)} />
      </Modal>

      <Modal open={Boolean(qrOpen)} onClose={() => setQrOpen(null)} title="QR Code Aset" size="sm">
        {qrOpen && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-48 w-48 items-center justify-center rounded-xl border-2 border-base-600 bg-white p-4">
              <div className="grid grid-cols-8 gap-0.5">
                {Array.from({ length: 64 }).map((_, i) => (
                  <div key={i} className={`h-4 w-4 ${((i * 7 + i * 3) % 3 === 0) ? 'bg-black' : 'bg-white'}`} />
                ))}
              </div>
            </div>
            <p className="font-semibold text-ink-primary">{qrOpen.assetCode}</p>
            <p className="text-sm text-ink-muted">{qrOpen.name}</p>
            {canExport && <Button variant="secondary" size="sm" className="mt-4" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print Label</Button>}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus aset ${confirmDel?.assetCode}?`} confirmLabel="Hapus" />
    </div>
  );
}

function OpnameSimulator({ assets, labs, onComplete }: { assets: Asset[]; labs: { id: string; name: string }[]; onComplete: () => void }) {
  const [scanInput, setScanInput] = useState('');
  const [found, setFound] = useState<Set<string>>(new Set());
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [selectedLab, setSelectedLab] = useState(labs[0]?.id ?? '');

  const labAssets = assets.filter((a) => a.laboratoryId === selectedLab);

  function scan() {
    const asset = labAssets.find((a) => a.assetCode.toLowerCase() === scanInput.toLowerCase() || a.serialNumber.toLowerCase() === scanInput.toLowerCase());
    if (asset) {
      setFound((s) => new Set(s).add(asset.id));
      toast(`${asset.assetCode} ditemukan`, 'success');
    } else {
      toast('Aset tidak ditemukan', 'error');
    }
    setScanInput('');
  }

  function markMissing(id: string) {
    setMissing((s) => new Set(s).add(id));
  }

  return (
    <div className="space-y-4">
      <Select label="Pilih Lab" value={selectedLab} onChange={(e) => { setSelectedLab(e.target.value); setFound(new Set()); setMissing(new Set()); }} options={labs.map((l) => ({ value: l.id, label: l.name }))} />
      <div className="flex gap-2">
        <Input placeholder="Scan kode aset..." value={scanInput} onChange={(e) => setScanInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan()} icon={<ScanLine className="h-4 w-4" />} />
        <Button onClick={scan}>Scan</Button>
      </div>
      <div className="rounded-lg border border-base-700 bg-base-800/60 p-3 max-h-60 overflow-y-auto">
        {labAssets.map((a) => (
          <div key={a.id} className="flex items-center justify-between border-b border-base-700/40 py-2 text-sm last:border-0">
            <span className="text-ink-secondary">{a.assetCode} · {a.name}</span>
            {found.has(a.id) ? <Badge tone="success">Ditemukan</Badge> : missing.has(a.id) ? <Badge tone="danger">Tidak Ditemukan</Badge> : <button onClick={() => markMissing(a.id)} className="text-xs text-ink-muted hover:text-danger">Tandai hilang</button>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-muted">Ditemukan: <span className="text-emerald-400 font-semibold">{found.size}</span> / {labAssets.length}</span>
        <Button size="sm" onClick={() => { toast(`Opname selesai: ${found.size}/${labAssets.length} ditemukan`, 'success'); onComplete(); }}>Selesai</Button>
      </div>
    </div>
  );
}

export function AssetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { db } = useAppData();
  const asset = db.assets.find((a) => a.id === id);
  const [tab, setTab] = useState('overview');

  if (!asset) return <EmptyState title="Aset tidak ditemukan" action={<Button onClick={() => navigate('/assets')}>Kembali</Button>} />;

  const incidents = db.incidents.filter((i) => i.assetCode === asset.assetCode);
  const maintenance = db.maintenance.executions.filter((m) => m.assetCode === asset.assetCode);
  const auditLogs = db.auditLogs.filter((a) => a.object === asset.assetCode);

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'spec', label: 'Spesifikasi' },
    { key: 'incidents', label: `Incident (${incidents.length})` },
    { key: 'maintenance', label: `Maintenance (${maintenance.length})` },
    { key: 'audit', label: `Audit (${auditLogs.length})` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={asset.name} description={`${asset.assetCode} · ${asset.brand} ${asset.model}`} icon={<Boxes className="h-5 w-5" />} actions={<Button variant="secondary" size="sm" onClick={() => navigate('/assets')}>Kembali</Button>} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card><CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-ink-muted">Kategori</span><span className="text-ink-primary">{asset.category}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Brand</span><span className="text-ink-primary">{asset.brand}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Serial</span><span className="text-ink-primary">{asset.serialNumber}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Lab</span><span className="text-ink-primary">{db.labs.find((l) => l.id === asset.laboratoryId)?.name}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Posisi</span><span className="text-ink-primary">{asset.position}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Kondisi</span><ConditionBadge condition={asset.condition} /></div>
            <div className="flex justify-between"><span className="text-ink-muted">Status</span><StatusBadge status={asset.status} /></div>
            <div className="flex justify-between"><span className="text-ink-muted">Harga</span><span className="text-ink-primary">{formatCurrency(asset.price)}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Tahun</span><span className="text-ink-primary">{asset.yearAcquired}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Sumber Dana</span><span className="text-ink-primary">{asset.fundingSource}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Supplier</span><span className="text-ink-primary">{asset.supplier}</span></div>
            <div className="flex justify-between"><span className="text-ink-muted">Garansi</span><span className="text-ink-primary">{asset.warrantyUntil || '-'}</span></div>
          </CardContent></Card>
        </div>
      )}
      {tab === 'spec' && (
        <Card><CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-ink-muted">Model</span><span className="text-ink-primary">{asset.model}</span></div>
          {asset.notes && <div><span className="text-ink-muted">Catatan</span><p className="mt-1 text-ink-secondary">{asset.notes}</p></div>}
        </CardContent></Card>
      )}
      {tab === 'incidents' && (
        <Card>{incidents.length === 0 ? <EmptyState title="Tidak ada incident" /> : <CardContent className="space-y-2">{incidents.map((i) => <div key={i.id} className="rounded-lg border border-base-700/60 p-3"><div className="flex justify-between"><span className="font-medium text-ink-primary">{i.ticketNumber}</span><StatusBadge status={i.status} /></div><p className="mt-1 text-sm text-ink-muted">{i.title}</p></div>)}</CardContent>}</Card>
      )}
      {tab === 'maintenance' && (
        <Card>{maintenance.length === 0 ? <EmptyState title="Tidak ada maintenance" /> : <CardContent className="space-y-2">{maintenance.map((m) => <div key={m.id} className="rounded-lg border border-base-700/60 p-3"><p className="font-medium text-ink-primary">{m.date}</p><p className="text-sm text-ink-muted">{m.findings}</p></div>)}</CardContent>}</Card>
      )}
      {tab === 'audit' && (
        <Card>{auditLogs.length === 0 ? <EmptyState title="Tidak ada audit log" /> : <CardContent className="space-y-2">{auditLogs.map((a) => <div key={a.id} className="rounded-lg border border-base-700/60 p-3"><div className="flex justify-between"><span className="text-sm text-ink-primary">{a.action}</span><span className="text-xs text-ink-muted">{a.at}</span></div><p className="text-xs text-ink-muted">{a.userName} · {a.oldValue} → {a.newValue}</p></div>)}</CardContent>}</Card>
      )}
    </div>
  );
}
