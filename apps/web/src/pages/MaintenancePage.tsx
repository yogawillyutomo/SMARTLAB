import { useMemo, useState } from 'react';
import { ShieldCheck, Plus, Pencil, Trash2, Play, Download, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, ConditionBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import type { MaintenancePlan, MaintenanceExecution, MaintenanceFrequency, AssetCondition } from '@/types';

const FREQS: MaintenanceFrequency[] = ['mingguan', 'bulanan', 'tiga bulanan', 'semester', 'tahunan', 'custom'];
const CONDITIONS: AssetCondition[] = ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'];

export function MaintenancePage() {
  const { db, mutate } = useAppData();
  const canCreate = usePermission('maintenance', 'create');
  const canUpdate = usePermission('maintenance', 'update');
  const canDelete = usePermission('maintenance', 'delete');
  const canExport = usePermission('maintenance', 'export');
  const [tab, setTab] = useState<'plans' | 'executions'>('plans');
  const [open, setOpen] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<MaintenancePlan | null>(null);
  const [editing, setEditing] = useState<MaintenancePlan | null>(null);
  const [form, setForm] = useState<Partial<MaintenancePlan>>({});
  const [execForm, setExecForm] = useState<Partial<MaintenanceExecution>>({});
  const [checklistInput, setChecklistInput] = useState('');

  const stats = useMemo(() => {
    const now = new Date();
    const plans = db.maintenance.plans.filter((p) => p.status === 'active');
    return {
      overdue: plans.filter((p) => new Date(p.nextSchedule) < now).length,
      dueSoon: plans.filter((p) => { const d = new Date(p.nextSchedule); const diff = (d.getTime() - now.getTime()) / 86400000; return diff >= 0 && diff <= 7; }).length,
      scheduled: plans.filter((p) => new Date(p.nextSchedule) > now).length,
      completed: db.maintenance.executions.length,
      compliance: plans.length > 0 ? Math.round((db.maintenance.executions.length / (db.maintenance.executions.length + plans.filter((p) => new Date(p.nextSchedule) < now).length)) * 100) : 100,
    };
  }, [db.maintenance]);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ assetCategory: 'Komputer', laboratoryId: db.labs[0]?.id, frequency: 'bulanan', technician: 'Andi Wijaya', status: 'active', checklist: [], nextSchedule: new Date().toISOString().split('T')[0] });
    setOpen(true);
  }
  function openEdit(p: MaintenancePlan) { if (!canUpdate) return; setEditing(p); setForm(p); setOpen(true); }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.name) { toast('Nama rencana wajib diisi', 'error'); return; }
    const result = mutate((d) => {
      if (editing) {
        const idx = d.maintenance.plans.findIndex((p) => p.id === editing.id);
        if (idx >= 0) d.maintenance.plans[idx] = { ...d.maintenance.plans[idx], ...form } as MaintenancePlan;
      } else {
        d.maintenance.plans.push({ ...form, id: `mp-${Date.now()}` } as MaintenancePlan);
      }
    });
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast(editing ? 'Rencana diperbarui' : 'Rencana ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    const result = mutate((d) => { d.maintenance.plans = d.maintenance.plans.filter((p) => p.id !== confirmDel.id); });
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast('Rencana dihapus', 'success');
    setConfirmDel(null);
  }

  function openExecution(plan?: MaintenancePlan) {
    if (!canCreate) return;
    setExecForm({ laboratoryId: plan?.laboratoryId ?? db.labs[0]?.id, technician: plan?.technician ?? 'Andi Wijaya', date: new Date().toISOString().split('T')[0], checklist: plan?.checklist.map((item) => ({ item, done: false })) ?? [], conditionBefore: 'Baik', conditionAfter: 'Baik', nextSchedule: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0], planId: plan?.id });
    setExecOpen(true);
  }

  function saveExecution() {
    if (!canCreate) return;
    if (!execForm.laboratoryId) { toast('Pilih lab', 'error'); return; }
    const result = mutate((d) => {
      d.maintenance.executions.unshift({ ...execForm, id: `me-${Date.now()}`, assetCode: execForm.assetCode ?? '', findings: execForm.findings ?? '', action: execForm.action ?? '', spareParts: [] } as MaintenanceExecution);
      if (execForm.planId) {
        const idx = d.maintenance.plans.findIndex((p) => p.id === execForm.planId);
        if (idx >= 0) d.maintenance.plans[idx].nextSchedule = execForm.nextSchedule ?? '';
      }
    });
    if (!result.ok) { toast(result.error, 'error'); return; }
    toast('Eksekusi pemeliharaan tersimpan', 'success');
    setExecOpen(false);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('pemeliharaan-berkala.csv', db.maintenance.plans.map((p) => ({ Nama: p.name, Lab: db.labs.find((l) => l.id === p.laboratoryId)?.name, Frekuensi: p.frequency, Teknisi: p.technician, Jadwal: p.nextSchedule, Status: p.status })));
  }

  function addChecklistItem() {
    if (!checklistInput.trim()) return;
    setForm({ ...form, checklist: [...(form.checklist ?? []), checklistInput] });
    setChecklistInput('');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Pemeliharaan Berkala" description="Rencanakan dan catat pekerjaan preventif untuk menjaga kondisi perangkat dan fasilitas." icon={<ShieldCheck className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && tab === 'plans' && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Rencana Pemeliharaan</Button>}
          {canCreate && tab === 'executions' && <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => openExecution()}>Eksekusi Baru</Button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card><CardContent className="flex items-center gap-3"><AlertTriangle className="h-8 w-8 text-danger" /><div><p className="text-2xl font-bold text-ink-primary">{stats.overdue}</p><p className="text-xs text-ink-muted">Overdue</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3"><Clock className="h-8 w-8 text-warning-foreground" /><div><p className="text-2xl font-bold text-ink-primary">{stats.dueSoon}</p><p className="text-xs text-ink-muted">Due Soon</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3"><ShieldCheck className="h-8 w-8 text-accent-content" /><div><p className="text-2xl font-bold text-ink-primary">{stats.scheduled}</p><p className="text-xs text-ink-muted">Scheduled</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3"><CheckCircle2 className="h-8 w-8 text-success-foreground" /><div><p className="text-2xl font-bold text-ink-primary">{stats.completed}</p><p className="text-xs text-ink-muted">Completed</p></div></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{stats.compliance}%</p><p className="text-xs text-ink-muted">Compliance</p></CardContent></Card>
      </div>

      <div className="flex gap-2 border-b border-base-700">
        <button onClick={() => setTab('plans')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'plans' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Rencana Pemeliharaan</button>
        <button onClick={() => setTab('executions')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'executions' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Riwayat Pemeliharaan</button>
      </div>

      {tab === 'plans' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {db.maintenance.plans.length === 0 ? <Card className="lg:col-span-2"><EmptyState title="Belum ada rencana" /></Card> : db.maintenance.plans.map((p) => {
            const overdue = new Date(p.nextSchedule) < new Date();
            return (
              <Card key={p.id} hover>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-ink-primary">{p.name}</p>
                      <p className="text-xs text-ink-muted">{db.labs.find((l) => l.id === p.laboratoryId)?.name} · {p.assetCategory}</p>
                    </div>
                    {overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="success">{p.frequency}</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-ink-muted">Teknisi</span><p className="text-ink-secondary">{p.technician}</p></div>
                    <div><span className="text-ink-muted">Jadwal Berikutnya</span><p className={overdue ? 'text-danger' : 'text-ink-secondary'}>{p.nextSchedule}</p></div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-ink-muted">Checklist ({p.checklist.length})</p>
                    <div className="space-y-1">{p.checklist.slice(0, 3).map((c, i) => <div key={i} className="flex items-center gap-2 text-xs text-ink-secondary"><CheckCircle2 className="h-3 w-3 text-ink-muted" />{c}</div>)}</div>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-base-700/60">
                    {canCreate && <Button size="sm" variant="success" className="flex-1" icon={<Play className="h-3.5 w-3.5" />} onClick={() => openExecution(p)}>Eksekusi</Button>}
                    {canUpdate && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(p)} />}
                    {canDelete && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDel(p)} />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          {db.maintenance.executions.length === 0 ? <EmptyState title="Belum ada eksekusi" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Tanggal</th><th className="px-4 py-3 font-medium">Aset</th><th className="px-4 py-3 font-medium">Teknisi</th><th className="px-4 py-3 font-medium">Temuan</th><th className="px-4 py-3 font-medium">Sebelum</th><th className="px-4 py-3 font-medium">Sesudah</th>
                </tr></thead>
                <tbody>
                  {db.maintenance.executions.map((e) => (
                    <tr key={e.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                      <td className="px-4 py-3 text-ink-primary">{e.date}</td>
                      <td className="px-4 py-3 text-ink-secondary">{e.assetCode}</td>
                      <td className="px-4 py-3 text-ink-secondary">{e.technician}</td>
                      <td className="px-4 py-3 text-ink-secondary max-w-[200px] truncate">{e.findings || '-'}</td>
                      <td className="px-4 py-3"><ConditionBadge condition={e.conditionBefore} /></td>
                      <td className="px-4 py-3"><ConditionBadge condition={e.conditionAfter} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Rencana Pemeliharaan' : 'Rencana Pemeliharaan'} onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Nama Rencana" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <Select label="Lab" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Kategori Aset" value={form.assetCategory ?? ''} onChange={(e) => setForm({ ...form, assetCategory: e.target.value })} />
          <Select label="Frekuensi" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as MaintenanceFrequency })} options={FREQS.map((f) => ({ value: f, label: f }))} />
          <Input label="Teknisi" value={form.technician ?? ''} onChange={(e) => setForm({ ...form, technician: e.target.value })} />
          <Input label="Jadwal Berikutnya" type="date" value={form.nextSchedule ?? ''} onChange={(e) => setForm({ ...form, nextSchedule: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink-secondary">Checklist</p>
            <div className="flex gap-2 mb-2">
              <Input placeholder="Tambah item checklist..." value={checklistInput} onChange={(e) => setChecklistInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())} />
              <Button size="sm" onClick={addChecklistItem}>Tambah</Button>
            </div>
            <div className="space-y-1">
              {(form.checklist ?? []).map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-base-700/60 px-3 py-1.5 text-sm">
                  <span className="text-ink-secondary">{c}</span>
                  <button onClick={() => setForm({ ...form, checklist: form.checklist!.filter((_, idx) => idx !== i) })} className="text-ink-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </FormDialog>

      <FormDialog open={execOpen} onClose={() => setExecOpen(false)} title="Eksekusi Pemeliharaan" onSubmit={saveExecution} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Lab" value={execForm.laboratoryId} onChange={(e) => setExecForm({ ...execForm, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Aset" value={execForm.assetCode ?? ''} onChange={(e) => setExecForm({ ...execForm, assetCode: e.target.value })} />
          <Input label="Teknisi" value={execForm.technician ?? ''} onChange={(e) => setExecForm({ ...execForm, technician: e.target.value })} />
          <Input label="Tanggal" type="date" value={execForm.date ?? ''} onChange={(e) => setExecForm({ ...execForm, date: e.target.value })} />
          <Select label="Kondisi Sebelum" value={execForm.conditionBefore} onChange={(e) => setExecForm({ ...execForm, conditionBefore: e.target.value as AssetCondition })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
          <Select label="Kondisi Sesudah" value={execForm.conditionAfter} onChange={(e) => setExecForm({ ...execForm, conditionAfter: e.target.value as AssetCondition })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
          <Input label="Jadwal Berikutnya" type="date" value={execForm.nextSchedule ?? ''} onChange={(e) => setExecForm({ ...execForm, nextSchedule: e.target.value })} />
          <div className="sm:col-span-2"><Textarea label="Temuan" value={execForm.findings ?? ''} onChange={(e) => setExecForm({ ...execForm, findings: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Tindakan" value={execForm.action ?? ''} onChange={(e) => setExecForm({ ...execForm, action: e.target.value })} /></div>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-ink-secondary">Checklist</p>
            <div className="space-y-1">
              {(execForm.checklist ?? []).map((c, i) => (
                <label key={i} className="flex items-center gap-2 rounded-lg border border-base-700/60 px-3 py-1.5 text-sm">
                  <input type="checkbox" checked={c.done} onChange={(e) => setExecForm({ ...execForm, checklist: execForm.checklist!.map((x, idx) => idx === i ? { ...x, done: e.target.checked } : x) })} className="rounded border-base-600 text-accent-content" />
                  <span className="text-ink-secondary">{c.item}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus rencana ${confirmDel?.name}?`} confirmLabel="Hapus" />
    </div>
  );
}
