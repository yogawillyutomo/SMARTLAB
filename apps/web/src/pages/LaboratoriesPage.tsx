import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
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
  DoorOpen,
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
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/utils';
import { uid } from '@/utils';
import {
  cloneLaboratoryLayout,
  createLaboratoryWithInitialLayout,
  deleteLaboratorySafely,
  getActiveLaboratoryLayout,
  layoutFingerprint,
  layoutsEquivalent,
  moveLayoutElement,
  saveActiveLaboratoryLayout,
  RPL_PERIMETER_CENTER_ISLAND_36,
  checkPhysicalLayoutTemplateCompatibility,
  generatePhysicalLayoutTemplateDraft,
} from '@/domain/laboratory-layout';
import type { Device, Laboratory, LaboratoryLayout } from '@/types';

export function LaboratoriesPage() {
  const { db, mutate, replaceDB } = useAppData();
  const user = useAuthStore((state) => state.user);
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
    if (editing) {
      const safeEdits = { ...form };
      delete safeEdits.pcCount;
      delete safeEdits.layoutRows;
      delete safeEdits.layoutCols;
      const result = mutate((d) => {
        const idx = d.labs.findIndex((l) => l.id === editing.id);
        if (idx >= 0) d.labs[idx] = { ...d.labs[idx], ...safeEdits };
      });
      if (!result.ok) { toast(result.error, 'error'); return; }
    } else {
      const id = `lab-${Date.now()}`;
      const rows = form.layoutRows ?? 6;
      const cols = form.layoutCols ?? 6;
      const count = form.pcCount ?? 0;
      const laboratory = { ...form, id, layoutRows: rows, layoutCols: cols, pcCount: count } as Laboratory;
      const devices: Device[] = Array.from({ length: count }, (_, index) => {
        const n = index + 1;
        return {
          id: `dev-${form.code}-${String(n).padStart(2, '0')}`,
          positionCode: `PC-${String(n).padStart(2, '0')}`,
          hostname: `PC-${form.code}-${String(n).padStart(2, '0')}`,
          laboratoryId: id,
          assetCode: `AST-${form.code}-${String(n).padStart(3, '0')}`,
          ipAddress: `10.10.99.${n}`,
          macAddress: `02:00:99:${String(n).padStart(2, '0')}:${String(n + 1).padStart(2, '0')}:${String(n + 2).padStart(2, '0')}`,
          serialNumber: `SN${form.code}${String(n).padStart(3, '0')}2026`,
          brand: 'Dell', model: 'OptiPlex 7090', yearAcquired: 2026, processor: 'Intel Core i5-11400', ramGB: 16, storageGB: 512,
          gpu: 'Intel UHD Graphics 730', monitor: 'Dell 24"', os: 'Windows 11 Pro', status: 'Offline', cpuUsage: 0, ramUsage: 0,
          diskUsage: 40, temperature: 45, uptimeHours: 0, network: 'Disconnected', lastHeartbeat: new Date().toISOString(),
          peripherals: { monitor: true, keyboard: true, mouse: true, headset: false, network: false, ups: false },
        };
      });
      const created = createLaboratoryWithInitialLayout({
        db,
        laboratory,
        devices,
        createdAt: new Date().toISOString(),
        layoutId: `layout:${id}:v1`,
        actor: { name: user?.name ?? 'Admin', role: user?.role ?? 'Admin Lab', device: 'Web' },
        auditId: uid('al'),
      });
      if (!created.ok) {
        toast(created.error, 'error');
        return;
      }
      const saved = replaceDB(created.db);
      if (!saved.ok) {
        toast(saved.error, 'error');
        return;
      }
    }
    toast(editing ? 'Laboratorium diperbarui' : 'Laboratorium ditambahkan', 'success');
    setOpen(false);
  }
  function toggleStatus(lab: Laboratory) {
    const result = mutate((d) => {
      const idx = d.labs.findIndex((l) => l.id === lab.id);
      if (idx >= 0) d.labs[idx].status = d.labs[idx].status === 'active' ? 'inactive' : 'active';
    });
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast(`Laboratorium ${lab.status === 'active' ? 'dinonaktifkan' : 'diaktifkan'}`, 'success');
  }
  function remove() {
    if (!confirmDel) return;
    const result = deleteLaboratorySafely({
      db,
      laboratoryId: confirmDel.id,
      deletedAt: new Date().toISOString(),
      actor: { name: user?.name ?? 'Admin', role: user?.role ?? 'Admin Lab', device: 'Web' },
      auditId: uid('al'),
    });
    if (!result.ok) { toast(result.error, 'error'); return; }
    const saved = replaceDB(result.db);
    if (!saved.ok) {
      toast(saved.error, 'error');
      return;
    }
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
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-content">
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
          <Input label="Jumlah PC" type="number" value={form.pcCount ?? 0} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, pcCount: Number(e.target.value) })} />
          <Input label="Baris Denah" type="number" value={form.layoutRows ?? 6} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, layoutRows: Number(e.target.value) })} />
          <Input label="Kolom Denah" type="number" value={form.layoutCols ?? 6} disabled={Boolean(editing)} onChange={(e) => setForm({ ...form, layoutCols: Number(e.target.value) })} />
          {editing && <p className="sm:col-span-2 text-xs text-ink-muted">Jumlah PC dan ukuran denah tidak dapat diubah pada tahap ini. Perubahan struktur tersedia pada tahap editor berikutnya.</p>}
          <Select label="Status" value={form.status ?? 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as Laboratory['status'] })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
        </div>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus laboratorium "${confirmDel?.name}"? Penghapusan hanya dapat dilakukan apabila tidak ada perangkat, jadwal, booking, jurnal, insiden, work order, maintenance, atau data terkait lainnya.`} confirmLabel="Hapus" />
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
          <Card><CardContent><p className="text-2xl font-bold text-accent-content">{devices.length}</p><p className="text-xs text-ink-muted">Total Perangkat</p></CardContent></Card>
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
  const { db, replaceDB } = useAppData();
  const user = useAuthStore((state) => state.user);
  const canUpdate = usePermission('laboratories', 'update');
  const lab = db.labs.find((l) => l.id === id);
  const activeResult = useMemo(() => lab ? getActiveLaboratoryLayout(db, lab.id) : null, [db, lab]);
  const activeLayout = activeResult?.ok ? activeResult.layout : null;
  const activeKey = activeLayout ? `${activeLayout.updatedAt}:${layoutFingerprint(activeLayout)}` : '';
  const [baseline, setBaseline] = useState<LaboratoryLayout | null>(null);
  const [draft, setDraft] = useState<LaboratoryLayout | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [teacherDeviceId, setTeacherDeviceId] = useState('');
  const dirty = Boolean(baseline && draft && !layoutsEquivalent(baseline, draft));
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (activeLayout && !dirty) {
      setBaseline(cloneLaboratoryLayout(activeLayout));
      setDraft(cloneLaboratoryLayout(activeLayout));
    }
  }, [activeKey, activeLayout, dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

  if (!lab) return <EmptyState title="Laboratorium tidak ditemukan" action={<Button onClick={() => navigate('/laboratories')}>Kembali</Button>} />;
  if (!activeResult?.ok || !baseline || !draft) {
    return <EmptyState title="Denah aktif tidak dapat dimuat" description={activeResult?.ok ? 'Menyiapkan denah...' : activeResult?.error ?? 'Data denah tidak valid.'} action={<Button onClick={() => navigate('/laboratories')}>Kembali</Button>} />;
  }
  const currentLab = lab;
  const baselineLayout = baseline;
  const draftLayout = draft;
  const cols = draft.columns;
  const devices = db.devices.filter((device) => device.laboratoryId === currentLab.id);
  const templateCompatibility = checkPhysicalLayoutTemplateCompatibility({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: currentLab, devices, teacherDeviceId: teacherDeviceId || undefined });
  const grid = Array.from({ length: draft.rows * cols }, (_, index) => {
    const col = (index % cols) + 1;
    const row = Math.floor(index / cols) + 1;
    return draft.elements.find((element) => element.row === row && element.column === col) ?? null;
  });

  function moveElement(sourceElementId: string, column: number, row: number) {
    if (!canUpdate) return;
    const result = moveLayoutElement(draftLayout, sourceElementId, { row, column }, { updatedAt: new Date().toISOString() });
    if (!result.ok) {
      toast(result.message, 'error');
      return;
    }
    if (result.operation !== 'noop') setDraft(result.layout);
  }

  function cancelChanges() {
    setDraft(cloneLaboratoryLayout(baselineLayout));
  }

  function openTemplate() {
    if (!canUpdate) return;
    setTeacherDeviceId('');
    setTemplateOpen(true);
  }

  function applyTemplate() {
    if (!canUpdate) return;
    const result = generatePhysicalLayoutTemplateDraft({ templateId: RPL_PERIMETER_CENTER_ISLAND_36.id, laboratory: currentLab, activeLayout: draftLayout, devices, teacherDeviceId: teacherDeviceId || undefined, updatedAt: new Date().toISOString() });
    if (!result.ok) { toast(result.issues[0]?.message ?? 'Template tidak dapat diterapkan.', 'error'); return; }
    setDraft(result.layout);
    setTemplateOpen(false);
  }

  function saveChanges() {
    if (!canUpdate || !dirty || saving) return;
    setSaving(true);
    const result = saveActiveLaboratoryLayout({
      db, laboratoryId: currentLab.id, draft: draftLayout,
      actor: { name: user?.name ?? 'Admin', role: user?.role ?? 'Admin Lab', device: 'Web' },
      savedAt: new Date().toISOString(), auditId: uid('al'),
    });
    if (!result.ok) {
      toast(result.error, 'error');
      setSaving(false);
      return;
    }
    if (result.changed) {
      const persisted = replaceDB(result.db);
      if (!persisted.ok) {
        toast(persisted.error, 'error');
        setSaving(false);
        return;
      }
      toast('Denah berhasil disimpan', 'success');
    }
    setBaseline(cloneLaboratoryLayout(result.layout));
    setDraft(cloneLaboratoryLayout(result.layout));
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Denah ${currentLab.name}`}
        description="Editor tata letak laboratorium. Posisi perangkat disimpan setelah Anda menekan Simpan."
        icon={<MapIcon className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={!canUpdate ? 'muted' : dirty ? 'warning' : 'success'}>{!canUpdate ? 'Mode hanya baca' : dirty ? 'Perubahan belum disimpan' : 'Tersimpan'}</Badge>
            {canUpdate && <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={cancelChanges}>Batalkan Perubahan</Button>}
            {canUpdate && <Button size="sm" disabled={!dirty || saving} loading={saving} onClick={saveChanges}>Simpan</Button>}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted">Grid {draft.rows} × {cols}</p>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <Monitor className="h-4 w-4 text-accent-content" /> PC
                <Users className="h-4 w-4 text-success-foreground" /> PC Guru
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-base-700 bg-base-900/40 p-4">
              <div className="grid gap-2" style={{ minWidth: draft.layoutType === 'perimeter-center-island' ? '760px' : undefined, gridTemplateColumns: `repeat(${cols}, minmax(92px, 1fr))` }}>
                {grid.map((element, i) => {
                  const col = (i % cols) + 1;
                  const row = Math.floor(i / cols) + 1;
                  const device = element?.referenceId ? devices.find((candidate) => candidate.id === element.referenceId) : undefined;
                  const isPc = element?.type === 'student_pc' || element?.type === 'teacher_pc';
                  const isTeacher = element?.type === 'teacher_pc';
                  const statusClass = !device ? '' : device.status === 'Online' ? 'border-success/40 bg-success/10 text-success-foreground' : device.status === 'Critical' ? 'border-danger/40 bg-danger/10 text-danger' : device.status === 'Offline' ? 'border-base-600 bg-base-700/40 text-ink-muted' : 'border-warning/40 bg-warning/10 text-warning-foreground';
                  return (
                    <div
                      key={element?.id ?? `${row}:${col}`}
                      style={element ? { gridRow: `${element.row} / span ${element.rowSpan}`, gridColumn: `${element.column} / span ${element.columnSpan}` } : undefined}
                      className={cn('flex aspect-square items-center justify-center rounded-lg', element?.type === 'aisle' ? 'border border-base-700/40 bg-base-800/20' : element?.type === 'door' ? 'border-2 border-warning/40 bg-warning/10' : 'border-2 border-dashed border-base-700 bg-base-800/40')}
                      onDragOver={(e) => { if (canUpdate) e.preventDefault(); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (element) moveElement(e.dataTransfer.getData('text/plain'), col, row);
                      }}
                    >
                      {isPc && device ? (
                        <div
                          draggable={canUpdate && Boolean(element?.movable)}
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', element!.id)}
                          className={cn(
                            'flex h-full w-full flex-col items-center justify-center rounded-lg border-2 transition-colors',
                            canUpdate && element?.movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                            statusClass,
                            isTeacher && 'ring-2 ring-accent-content/70 ring-offset-1 ring-offset-base-900'
                          )}
                        >
                          <Monitor className="h-5 w-5" />
                          <span className="mt-1 text-[10px] font-semibold">{isTeacher ? 'PC Guru' : device.positionCode}</span>
                          {isTeacher && <span className="text-[9px] opacity-80">{device.positionCode}</span>}
                        </div>
                      ) : isPc ? <span className="px-2 text-center text-[10px] text-danger">Referensi perangkat tidak ditemukan</span> : element?.type === 'door' ? <div className="flex flex-col items-center gap-1 text-warning-foreground"><DoorOpen className="h-5 w-5" /><span className="text-[10px] font-medium">Pintu Masuk</span></div> : element?.type === 'aisle' ? null : element?.type !== 'empty' ? <span className="px-2 text-center text-[10px] text-ink-muted">{element?.label ?? element?.type}</span> : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Template Denah</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1 text-xs text-ink-muted">
              <div className="flex justify-between"><span>Total PC</span><span className="text-ink-primary">{draft.elements.filter((element) => element.type === 'student_pc' || element.type === 'teacher_pc').length}</span></div>
              <div className="flex justify-between"><span>Online</span><span className="text-success-foreground">{draft.elements.filter((element) => element.referenceId && devices.find((device) => device.id === element.referenceId)?.status === 'Online').length}</span></div>
              <div className="flex justify-between"><span>Bermasalah</span><span className="text-warning-foreground">{draft.elements.filter((element) => element.referenceId && ['Warning', 'Critical', 'Offline'].includes(devices.find((device) => device.id === element.referenceId)?.status ?? '')).length}</span></div>
            </div>
            <div className="border-t border-base-700 pt-3 text-xs leading-relaxed text-ink-muted">
              <p>Jenis saat ini: <span className="text-ink-primary">{draft.layoutType === 'perimeter-center-island' ? 'Perimeter + Center Island' : 'Grid Klasik'}</span></p>
              <p className="mt-2 font-medium text-ink-primary">{RPL_PERIMETER_CENTER_ISLAND_36.name}</p>
              <p>{RPL_PERIMETER_CENTER_ISLAND_36.description}</p>
              <p className="mt-2">36 PC Siswa · 1 PC Guru · 37 perangkat total · Grid 11 × 7</p>
              {devices.length !== 37 && <p className="mt-2 text-warning-foreground">Template membutuhkan 37 perangkat. Laboratorium ini memiliki {devices.length}.</p>}
              {canUpdate && <Button size="sm" className="mt-3 w-full" disabled={devices.length !== 37} onClick={openTemplate}>Gunakan Template</Button>}
            </div>
          </CardContent>
        </Card>
      </div>
      <FormDialog open={templateOpen} onClose={() => setTemplateOpen(false)} title="Gunakan Template Perimeter + Center Island" description="Pilih perangkat nyata yang akan digunakan sebagai PC Guru. Template akan menjadi draft dan belum disimpan." onSubmit={applyTemplate} submitLabel="Terapkan ke Draft" submitDisabled={!templateCompatibility.compatible} size="md">
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">Grid 11 × 7 · 36 PC siswa · 1 PC Guru · 1 pintu masuk.</p>
          <Select label="PC Guru" value={teacherDeviceId} onChange={(event) => setTeacherDeviceId(event.target.value)} placeholder="Pilih perangkat PC Guru" options={devices.map((device) => ({ value: device.id, label: `${device.positionCode} — ${device.hostname} — ${device.assetCode}` }))} />
          {!templateCompatibility.compatible && <p className="text-xs text-warning-foreground">{templateCompatibility.issues[0]?.message}</p>}
        </div>
      </FormDialog>
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onClose={() => blocker.reset?.()}
        onConfirm={() => {
          cancelChanges();
          blocker.proceed?.();
        }}
        title="Buang perubahan denah?"
        message="Perubahan denah belum disimpan. Buang perubahan dan lanjutkan ke halaman lain?"
        confirmLabel="Buang perubahan dan lanjutkan"
        cancelLabel="Tetap di halaman"
      />
    </div>
  );
}
