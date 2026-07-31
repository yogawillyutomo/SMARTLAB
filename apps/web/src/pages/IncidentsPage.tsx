import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Download, MessageSquare, ArrowRight } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge, PriorityBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import type { Incident, IncidentCategory, Priority } from '@/types';

const CATEGORIES: IncidentCategory[] = ['hardware', 'software', 'jaringan', 'listrik', 'periferal', 'fasilitas', 'kebersihan', 'keamanan', 'lainnya'];
const PRIORITIES: Priority[] = ['Rendah', 'Normal', 'Tinggi', 'Kritis'];
const STATUSES: Incident['status'][] = ['Dilaporkan', 'Diverifikasi', 'Ditugaskan', 'Diproses', 'Menunggu Spare Part', 'Selesai', 'Diuji', 'Ditutup', 'Ditolak'];
type IncidentTransitionPermission = 'assign' | 'update' | 'approve';
type IncidentPermissions = Record<IncidentTransitionPermission, boolean>;

const INCIDENT_TRANSITIONS: Record<Incident['status'], Partial<Record<Incident['status'], IncidentTransitionPermission>>> = {
  Dilaporkan: { Diverifikasi: 'approve', Ditolak: 'approve' },
  Diverifikasi: { Ditugaskan: 'assign' },
  Ditugaskan: { Diproses: 'update' },
  Diproses: { 'Menunggu Spare Part': 'update', Selesai: 'update' },
  'Menunggu Spare Part': { Diproses: 'update', Selesai: 'update' },
  Selesai: { Diuji: 'approve' },
  Diuji: { Ditutup: 'approve' },
  Ditutup: {},
  Ditolak: {},
};

function canTransitionToStatus(incident: Incident, target: Incident['status'], permissions: IncidentPermissions) {
  const requiredPermission = INCIDENT_TRANSITIONS[incident.status][target];
  return requiredPermission ? permissions[requiredPermission] : false;
}

