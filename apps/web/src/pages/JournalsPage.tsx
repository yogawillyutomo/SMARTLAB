import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Download, Printer, Eye } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import type { Journal } from '@/types';

export function JournalsPage() {
  const { db, mutate } = useAppData();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('journals', 'create');
  const canUpdate = usePermission('journals', 'update');
  const canDelete = usePermission('journals', 'delete');
  const canExport = usePermission('journals', 'export');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Journal | null>(null);
  const [confirmDel, setConfirmDel] = useState<Journal | null>(null);
  const [editing, setEditing] = useState<Journal | null>(null);
  const [form, setForm] = useState<Partial<Journal>>({});

  const stats = useMemo(() => ({
    total: db.journals.length,
    verified: db.journals.filter((j) => j.status === 'Diverifikasi').length,
    draft: db.journals.filter((j) => j.status === 'Draft').length,
    needsFix: db.journals.filter((j) => j.status === 'Perlu Perbaikan').length,
  }), [db.journals]);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ date: new Date().toISOString().split('T')[0], laboratoryId: db.labs[0]?.id, teacherName: user?.name ?? '', hours: 3, presentCount: 30, absentCount: 2, status: 'Draft', source: 'manual' });
    setOpen(true);
  }
  function openEdit(j: Journal) {
    if (!canUpdate) return;
    setEditing(j);
    setForm(j);
    setOpen(true);
  }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.laboratoryId || !form.teacherName || !form.subject) {
      toast('Lengkapi field wajib', 'error');
      return;
    }
    mutate((d) => {
      if (editing) {
        const idx = d.journals.findIndex((j) => j.id === editing.id);
        if (idx >= 0) d.journals[idx] = { ...d.journals[idx], ...form } as Journal;
      } else {
        const num = `JRN-2026-${String(d.journals.length + 1).padStart(4, '0')}`;
        d.journals.unshift({ ...form, id: `jrn-${Date.now()}`, journalNumber: num } as Journal);
      }
    });
    toast(editing ? 'Jurnal diperbarui' : 'Jurnal ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.journals = d.journals.filter((j) => j.id !== confirmDel.id); });
    toast('Jurnal dihapus', 'success');
    setConfirmDel(null);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('jurnal-praktikum.csv', db.journals.map((j) => ({
      No: j.journalNumber, Tanggal: j.date, Lab: db.labs.find((l) => l.id === j.laboratoryId)?.name, Guru: j.teacherName, Kelas: j.className, Mapel: j.subject, Materi: j.material, Hadir: j.presentCount, Absen: j.absentCount, Status: j.status, Sumber: j.source,
    })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jurnal Praktikum"
        description="Catatan kegiatan praktikum laboratorium"
        icon={<ClipboardList className="h-5 w-5" />}
        actions={
          <>
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canExport && <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Jurnal</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-blue">{stats.total}</p><p className="text-xs text-ink-muted">Total Jurnal</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-emerald-400">{stats.verified}</p><p className="text-xs text-ink-muted">Diverifikasi</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-muted">{stats.draft}</p><p className="text-xs text-ink-muted">Draft</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-amber-400">{stats.needsFix}</p><p className="text-xs text-ink-muted">Perlu Perbaikan</p></CardContent></Card>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-base-700 text-left text-ink-muted">
              <th className="px-4 py-3 font-medium">No. Jurnal</th><th className="px-4 py-3 font-medium">Tanggal</th><th className="px-4 py-3 font-medium">Guru</th><th className="px-4 py-3 font-medium">Kelas</th><th className="px-4 py-3 font-medium">Materi</th><th className="px-4 py-3 font-medium">Hadir/Absen</th><th className="px-4 py-3 font-medium">Sumber</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Aksi</th>
            </tr></thead>
            <tbody>
              {db.journals.length === 0 ? <tr><td colSpan={9}><EmptyState title="Belum ada jurnal" className="py-10" /></td></tr> : db.journals.map((j) => (
                <tr key={j.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                  <td className="px-4 py-3 font-medium text-ink-primary">{j.journalNumber}</td>
                  <td className="px-4 py-3 text-ink-secondary">{j.date}</td>
                  <td className="px-4 py-3 text-ink-secondary">{j.teacherName}</td>
                  <td className="px-4 py-3 text-ink-secondary">{j.className}</td>
                  <td className="px-4 py-3 text-ink-secondary max-w-[200px] truncate">{j.material}</td>
                  <td className="px-4 py-3 text-ink-secondary">{j.presentCount}/{j.absentCount}</td>
                  <td className="px-4 py-3"><Badge tone={j.source === 'session' ? 'accent' : 'muted'}>{j.source === 'session' ? 'Sesi' : 'Manual'}</Badge></td>
                  <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <button onClick={() => setDetail(j)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Eye className="h-4 w-4" /></button>
                    {canUpdate && <button onClick={() => openEdit(j)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
                    {canDelete && <button onClick={() => setConfirmDel(j)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Jurnal' : 'Tambah Jurnal'} onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Tanggal" type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Select label="Laboratorium" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Guru" value={form.teacherName ?? ''} onChange={(e) => setForm({ ...form, teacherName: e.target.value })} />
          <Input label="Kelas" value={form.className ?? ''} onChange={(e) => setForm({ ...form, className: e.target.value })} />
          <Input label="Mata Pelajaran" value={form.subject ?? ''} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <Input label="Jam Pelajaran" type="number" value={form.hours ?? 3} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
          <Input label="Software" value={form.software ?? ''} onChange={(e) => setForm({ ...form, software: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Journal['status'] })} options={['Draft', 'Berlangsung', 'Selesai', 'Perlu Perbaikan', 'Diverifikasi'].map((s) => ({ value: s, label: s }))} />
          <div className="sm:col-span-2"><Input label="Materi" value={form.material ?? ''} onChange={(e) => setForm({ ...form, material: e.target.value })} /></div>
          <Input label="Hadir" type="number" value={form.presentCount ?? 0} onChange={(e) => setForm({ ...form, presentCount: Number(e.target.value) })} />
          <Input label="Tidak Hadir" type="number" value={form.absentCount ?? 0} onChange={(e) => setForm({ ...form, absentCount: Number(e.target.value) })} />
          <div className="sm:col-span-2"><Textarea label="Kondisi Awal" value={form.initialCondition ?? ''} onChange={(e) => setForm({ ...form, initialCondition: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Kondisi Akhir" value={form.finalCondition ?? ''} onChange={(e) => setForm({ ...form, finalCondition: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Kendala" value={form.issues ?? ''} onChange={(e) => setForm({ ...form, issues: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Tindak Lanjut" value={form.followUp ?? ''} onChange={(e) => setForm({ ...form, followUp: e.target.value })} /></div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.journalNumber} description={detail ? `${detail.date} · ${detail.teacherName}` : ''} width="max-w-lg">
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Lab</p><p className="text-ink-primary">{db.labs.find((l) => l.id === detail.laboratoryId)?.name}</p></div>
              <div><p className="text-xs text-ink-muted">Kelas</p><p className="text-ink-primary">{detail.className}</p></div>
              <div><p className="text-xs text-ink-muted">Mapel</p><p className="text-ink-primary">{detail.subject}</p></div>
              <div><p className="text-xs text-ink-muted">Software</p><p className="text-ink-primary">{detail.software}</p></div>
              <div><p className="text-xs text-ink-muted">Hadir</p><p className="text-ink-primary">{detail.presentCount}</p></div>
              <div><p className="text-xs text-ink-muted">Absen</p><p className="text-ink-primary">{detail.absentCount}</p></div>
            </div>
            <div><p className="text-xs text-ink-muted">Materi</p><p className="text-ink-secondary">{detail.material}</p></div>
            <div><p className="text-xs text-ink-muted">Kondisi Awal</p><p className="text-ink-secondary">{detail.initialCondition}</p></div>
            <div><p className="text-xs text-ink-muted">Kondisi Akhir</p><p className="text-ink-secondary">{detail.finalCondition}</p></div>
            {detail.issues && <div><p className="text-xs text-ink-muted">Kendala</p><p className="text-amber-400">{detail.issues}</p></div>}
            {detail.followUp && <div><p className="text-xs text-ink-muted">Tindak Lanjut</p><p className="text-ink-secondary">{detail.followUp}</p></div>}
            <div><p className="text-xs text-ink-muted">Sumber</p><Badge tone={detail.source === 'session' ? 'accent' : 'muted'}>{detail.source === 'session' ? 'Dari Sesi' : 'Manual'}</Badge></div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus jurnal ${confirmDel?.journalNumber}?`} confirmLabel="Hapus" />
    </div>
  );
}
