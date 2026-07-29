import { useState } from 'react';
import { Wrench, Plus, Play, Pause, Package, Check, Download, KanbanSquare, Table as TableIcon, Calendar } from 'lucide-react';
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
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, formatCurrency, relativeTime, cn } from '@/utils';
import type { WorkOrder, WorkOrderStatus, Priority, WorkOrderSparePart } from '@/types';

const STATUSES: WorkOrderStatus[] = ['Draft', 'Assigned', 'In Progress', 'On Hold', 'Waiting Part', 'Completed', 'Verified', 'Cancelled'];
const PRIORITIES: Priority[] = ['Rendah', 'Normal', 'Tinggi', 'Kritis'];

export function WorkOrdersPage() {
  const { db, mutate } = useAppData();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('work-orders', 'create');
  const canUpdate = usePermission('work-orders', 'update');
  const canUseSparePart = usePermission('stock', 'create');
  const [view, setView] = useState<'table' | 'board' | 'calendar'>('table');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<WorkOrder | null>(null);
  const [partOpen, setPartOpen] = useState<WorkOrder | null>(null);
  const [partForm, setPartForm] = useState<{ stockItemId: string; name: string; quantity: number }>({ stockItemId: '', name: '', quantity: 1 });
  const [form, setForm] = useState<Partial<WorkOrder>>({});

  function openCreate() {
    if (!canCreate) return;
    setForm({ laboratoryId: db.labs[0]?.id, technician: 'Andi Wijaya', priority: 'Normal', scheduledDate: new Date().toISOString().split('T')[0], cost: 0, status: 'Draft' });
    setOpen(true);
  }

  function save() {
    if (!canCreate) return;
    if (!form.laboratoryId) { toast('Pilih lab', 'error'); return; }
    mutate((d) => {
      const num = `WO-2026-${String(d.workOrders.length + 1).padStart(4, '0')}`;
      d.workOrders.unshift({
        id: `wo-${Date.now()}`, woNumber: num, laboratoryId: form.laboratoryId ?? '', technician: form.technician ?? 'Andi Wijaya',
        priority: form.priority ?? 'Normal', diagnosis: form.diagnosis ?? '', action: form.action ?? '', scheduledDate: form.scheduledDate ?? '',
        spareParts: [], cost: form.cost ?? 0, status: form.status ?? 'Draft', notes: form.notes, assetCode: form.assetCode,
        timeline: [{ status: form.status ?? 'Draft', at: new Date().toISOString(), by: user?.name ?? 'Admin' }],
      });
    });
    toast('Work order dibuat', 'success');
    setOpen(false);
  }

  function updateStatus(wo: WorkOrder, status: WorkOrderStatus) {
    if (!canUpdate) return;
    mutate((d) => {
      const idx = d.workOrders.findIndex((w) => w.id === wo.id);
      if (idx >= 0) {
        d.workOrders[idx].status = status;
        d.workOrders[idx].timeline.push({ status, at: new Date().toISOString(), by: user?.name ?? 'Admin' });
        if (status === 'In Progress' && !d.workOrders[idx].startTime) d.workOrders[idx].startTime = new Date().toISOString();
        if ((status === 'Completed' || status === 'Verified') && !d.workOrders[idx].endTime) d.workOrders[idx].endTime = new Date().toISOString();
        // Update asset condition when completed
        if (status === 'Verified' && d.workOrders[idx].assetCode) {
          const aIdx = d.assets.findIndex((a) => a.assetCode === d.workOrders[idx].assetCode);
          if (aIdx >= 0) { d.assets[aIdx].condition = 'Baik'; d.assets[aIdx].status = 'Aktif'; }
          const dvIdx = d.devices.findIndex((dv) => dv.assetCode === d.workOrders[idx].assetCode);
          if (dvIdx >= 0) { d.devices[dvIdx].status = 'Online'; d.devices[dvIdx].lastHeartbeat = new Date().toISOString(); }
        }
      }
    });
    setDetail((d) => d && d.id === wo.id ? { ...d, status } : d);
    toast(`Status diubah menjadi ${status}`, 'success');
  }

  function useSparePart() {
    if (!canUpdate || !canUseSparePart) return;
    if (!partOpen || !partForm.stockItemId || partForm.quantity <= 0) { toast('Lengkapi data spare part', 'error'); return; }
    const item = db.stock.items.find((s) => s.id === partForm.stockItemId);
    if (!item) return;
    if (partForm.quantity > item.quantity) { toast('Stok spare part tidak mencukupi', 'error'); return; }
    mutate((d) => {
      const idx = d.workOrders.findIndex((w) => w.id === partOpen.id);
      if (idx >= 0) {
        const part: WorkOrderSparePart = { stockItemId: partForm.stockItemId, name: item.name, quantity: partForm.quantity };
        d.workOrders[idx].spareParts.push(part);
        d.workOrders[idx].cost += part.quantity * item.price;
        const sIdx = d.stock.items.findIndex((s) => s.id === partForm.stockItemId);
        if (sIdx >= 0) {
          d.stock.items[sIdx].quantity = Math.max(0, d.stock.items[sIdx].quantity - partForm.quantity);
          d.stock.transactions.unshift({ id: `stx-${Date.now()}`, itemId: partForm.stockItemId, type: 'out', quantity: partForm.quantity, date: new Date().toISOString().split('T')[0], reason: `WO ${d.workOrders[idx].woNumber}`, by: d.workOrders[idx].technician });
        }
      }
    });
    toast('Spare part digunakan, stok berkurang', 'success');
    setPartOpen(null);
    setPartForm({ stockItemId: '', name: '', quantity: 1 });
  }

  function exportCSV() {
    downloadCSV('work-order.csv', db.workOrders.map((w) => ({ WO: w.woNumber, Lab: db.labs.find((l) => l.id === w.laboratoryId)?.name, Teknisi: w.technician, Prioritas: w.priority, Status: w.status, Biaya: w.cost })));
  }

  const columns: Column<WorkOrder>[] = [
    { key: 'woNumber', header: 'WO', sortable: true, render: (w) => <button onClick={() => setDetail(w)} className="font-medium text-accent-blue hover:underline">{w.woNumber}</button> },
    { key: 'assetCode', header: 'Aset', render: (w) => w.assetCode ?? '-' },
    { key: 'lab', header: 'Lab', render: (w) => db.labs.find((l) => l.id === w.laboratoryId)?.name },
    { key: 'technician', header: 'Teknisi', sortable: true },
    { key: 'priority', header: 'Prioritas', render: (w) => <PriorityBadge priority={w.priority} /> },
    { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
    { key: 'cost', header: 'Biaya', sortable: true, sortValue: (w) => w.cost, render: (w) => formatCurrency(w.cost) },
  ];

  const boardColumns = STATUSES.filter((s) => db.workOrders.some((w) => w.status === s));

  return (
    <div className="space-y-6">
      <PageHeader title="Work Order Teknisi" description="Manajemen pekerjaan perbaikan teknisi" icon={<Wrench className="h-5 w-5" />}
        actions={<>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>WO Baru</Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {['Assigned', 'In Progress', 'Completed', 'Verified'].map((st) => (
          <Card key={st}><CardContent><p className="text-2xl font-bold text-ink-primary">{db.workOrders.filter((w) => w.status === st).length}</p><p className="text-xs text-ink-muted">{st}</p></CardContent></Card>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-base-700 p-1 w-fit">
        <button onClick={() => setView('table')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === 'table' ? 'bg-accent-blue text-white' : 'text-ink-muted')}><TableIcon className="h-3.5 w-3.5" />Tabel</button>
        <button onClick={() => setView('board')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === 'board' ? 'bg-accent-blue text-white' : 'text-ink-muted')}><KanbanSquare className="h-3.5 w-3.5" />Board</button>
        <button onClick={() => setView('calendar')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium', view === 'calendar' ? 'bg-accent-blue text-white' : 'text-ink-muted')}><Calendar className="h-3.5 w-3.5" />Kalender</button>
      </div>

      {view === 'table' && (
        <Card><DataTable columns={columns} data={db.workOrders} rowKey={(w) => w.id} searchable searchKeys={(w) => `${w.woNumber} ${w.technician} ${w.assetCode} ${w.diagnosis}`} /></Card>
      )}

      {view === 'board' && (
        <div className="grid gap-4 lg:grid-cols-4 xl:grid-cols-6">
          {boardColumns.map((status) => (
            <div key={status} className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-secondary">{status}</p>
                <Badge tone="muted">{db.workOrders.filter((w) => w.status === status).length}</Badge>
              </div>
              <div className="space-y-2">
                {db.workOrders.filter((w) => w.status === status).map((w) => (
                  <button key={w.id} onClick={() => setDetail(w)} className="w-full rounded-xl border border-base-700/70 bg-base-800/60 p-3 text-left transition-all hover:border-base-600 hover:shadow-soft">
                    <p className="font-medium text-ink-primary text-sm">{w.woNumber}</p>
                    <p className="mt-1 text-xs text-ink-muted truncate">{db.labs.find((l) => l.id === w.laboratoryId)?.name}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <PriorityBadge priority={w.priority} />
                      <span className="text-[10px] text-ink-muted">{w.technician}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'calendar' && (
        <Card><CardContent>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted">
            {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 31 }).map((_, i) => {
              const day = i + 1;
              const dayWOs = db.workOrders.filter((w) => w.scheduledDate.endsWith(`-${String(day).padStart(2, '0')}`));
              return (
                <div key={i} className="min-h-[80px] rounded-lg border border-base-700/60 bg-base-800/40 p-1.5">
                  <p className="text-xs text-ink-muted">{day}</p>
                  {dayWOs.slice(0, 2).map((w) => (
                    <button key={w.id} onClick={() => setDetail(w)} className="mt-1 block w-full truncate rounded bg-accent-blue/15 px-1.5 py-0.5 text-[10px] text-accent-blue hover:bg-accent-blue/25">{w.woNumber}</button>
                  ))}
                </div>
              );
            })}
          </div>
        </CardContent></Card>
      )}

      <FormDialog open={open} onClose={() => setOpen(false)} title="Work Order Baru" onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Lab" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Aset (opsional)" value={form.assetCode ?? ''} onChange={(e) => setForm({ ...form, assetCode: e.target.value })} />
          <Select label="Teknisi" value={form.technician} onChange={(e) => setForm({ ...form, technician: e.target.value })} options={['Andi Wijaya', 'Dedi Kurniawan'].map((t) => ({ value: t, label: t }))} />
          <Select label="Prioritas" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} options={PRIORITIES.map((p) => ({ value: p, label: p }))} />
          <Input label="Jadwal" type="date" value={form.scheduledDate ?? ''} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as WorkOrderStatus })} options={STATUSES.map((s) => ({ value: s, label: s }))} />
          <div className="sm:col-span-2"><Textarea label="Diagnosis" value={form.diagnosis ?? ''} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Tindakan" value={form.action ?? ''} onChange={(e) => setForm({ ...form, action: e.target.value })} /></div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.woNumber} description={detail ? `${db.labs.find((l) => l.id === detail.laboratoryId)?.name} · ${detail.technician}` : ''} width="max-w-xl">
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} />
              <PriorityBadge priority={detail.priority} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">Aset</p><p className="text-ink-primary">{detail.assetCode || '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Jadwal</p><p className="text-ink-primary">{detail.scheduledDate}</p></div>
              <div><p className="text-xs text-ink-muted">Mulai</p><p className="text-ink-primary">{detail.startTime ? relativeTime(detail.startTime) : '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Selesai</p><p className="text-ink-primary">{detail.endTime ? relativeTime(detail.endTime) : '-'}</p></div>
              {detail.downtimeHours !== undefined && <div><p className="text-xs text-ink-muted">Downtime</p><p className="text-ink-primary">{detail.downtimeHours} jam</p></div>}
              <div><p className="text-xs text-ink-muted">Biaya</p><p className="text-ink-primary">{formatCurrency(detail.cost)}</p></div>
            </div>
            {detail.diagnosis && <div><p className="text-xs text-ink-muted">Diagnosis</p><p className="text-sm text-ink-secondary">{detail.diagnosis}</p></div>}
            {detail.action && <div><p className="text-xs text-ink-muted">Tindakan</p><p className="text-sm text-ink-secondary">{detail.action}</p></div>}
            {detail.testResult && <div><p className="text-xs text-ink-muted">Hasil Pengujian</p><p className="text-sm text-emerald-400">{detail.testResult}</p></div>}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Spare Parts ({detail.spareParts.length})</p>
              {detail.spareParts.length === 0 ? <p className="text-xs text-ink-muted">Belum ada spare part</p> : (
                <div className="space-y-1">{detail.spareParts.map((p, i) => <div key={i} className="flex justify-between rounded-lg border border-base-700/60 p-2 text-sm"><span className="text-ink-secondary">{p.name}</span><span className="text-ink-muted">{p.quantity} pcs</span></div>)}</div>
              )}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline</p>
              <ActivityTimeline items={detail.timeline.map((t) => ({ label: t.status, by: t.by, at: relativeTime(t.at), tone: 'accent' as const }))} />
            </div>

            <div className="space-y-2 border-t border-base-700 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Aksi</p>
              <div className="flex flex-wrap gap-2">
                {canUpdate && detail.status === 'Assigned' && <Button size="sm" variant="warning" icon={<Play className="h-4 w-4" />} onClick={() => updateStatus(detail, 'In Progress')}>Mulai</Button>}
                {canUpdate && detail.status === 'In Progress' && <Button size="sm" variant="secondary" icon={<Pause className="h-4 w-4" />} onClick={() => updateStatus(detail, 'On Hold')}>Pause</Button>}
                {canUpdate && canUseSparePart && <Button size="sm" variant="secondary" icon={<Package className="h-4 w-4" />} onClick={() => { setPartOpen(detail); setPartForm({ stockItemId: '', name: '', quantity: 1 }); }}>Gunakan Spare Part</Button>}
                {canUpdate && !['Completed', 'Verified', 'Cancelled'].includes(detail.status) && <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => updateStatus(detail, 'Completed')}>Selesai</Button>}
                {canUpdate && detail.status === 'Completed' && <Button size="sm" variant="success" onClick={() => updateStatus(detail, 'Verified')}>Verifikasi</Button>}
                {canUpdate && <Select value="" onChange={(e) => e.target.value && updateStatus(detail, e.target.value as WorkOrderStatus)} options={STATUSES.filter((s) => s !== detail.status).map((s) => ({ value: s, label: `Ubah ke ${s}` }))} placeholder="Ubah Status" />}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <FormDialog open={Boolean(partOpen)} onClose={() => setPartOpen(null)} title="Gunakan Spare Part" onSubmit={useSparePart} size="md" submitLabel="Gunakan">
        <div className="space-y-4">
          <Select label="Spare Part" value={partForm.stockItemId} onChange={(e) => setPartForm({ ...partForm, stockItemId: e.target.value })} options={db.stock.items.map((s) => ({ value: s.id, label: `${s.name} (stok: ${s.quantity} ${s.unit})` }))} />
          <Input label="Jumlah" type="number" value={partForm.quantity} onChange={(e) => setPartForm({ ...partForm, quantity: Number(e.target.value) })} />
        </div>
      </FormDialog>
    </div>
  );
}