export function IncidentsPage() {
  const { db, mutate } = useAppData();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('incidents', 'create');
  const canUpdate = usePermission('incidents', 'update');
  const canDelete = usePermission('incidents', 'delete');
  const canAssign = usePermission('incidents', 'assign');
  const canApproveIncident = usePermission('incidents', 'approve');
  const canExport = usePermission('incidents', 'export');
  const canCreateWorkOrder = usePermission('work-orders', 'create');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Incident | null>(null);
  const [confirmDel, setConfirmDel] = useState<Incident | null>(null);
  const [commentText, setCommentText] = useState('');
  const [filters, setFilters] = useState({ status: 'all', priority: 'all', category: 'all' });
  const [form, setForm] = useState<Partial<Incident>>({});
  const workflowPermissions: IncidentPermissions = { assign: canAssign, update: canUpdate, approve: canApproveIncident };

  const filtered = useMemo(() => db.incidents.filter((i) => {
    if (filters.status !== 'all' && i.status !== filters.status) return false;
    if (filters.priority !== 'all' && i.priority !== filters.priority) return false;
    if (filters.category !== 'all' && i.category !== filters.category) return false;
    return true;
  }), [db.incidents, filters]);

  function openCreate() {
    if (!canCreate) return;
    setForm({ reporterName: user?.name ?? '', laboratoryId: db.labs[0]?.id, date: new Date().toISOString(), category: 'hardware', priority: 'Normal', blocksPracticum: false });
    setOpen(true);
  }

  function save() {
    if (!canCreate) return;
    if (!form.title || !form.description) { toast('Judul dan deskripsi wajib diisi', 'error'); return; }
    // Duplicate detection
    const dup = db.incidents.find((i) => i.title.toLowerCase() === form.title?.toLowerCase() && i.status !== 'Ditutup');
    if (dup) {
      toast(`Kemungkinan duplikat: ${dup.ticketNumber} sudah ada dengan judul sama`, 'info');
    }
    mutate((d) => {
      const num = `INC-2026-${String(d.incidents.length + 1).padStart(4, '0')}`;
      d.incidents.unshift({
        id: `inc-${Date.now()}`, ticketNumber: num, reporterName: form.reporterName ?? '', laboratoryId: form.laboratoryId ?? '', assetCode: form.assetCode,
        date: form.date ?? new Date().toISOString(), category: form.category ?? 'lainnya', title: form.title ?? '', description: form.description ?? '',
        impact: form.impact ?? '', priority: form.priority ?? 'Normal', blocksPracticum: form.blocksPracticum ?? false, stepsTaken: form.stepsTaken ?? '',
        status: 'Dilaporkan', comments: [], timeline: [{ status: 'Dilaporkan', at: new Date().toISOString(), by: form.reporterName ?? 'User' }],
      });
    });
    toast('Tiket kerusakan dibuat', 'success');
    setOpen(false);
  }

  function updateStatus(inc: Incident, status: Incident['status']) {
    if (status === 'Ditugaskan' || !canTransitionToStatus(inc, status, workflowPermissions)) return;
    let changed = false;
    mutate((d) => {
      const idx = d.incidents.findIndex((i) => i.id === inc.id);
      if (idx >= 0 && canTransitionToStatus(d.incidents[idx], status, workflowPermissions)) {
        const updated = d.incidents[idx];
        updated.status = status;
        updated.timeline.push({ status, at: new Date().toISOString(), by: user?.name ?? 'Admin' });
        changed = true;
      }
    });
    if (!changed) return;
    setDetail((d) => d && d.id === inc.id ? { ...d, status } : d);
    toast(`Status diubah menjadi ${status}`, 'success');
  }

  function assignTechnician(inc: Incident, tech: string) {
    if (!tech.trim() || !canTransitionToStatus(inc, 'Ditugaskan', workflowPermissions)) return;
    let changed = false;
    const assignedAt = new Date().toISOString();
    mutate((d) => {
      const idx = d.incidents.findIndex((i) => i.id === inc.id);
      if (idx >= 0 && canTransitionToStatus(d.incidents[idx], 'Ditugaskan', workflowPermissions)) {
        const updated = d.incidents[idx];
        updated.assignedTechnician = tech;
        updated.status = 'Ditugaskan';
        updated.timeline.push({ status: 'Ditugaskan', at: assignedAt, by: user?.name ?? 'Admin' });
        changed = true;
      }
    });
    if (!changed) return;
    toast(`Tiket ditugaskan ke ${tech}`, 'success');
    setDetail(null);
  }

  function addComment() {
    if (!canUpdate || !detail || !commentText.trim()) return;
    mutate((d) => {
      const idx = d.incidents.findIndex((i) => i.id === detail.id);
      if (idx >= 0) d.incidents[idx].comments.push({ at: new Date().toISOString(), by: user?.name ?? 'User', text: commentText });
    });
    setCommentText('');
    toast('Komentar ditambahkan', 'success');
  }

  function convertToWO(inc: Incident) {
    if (!canCreateWorkOrder) return;
    let changed = false;
    const workOrderId = `wo-${Date.now()}`;
    const createdAt = new Date().toISOString();
    mutate((d) => {
      const incident = d.incidents.find((item) => item.id === inc.id);
      if (!incident || incident.workOrderId) return;
      const num = `WO-2026-${String(d.workOrders.length + 1).padStart(4, '0')}`;
      d.workOrders.unshift({
        id: workOrderId, woNumber: num, incidentId: inc.id, assetCode: inc.assetCode, laboratoryId: inc.laboratoryId,
        technician: '', priority: inc.priority, diagnosis: '', action: '', scheduledDate: new Date().toISOString().split('T')[0],
        spareParts: [], cost: 0, status: 'Draft', timeline: [{ status: 'Draft', at: createdAt, by: user?.name ?? 'Admin' }],
      });
      incident.workOrderId = workOrderId;
      changed = true;
    });
    if (!changed) return;
    toast('Tiket dikonversi menjadi tugas perbaikan', 'success');
    setDetail(null);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.incidents = d.incidents.filter((i) => i.id !== confirmDel.id); });
    toast('Tiket dihapus', 'success');
    setConfirmDel(null);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('tiket-kerusakan.csv', filtered.map((i) => ({ Tiket: i.ticketNumber, Judul: i.title, Lab: db.labs.find((l) => l.id === i.laboratoryId)?.name, Kategori: i.category, Prioritas: i.priority, Status: i.status, Pelapor: i.reporterName, Tanggal: i.date })));
  }

  const columns: Column<Incident>[] = [
    { key: 'ticketNumber', header: 'Tiket', sortable: true, render: (i) => <button onClick={() => setDetail(i)} className="font-medium text-accent-blue hover:underline">{i.ticketNumber}</button> },
    { key: 'title', header: 'Judul', render: (i) => <span className="text-ink-primary">{i.title}</span> },
    { key: 'lab', header: 'Lab', render: (i) => db.labs.find((l) => l.id === i.laboratoryId)?.name },
    { key: 'category', header: 'Kategori', render: (i) => <Badge tone="neutral">{i.category}</Badge> },
    { key: 'priority', header: 'Prioritas', sortable: true, sortValue: (i) => ['Rendah', 'Normal', 'Tinggi', 'Kritis'].indexOf(i.priority), render: (i) => <PriorityBadge priority={i.priority} /> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'date', header: 'Tanggal', sortable: true, render: (i) => relativeTime(i.date) },
  ];
  const availableStatusOptions = detail
    ? STATUSES.filter((status) => status !== detail.status && status !== 'Ditugaskan' && canTransitionToStatus(detail, status, workflowPermissions)).map((status) => ({ value: status, label: `Ubah ke ${status}` }))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Tiket Kerusakan" description="Catat, klasifikasikan, dan tindak lanjuti masalah perangkat atau fasilitas." icon={<AlertTriangle className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Buat Tiket</Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Dilaporkan', 'Diproses', 'Selesai', 'Ditutup'].map((st) => (
          <Card key={st}><CardContent><p className="text-2xl font-bold text-ink-primary">{db.incidents.filter((i) => i.status === st).length}</p><p className="text-xs text-ink-muted">{st}</p></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} placeholder="Semua" options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <Select label="Prioritas" value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} placeholder="Semua" options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
          <Select label="Kategori" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} placeholder="Semua" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </CardContent>
      </Card>
      <Card><DataTable columns={columns} data={filtered} rowKey={(i) => i.id} searchable searchKeys={(i) => `${i.ticketNumber} ${i.title} ${i.description} ${i.reporterName}`} /></Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title="Buat Tiket Kerusakan" onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Pelapor" value={form.reporterName ?? ''} onChange={(e) => setForm({ ...form, reporterName: e.target.value })} />
          <Select label="Laboratorium" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Kode Aset (opsional)" value={form.assetCode ?? ''} onChange={(e) => setForm({ ...form, assetCode: e.target.value })} />
          <Select label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as IncidentCategory })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Select label="Prioritas" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
          <Input label="Dampak" value={form.impact ?? ''} onChange={(e) => setForm({ ...form, impact: e.target.value })} />
          <div className="sm:col-span-2"><Input label="Judul" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Deskripsi" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Langkah yang Sudah Dilakukan" value={form.stepsTaken ?? ''} onChange={(e) => setForm({ ...form, stepsTaken: e.target.value })} /></div>
          <label className="flex items-center gap-2 text-sm text-ink-secondary sm:col-span-2">
            <input type="checkbox" checked={form.blocksPracticum ?? false} onChange={(e) => setForm({ ...form, blocksPracticum: e.target.checked })} className="rounded border-base-600 text-accent-blue" />
            Menghambat praktikum
          </label>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.ticketNumber} description={detail?.title} width="max-w-xl">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <PriorityBadge priority={detail.priority} />
              <Badge tone="neutral">{detail.category}</Badge>
              {detail.blocksPracticum && <Badge tone="danger">Menghambat Praktikum</Badge>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">Pelapor</p><p className="text-ink-primary">{detail.reporterName}</p></div>
              <div><p className="text-xs text-ink-muted">Lab</p><p className="text-ink-primary">{db.labs.find((l) => l.id === detail.laboratoryId)?.name}</p></div>
              <div><p className="text-xs text-ink-muted">Aset</p><p className="text-ink-primary">{detail.assetCode || '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Tanggal</p><p className="text-ink-primary">{relativeTime(detail.date)}</p></div>
              {detail.assignedTechnician && <div><p className="text-xs text-ink-muted">Teknisi</p><p className="text-ink-primary">{detail.assignedTechnician}</p></div>}
              {detail.workOrderId && <div><p className="text-xs text-ink-muted">Tugas Perbaikan</p><Badge tone="accent">{db.workOrders.find((w) => w.id === detail.workOrderId)?.woNumber}</Badge></div>}
            </div>
            <div><p className="text-xs text-ink-muted">Deskripsi</p><p className="text-sm text-ink-secondary">{detail.description}</p></div>
            {detail.impact && <div><p className="text-xs text-ink-muted">Dampak</p><p className="text-sm text-ink-secondary">{detail.impact}</p></div>}
            {detail.stepsTaken && <div><p className="text-xs text-ink-muted">Langkah yang Sudah Dilakukan</p><p className="text-sm text-ink-secondary">{detail.stepsTaken}</p></div>}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline</p>
              <ActivityTimeline items={detail.timeline.map((t) => ({ label: t.status, by: t.by, at: relativeTime(t.at), tone: 'accent' as const }))} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Komentar ({detail.comments.length})</p>
              <div className="space-y-2">
                {detail.comments.map((c, i) => (
                  <div key={i} className="rounded-lg border border-base-700/60 bg-base-800/40 p-3">
                    <div className="flex justify-between text-xs"><span className="font-medium text-ink-primary">{c.by}</span><span className="text-ink-muted">{relativeTime(c.at)}</span></div>
                    <p className="mt-1 text-sm text-ink-secondary">{c.text}</p>
                  </div>
                ))}
                {detail.comments.length === 0 && <p className="text-xs text-ink-muted">Belum ada komentar</p>}
              </div>
              {canUpdate && <div className="mt-2 flex gap-2">
                <Input placeholder="Tambah komentar..." value={commentText} onChange={(e) => setCommentText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addComment()} />
                <Button size="sm" icon={<MessageSquare className="h-4 w-4" />} onClick={addComment}>Kirim</Button>
              </div>}
            </div>

            <div className="space-y-2 border-t border-base-700 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Aksi</p>
              <div className="flex flex-wrap gap-2">
                {canTransitionToStatus(detail, 'Ditugaskan', workflowPermissions) && (
                  <Select value="" onChange={(e) => e.target.value && assignTechnician(detail, e.target.value)} options={['Andi Wijaya', 'Dedi Kurniawan'].map((t) => ({ value: t, label: `Assign ke ${t}` }))} placeholder="Assign Teknisi" />
                )}
                {availableStatusOptions.length > 0 && <Select value="" onChange={(e) => e.target.value && updateStatus(detail, e.target.value as Incident['status'])} options={availableStatusOptions} placeholder="Ubah Status" />}
                {canCreateWorkOrder && !detail.workOrderId && <Button variant="secondary" size="sm" icon={<ArrowRight className="h-4 w-4" />} onClick={() => convertToWO(detail)}>Jadi Tugas Perbaikan</Button>}
                {canDelete && <Button variant="danger" size="sm" onClick={() => { setConfirmDel(detail); setDetail(null); }}>Hapus</Button>}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus tiket ${confirmDel?.ticketNumber}?`} confirmLabel="Hapus" />
    </div>
  );
}
