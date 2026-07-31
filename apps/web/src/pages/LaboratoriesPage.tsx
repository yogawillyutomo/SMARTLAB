import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FlaskConical,
  Plus,
  Map as MapIcon,
  Monitor,
  Pencil,
  Power,
  Eye,
  Users,
  Activity,
} from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge, ConditionBadge } from '@/components/ui/Badge';
import { Input, Select } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { usePermission } from '@/components/common/PermissionGuard';
import { toast } from '@/stores/toastStore';
import { cn } from '@/utils';
import type { Laboratory, Device } from '@/types';

export function LaboratoriesPage() {
  const { db, mutate } = useAppData();
  const canCreate = usePermission('laboratories', 'create');
  const canUpdate = usePermission('laboratories', 'update');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Laboratory | null>(null);
  const [confirmDel, setConfirmDel] = useState<Laboratory | null>(null);
  const [form, setForm] = useState<Partial<Laboratory>>({});

  function openCreate() {
    setEditing(null);
    setForm({ name: '', code: '', location: '', capacity: 36, headName: '', technicianName: '', pcCount: 36, layoutRows: 6, layoutCols: 6, status: 'active' });
    setOpen(true);
  }
  function openEdit(lab: Laboratory) {
    setEditing(lab);
    setForm(lab);
    setOpen(true);
  }
  function save() {
    if (!form.name || !form.code) {
      toast('Nama dan kode laboratorium wajib diisi', 'error');
      return;
    }
    mutate((d) => {
      if (editing) {
        const idx = d.labs.findIndex((l) => l.id === editing.id);
        if (idx >= 0) d.labs[idx] = { ...d.labs[idx], ...form };
      } else {
        const id = `lab-${Date.now()}`;
        d.labs.push({ ...form, id } as Laboratory);
        // Generate devices for the new lab
        const cols = form.layoutCols ?? 6;
        const rows = form.layoutRows ?? 6;
        const count = form.pcCount ?? cols * rows;
        for (let i = 0; i < count; i++) {
          const n = i + 1;
          d.devices.push({
            id: `dev-${form.code}-${String(n).padStart(2, '0')}`,
            positionCode: `PC-${String(n).padStart(2, '0')}`,
            hostname: `PC-${form.code}-${String(n).padStart(2, '0')}`,
            laboratoryId: id,
            assetCode: `AST-${form.code}-${String(n).padStart(3, '0')}`,
            ipAddress: `10.10.99.${n}`,
            macAddress: `02:00:99:${String(n).padStart(2, '0')}:${String(n + 1).padStart(2, '0')}:${String(n + 2).padStart(2, '0')}`,
            serialNumber: `SN${form.code}${String(n).padStart(3, '0')}2026`,
            brand: 'Dell',
            model: 'OptiPlex 7090',
            yearAcquired: 2026,
            processor: 'Intel Core i5-11400',
            ramGB: 16,
            storageGB: 512,
            gpu: 'Intel UHD Graphics 730',
            monitor: 'Dell 24"',
            os: 'Windows 11 Pro',
            status: 'Offline',
            cpuUsage: 0,
            ramUsage: 0,
            diskUsage: 40,
            temperature: 45,
            uptimeHours: 0,
            network: 'Disconnected',
            lastHeartbeat: new Date().toISOString(),
            peripherals: { monitor: true, keyboard: true, mouse: true, headset: false, network: false, ups: false },
            col: (i % cols) + 1,
            row: Math.floor(i / cols) + 1,
          });
        }
      }
    });
    toast(editing ? 'Laboratorium diperbarui' : 'Laboratorium ditambahkan', 'success');
    setOpen(false);
  }
  function toggleStatus(lab: Laboratory) {
    mutate((d) => {
      const idx = d.labs.findIndex((l) => l.id === lab.id);
      if (idx >= 0) d.labs[idx].status = d.labs[idx].status === 'active' ? 'inactive' : 'active';
    });
    toast(`Laboratorium ${lab.status === 'active' ? 'dinonaktifkan' : 'diaktifkan'}`, 'success');
  }
  function remove() {
    if (!confirmDel) return;
    mutate((d) => {
      d.labs = d.labs.filter((l) => l.id !== confirmDel.id);
      d.devices = d.devices.filter((dv) => dv.laboratoryId !== confirmDel.id);
    });
    toast('Laboratorium dihapus', 'success');
    setConfirmDel(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laboratorium"
        description="Kelola laboratorium dan denah tata letak perangkat"
        icon={<FlaskConical className="h-5 w-5" />}
        actions={canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Lab</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {db.labs.map((lab) => {
          const devices = db.devices.filter((d) => d.laboratoryId === lab.id);
          const online = devices.filter((d) => d.status === 'Online').length;
          const problem = devices.filter((d) => ['Critical', 'Warning', 'Offline'].includes(d.status)).length;
          const inUse = db.sessions.some((s) => s.laboratoryId === lab.id && s.status === 'Berlangsung');
          return (
            <Card key={lab.id} hover>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-primary">
                        <FlaskConical className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-ink-primary">{lab.name}</p>
                        <p className="text-xs text-ink-muted">{lab.code} · {lab.location}</p>
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={lab.status} />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-base-700/40 p-2">
                    <p className="text-sm font-bold text-ink-primary">{devices.length}</p>
                    <p className="text-[10px] text-ink-muted">Total PC</p>
                  </div>
                  <div className="rounded-lg bg-success/10 p-2">
                    <p className="text-sm font-bold text-success-foreground">{online}</p>
                    <p className="text-[10px] text-ink-muted">Online</p>
                  </div>
                  <div className="rounded-lg bg-warning/10 p-2">
                    <p className="text-sm font-bold text-warning-foreground">{problem}</p>
                    <p className="text-[10px] text-ink-muted">Bermasalah</p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-ink-muted">
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Kepala Lab</span><span className="text-ink-secondary">{lab.headName}</span></div>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" />Teknisi</span><span className="text-ink-secondary">{lab.technicianName}</span></div>
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" />Kapasitas</span><span className="text-ink-secondary">{lab.capacity} orang</span></div>
                  <div className="flex items-center justify-between"><span>Status</span>{inUse ? <Badge tone="success">Sedang Dipakai</Badge> : <Badge tone="muted">Idle</Badge>}</div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-base-700/60">
                  <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} className="flex-1" onClick={() => (window.location.href = `/laboratories/${lab.id}`)}>Detail</Button>
                  <Button variant="secondary" size="sm" icon={<MapIcon className="h-3.5 w-3.5" />} onClick={() => (window.location.href = `/laboratories/${lab.id}/layout`)}>Denah</Button>
                  <Button variant="secondary" size="sm" icon={<Monitor className="h-3.5 w-3.5" />} onClick={() => (window.location.href = `/monitoring`)}>Monitor</Button>
                  {canUpdate && (
                    <>
                      <Button variant="ghost" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(lab)} />
                      <Button variant="ghost" size="sm" icon={<Power className="h-3.5 w-3.5" />} onClick={() => toggleStatus(lab)} />
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Edit Laboratorium' : 'Tambah Laboratorium'}
        onSubmit={save}
        submitLabel={editing ? 'Perbarui' : 'Simpan'}
        size="lg"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nama Laboratorium" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Kode" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          <Input label="Lokasi" value={form.location ?? ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Input label="Kapasitas (orang)" type="number" value={form.capacity ?? 0} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
          <Input label="Kepala Lab" value={form.headName ?? ''} onChange={(e) => setForm({ ...form, headName: e.target.value })} />
          <Input label="Teknisi" value={form.technicianName ?? ''} onChange={(e) => setForm({ ...form, technicianName: e.target.value })} />
          <Input label="Jumlah PC" type="number" value={form.pcCount ?? 0} onChange={(e) => setForm({ ...form, pcCount: Number(e.target.value) })} />
          <Input label="Baris Denah" type="number" value={form.layoutRows ?? 6} onChange={(e) => setForm({ ...form, layoutRows: Number(e.target.value) })} />
          <Input label="Kolom Denah" type="number" value={form.layoutCols ?? 6} onChange={(e) => setForm({ ...form, layoutCols: Number(e.target.value) })} />
          <Select label="Status" value={form.status ?? 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as Laboratory['status'] })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
        </div>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus laboratorium "${confirmDel?.name}"? Semua data PC di lab ini juga akan dihapus.`} confirmLabel="Hapus" />
    </div>
  );
}

export function LaboratoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { db } = useAppData();
  const lab = db.labs.find((l) => l.id === id);
  const [tab, setTab] = useState('overview');

  if (!lab) return <EmptyState title="Laboratorium tidak ditemukan" action={<Button onClick={() => navigate('/laboratories')}>Kembali</Button>} />;

  const devices = db.devices.filter((d) => d.laboratoryId === lab.id);
  const assets = db.assets.filter((a) => a.laboratoryId === lab.id);
  const schedules = db.schedules.filter((s) => s.laboratoryId === lab.id);
  const journals = db.journals.filter((j) => j.laboratoryId === lab.id);
  const maintenance = db.maintenance.executions.filter((m) => m.laboratoryId === lab.id);
  const auditLogs = db.auditLogs.filter((a) => a.module === 'laboratories');

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'devices', label: `Perangkat (${devices.length})` },
    { key: 'inventory', label: `Inventaris (${assets.length})` },
    { key: 'schedules', label: `Jadwal (${schedules.length})` },
    { key: 'journals', label: `Jurnal (${journals.length})` },
    { key: 'maintenance', label: `Maintenance (${maintenance.length})` },
    { key: 'activity', label: 'Aktivitas' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={lab.name}
        description={`${lab.code} · ${lab.location}`}
        icon={<FlaskConical className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<MapIcon className="h-4 w-4" />} onClick={() => navigate(`/laboratories/${lab.id}/layout`)}>Denah</Button>
            <Button variant="secondary" size="sm" icon={<Monitor className="h-4 w-4" />} onClick={() => navigate('/monitoring')}>Monitoring</Button>
          </>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent><p className="text-2xl font-bold text-accent-primary">{devices.length}</p><p className="text-xs text-ink-muted">Total Perangkat</p></CardContent></Card>
          <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{devices.filter((d) => d.status === 'Online').length}</p><p className="text-xs text-ink-muted">PC Online</p></CardContent></Card>
          <Card><CardContent><p className="text-2xl font-bold text-warning-foreground">{devices.filter((d) => ['Warning', 'Critical', 'Offline'].includes(d.status)).length}</p><p className="text-xs text-ink-muted">PC Bermasalah</p></CardContent></Card>
          <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{lab.capacity}</p><p className="text-xs text-ink-muted">Kapasitas</p></CardContent></Card>
          <Card className="sm:col-span-2 lg:col-span-4"><CardContent className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-ink-muted">Kepala Lab</p><p className="text-sm font-medium text-ink-primary">{lab.headName}</p></div>
            <div><p className="text-xs text-ink-muted">Teknisi</p><p className="text-sm font-medium text-ink-primary">{lab.technicianName}</p></div>
            <div><p className="text-xs text-ink-muted">Layout</p><p className="text-sm font-medium text-ink-primary">{lab.layoutRows} × {lab.layoutCols}</p></div>
            <div><p className="text-xs text-ink-muted">Status</p><StatusBadge status={lab.status} /></div>
          </CardContent></Card>
        </div>
      )}

      {tab === 'devices' && (
        <Card>
          <DataTable
            columns={[
              { key: 'positionCode', header: 'Posisi', sortable: true },
              { key: 'hostname', header: 'Hostname', sortable: true },
              { key: 'ipAddress', header: 'IP' },
              { key: 'status', header: 'Status', render: (d: Device) => <StatusBadge status={d.status} /> },
              { key: 'cpu', header: 'CPU', render: (d: Device) => `${Math.round(d.cpuUsage)}%` },
              { key: 'ram', header: 'RAM', render: (d: Device) => `${Math.round(d.ramUsage)}%` },
            ]}
            data={devices}
            rowKey={(d) => d.id}
            searchable
            searchKeys={(d) => `${d.positionCode} ${d.hostname} ${d.ipAddress}`}
            onRowClick={() => navigate('/monitoring')}
          />
        </Card>
      )}

      {tab === 'inventory' && (
        <Card>
          <DataTable
            columns={[
              { key: 'assetCode', header: 'Kode Aset', sortable: true },
              { key: 'name', header: 'Nama', sortable: true },
              { key: 'category', header: 'Kategori' },
              { key: 'condition', header: 'Kondisi', render: (a) => <ConditionBadge condition={a.condition} /> },
              { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
            ]}
            data={assets}
            rowKey={(a) => a.id}
            searchable
            searchKeys={(a) => `${a.assetCode} ${a.name} ${a.serialNumber}`}
            onRowClick={(a) => navigate(`/assets/${a.id}`)}
          />
        </Card>
      )}

      {tab === 'schedules' && (
        <Card>
          <DataTable
            columns={[
              { key: 'day', header: 'Hari', sortable: true },
              { key: 'date', header: 'Tanggal' },
              { key: 'time', header: 'Jam', render: (s) => `${s.startTime} - ${s.endTime}` },
              { key: 'className', header: 'Kelas' },
              { key: 'teacherName', header: 'Guru' },
              { key: 'subject', header: 'Mapel' },
              { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
            ]}
            data={schedules}
            rowKey={(s) => s.id}
            searchable
            searchKeys={(s) => `${s.className} ${s.teacherName} ${s.subject}`}
          />
        </Card>
      )}

      {tab === 'journals' && (
        <Card>
          <DataTable
            columns={[
              { key: 'journalNumber', header: 'No. Jurnal', sortable: true },
              { key: 'date', header: 'Tanggal' },
              { key: 'className', header: 'Kelas' },
              { key: 'material', header: 'Materi' },
              { key: 'status', header: 'Status', render: (j) => <StatusBadge status={j.status} /> },
            ]}
            data={journals}
            rowKey={(j) => j.id}
            searchable
            searchKeys={(j) => `${j.journalNumber} ${j.material}`}
          />
        </Card>
      )}

      {tab === 'maintenance' && (
        <Card>
          {maintenance.length === 0 ? <EmptyState title="Belum ada maintenance" /> : (
            <DataTable
              columns={[
                { key: 'date', header: 'Tanggal', sortable: true },
                { key: 'technician', header: 'Teknisi' },
                { key: 'findings', header: 'Temuan' },
                { key: 'conditionAfter', header: 'Kondisi', render: (m) => <ConditionBadge condition={m.conditionAfter} /> },
              ]}
              data={maintenance}
              rowKey={(m) => m.id}
            />
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card>
          {auditLogs.length === 0 ? <EmptyState title="Belum ada aktivitas" /> : (
            <DataTable
              columns={[
                { key: 'at', header: 'Waktu' },
                { key: 'userName', header: 'Pengguna' },
                { key: 'action', header: 'Aksi' },
                { key: 'object', header: 'Objek' },
              ]}
              data={auditLogs}
              rowKey={(a) => a.id}
            />
          )}
        </Card>
      )}
    </div>
  );
}

export function LaboratoryLayoutPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { db, mutate } = useAppData();
  const lab = db.labs.find((l) => l.id === id);
  const [cols, setCols] = useState(lab?.layoutCols ?? 6);

  if (!lab) return <EmptyState title="Laboratorium tidak ditemukan" action={<Button onClick={() => navigate('/laboratories')}>Kembali</Button>} />;

  const currentLab = lab;
  const devices = db.devices.filter((d) => d.laboratoryId === currentLab.id);

  function moveDevice(device: Device, newCol: number, newRow: number) {
    mutate((d) => {
      const idx = d.devices.findIndex((x) => x.id === device.id);
      if (idx >= 0) {
        d.devices[idx].col = newCol;
        d.devices[idx].row = newRow;
      }
    });
  }

  function addElement(type: 'teacher' | 'projector' | 'printer' | 'switch' | 'ap') {
    toast(`Elemen ${type} ditambahkan ke denah (demo)`, 'info');
  }

  function resetLayout() {
    mutate((d) => {
      d.devices.filter((x) => x.laboratoryId === currentLab.id).forEach((dev, i) => {
        const idx = d.devices.findIndex((x) => x.id === dev.id);
        d.devices[idx].col = (i % cols) + 1;
        d.devices[idx].row = Math.floor(i / cols) + 1;
      });
    });
    toast('Denah direset ke posisi default', 'success');
  }

  const grid = Array.from({ length: currentLab.layoutRows * cols }, (_, i) => {
    const col = (i % cols) + 1;
    const row = Math.floor(i / cols) + 1;
    return devices.find((d) => d.col === col && d.row === row) ?? null;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Denah ${currentLab.name}`}
        description="Editor tata letak laboratorium - drag PC ke posisi yang diinginkan"
        icon={<MapIcon className="h-5 w-5" />}
        actions={
          <>
            <Select value={String(cols)} onChange={(e) => setCols(Number(e.target.value))} options={[4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} kolom` }))} />
            <Button variant="secondary" size="sm" onClick={resetLayout}>Reset</Button>
            <Button size="sm" onClick={() => toast('Denah disimpan', 'success')}>Simpan</Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">Grid {currentLab.layoutRows} × {cols}</p>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <Monitor className="h-4 w-4 text-accent-primary" /> PC
                <Users className="h-4 w-4 text-success-foreground" /> Meja Guru
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-base-700 bg-base-900/40 p-4">
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {grid.map((device, i) => {
                  const col = (i % cols) + 1;
                  const row = Math.floor(i / cols) + 1;
                  return (
                    <div
                      key={i}
                      className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-base-700 bg-base-800/40"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const devId = e.dataTransfer.getData('text/plain');
                        const dev = devices.find((d) => d.id === devId);
                        if (dev) moveDevice(dev, col, row);
                      }}
                    >
                      {device && (
                        <div
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', device.id)}
                          className={cn(
                            'flex h-full w-full cursor-grab flex-col items-center justify-center rounded-lg border-2 transition-colors active:cursor-grabbing',
                            device.status === 'Online' ? 'border-success/40 bg-success/10 text-success-foreground' : device.status === 'Critical' ? 'border-danger/40 bg-danger/10 text-danger' : device.status === 'Offline' ? 'border-base-600 bg-base-700/40 text-ink-muted' : 'border-warning/40 bg-warning/10 text-warning-foreground'
                          )}
                        >
                          <Monitor className="h-5 w-5" />
                          <span className="mt-1 text-[10px] font-semibold">{device.positionCode}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tambah Elemen</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {[
              { type: 'teacher' as const, label: 'Meja Guru', icon: <Users className="h-4 w-4" /> },
              { type: 'projector' as const, label: 'Proyektor', icon: <Monitor className="h-4 w-4" /> },
              { type: 'printer' as const, label: 'Printer', icon: <Monitor className="h-4 w-4" /> },
              { type: 'switch' as const, label: 'Switch', icon: <Monitor className="h-4 w-4" /> },
              { type: 'ap' as const, label: 'Access Point', icon: <Monitor className="h-4 w-4" /> },
            ].map((el) => (
              <button key={el.type} onClick={() => addElement(el.type)} className="flex w-full items-center gap-2 rounded-lg border border-base-700 bg-base-800/60 p-3 text-left text-sm text-ink-secondary transition-colors hover:border-accent-primary/50 hover:bg-base-700/40">
                {el.icon}
                {el.label}
                <Plus className="ml-auto h-4 w-4 text-ink-muted" />
              </button>
            ))}
            <div className="border-t border-base-700 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Statistik</p>
              <div className="space-y-1 text-xs text-ink-muted">
                <div className="flex justify-between"><span>Total PC</span><span className="text-ink-primary">{devices.length}</span></div>
                <div className="flex justify-between"><span>Online</span><span className="text-success-foreground">{devices.filter((d) => d.status === 'Online').length}</span></div>
                <div className="flex justify-between"><span>Bermasalah</span><span className="text-warning-foreground">{devices.filter((d) => ['Warning', 'Critical', 'Offline'].includes(d.status)).length}</span></div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
