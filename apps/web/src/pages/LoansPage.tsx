import { useMemo, useState } from 'react';
import { HandHelping, Plus, Download, Check, RotateCcw, AlertTriangle, Printer } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge, ConditionBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import type { Loan, AssetCondition } from '@/types';

const CONDITIONS: AssetCondition[] = ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'];

export function LoansPage() {
  const { db, mutate } = useAppData();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('loans', 'create');
  const canUpdate = usePermission('loans', 'update');
  const canApprove = usePermission('loans', 'approve');
  const canExport = usePermission('loans', 'export');
  const canCreateIncident = usePermission('incidents', 'create');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Loan | null>(null);
  const [returnOpen, setReturnOpen] = useState<Loan | null>(null);
  const [returnForm, setReturnForm] = useState<{ condition: AssetCondition; notes: string; createIncident: boolean }>({ condition: 'Baik', notes: '', createIncident: false });
  const [form, setForm] = useState<Partial<Loan>>({});

  const stats = useMemo(() => ({
    active: db.loans.filter((l) => ['Dipinjam', 'Diserahkan', 'Terlambat'].includes(l.status)).length,
    overdue: db.loans.filter((l) => l.status === 'Terlambat' || (l.status === 'Dipinjam' && new Date(l.plannedReturn) < new Date())).length,
    returned: db.loans.filter((l) => ['Dikembalikan', 'Diperiksa', 'Selesai'].includes(l.status)).length,
  }), [db.loans]);

  function openCreate() {
    if (!canCreate) return;
    setForm({ borrowerName: '', unitOrClass: '', itemName: '', quantity: 1, borrowDate: new Date().toISOString().split('T')[0], plannedReturn: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0], conditionOut: 'Baik', status: 'Diajukan', PIC: user?.name ?? '' });
    setOpen(true);
  }

  function save() {
    if (!canCreate) return;
    if (!form.itemName || !form.borrowerName) { toast('Nama barang dan peminjam wajib diisi', 'error'); return; }
    mutate((d) => {
      d.loans.push({ ...form, id: `loan-${Date.now()}` } as Loan);
    });
    toast('Peminjaman diajukan', 'success');
    setOpen(false);
  }

  function approve(l: Loan) {
    if (!canApprove) return;
    mutate((d) => {
      const idx = d.loans.findIndex((x) => x.id === l.id);
      if (idx >= 0) d.loans[idx].status = 'Disetujui';
    });
    toast('Peminjaman disetujui', 'success');
    setDetail(null);
  }

  function handover(l: Loan) {
    if (!canApprove) return;
    mutate((d) => {
      const idx = d.loans.findIndex((x) => x.id === l.id);
      if (idx >= 0) d.loans[idx].status = 'Dipinjam';
    });
    toast('Barang diserahkan', 'success');
    setDetail(null);
  }

  function openReturn(l: Loan) {
    if (!canUpdate) return;
    setReturnOpen(l);
    setReturnForm({ condition: 'Baik', notes: '', createIncident: false });
  }

  function doReturn() {
    if (!returnOpen || !canUpdate) return;
    mutate((d) => {
      const idx = d.loans.findIndex((x) => x.id === returnOpen.id);
      if (idx >= 0) {
        d.loans[idx].status = 'Diperiksa';
        d.loans[idx].actualReturn = new Date().toISOString().split('T')[0];
        d.loans[idx].conditionReturn = returnForm.condition;
        if (returnForm.notes) d.loans[idx].notes = returnForm.notes;
        if (returnForm.createIncident && canCreateIncident && returnForm.condition !== 'Baik') {
          const num = `INC-2026-${String(d.incidents.length + 1).padStart(4, '0')}`;
          d.incidents.unshift({
            id: `inc-${Date.now()}`, ticketNumber: num, reporterName: user?.name ?? 'Admin', laboratoryId: '',
            date: new Date().toISOString(), category: 'periferal', title: `Kerusakan saat pengembalian ${returnOpen.itemName}`,
            description: `Kondisi: ${returnForm.condition}. ${returnForm.notes}`, impact: 'Perlu evaluasi', priority: 'Normal',
            blocksPracticum: false, stepsTaken: 'Ditemukan saat pemeriksaan pengembalian', status: 'Dilaporkan', comments: [],
            timeline: [{ status: 'Dilaporkan', at: new Date().toISOString(), by: user?.name ?? 'Admin' }],
          });
        }
      }
    });
    toast('Pengembalian dicatat' + (returnForm.createIncident && canCreateIncident && returnForm.condition !== 'Baik' ? ', incident dibuat' : ''), 'success');
    setReturnOpen(null);
    setDetail(null);
  }

  function markOverdue(l: Loan) {
    if (!canUpdate) return;
    mutate((d) => {
      const idx = d.loans.findIndex((x) => x.id === l.id);
      if (idx >= 0) d.loans[idx].status = 'Terlambat';
    });
    toast('Ditandai terlambat', 'info');
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('peminjaman.csv', db.loans.map((l) => ({ Peminjam: l.borrowerName, Barang: l.itemName, Jumlah: l.quantity, Pinjam: l.borrowDate, RencanaKembali: l.plannedReturn, Status: l.status })));
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Peminjaman dan Serah Terima" description="Manajemen peminjaman barang laboratorium" icon={<HandHelping className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Pinjam Baru</Button>}
        </>}
      />
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent><p className="text-2xl font-bold text-accent-blue">{stats.active}</p><p className="text-xs text-ink-muted">Aktif Dipinjam</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-danger">{stats.overdue}</p><p className="text-xs text-ink-muted">Terlambat</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-emerald-400">{stats.returned}</p><p className="text-xs text-ink-muted">Dikembalikan</p></CardContent></Card>
      </div>

      {stats.overdue > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4" /> {stats.overdue} peminjaman terlambat
        </div>
      )}

      <Card>
        {db.loans.length === 0 ? <EmptyState title="Belum ada peminjaman" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                <th className="px-4 py-3 font-medium">Peminjam</th><th className="px-4 py-3 font-medium">Barang</th><th className="px-4 py-3 font-medium">Jumlah</th><th className="px-4 py-3 font-medium">Pinjam</th><th className="px-4 py-3 font-medium">Rencana Kembali</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Aksi</th>
              </tr></thead>
              <tbody>
                {db.loans.map((l) => {
                  const isOverdue = l.status === 'Dipinjam' && new Date(l.plannedReturn) < new Date();
                  return (
                    <tr key={l.id} className="border-b border-base-700/40 hover:bg-base-700/30 cursor-pointer" onClick={() => setDetail(l)}>
                      <td className="px-4 py-3 text-ink-primary">{l.borrowerName}</td>
                      <td className="px-4 py-3 text-ink-secondary">{l.itemName}</td>
                      <td className="px-4 py-3 text-ink-secondary">{l.quantity}</td>
                      <td className="px-4 py-3 text-ink-secondary">{l.borrowDate}</td>
                      <td className="px-4 py-3"><span className={isOverdue ? 'text-danger' : 'text-ink-secondary'}>{l.plannedReturn}</span></td>
                      <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {canUpdate && l.status === 'Dipinjam' && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => openReturn(l)}>Kembali</Button>}
                          {canUpdate && isOverdue && l.status === 'Dipinjam' && <button onClick={() => markOverdue(l)} className="rounded p-1 text-danger hover:bg-danger/10" title="Tandai terlambat"><AlertTriangle className="h-4 w-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title="Peminjaman Baru" onSubmit={save} size="md">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Peminjam" value={form.borrowerName ?? ''} onChange={(e) => setForm({ ...form, borrowerName: e.target.value })} />
          <Input label="Unit/Kelas" value={form.unitOrClass ?? ''} onChange={(e) => setForm({ ...form, unitOrClass: e.target.value })} />
          <div className="sm:col-span-2"><Input label="Barang" value={form.itemName ?? ''} onChange={(e) => setForm({ ...form, itemName: e.target.value })} /></div>
          <Input label="Jumlah" type="number" value={form.quantity ?? 1} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          <Input label="Penanggung Jawab" value={form.PIC ?? ''} onChange={(e) => setForm({ ...form, PIC: e.target.value })} />
          <Input label="Tanggal Pinjam" type="date" value={form.borrowDate ?? ''} onChange={(e) => setForm({ ...form, borrowDate: e.target.value })} />
          <Input label="Rencana Kembali" type="date" value={form.plannedReturn ?? ''} onChange={(e) => setForm({ ...form, plannedReturn: e.target.value })} />
          <Select label="Kondisi Keluar" value={form.conditionOut} onChange={(e) => setForm({ ...form, conditionOut: e.target.value as AssetCondition })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
          <div className="sm:col-span-2"><Textarea label="Tujuan" value={form.purpose ?? ''} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.itemName} description={detail?.borrowerName} width="max-w-lg">
        {detail && (
          <div className="space-y-4 text-sm">
            <StatusBadge status={detail.status} />
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Peminjam</p><p className="text-ink-primary">{detail.borrowerName}</p></div>
              <div><p className="text-xs text-ink-muted">Unit/Kelas</p><p className="text-ink-primary">{detail.unitOrClass}</p></div>
              <div><p className="text-xs text-ink-muted">Jumlah</p><p className="text-ink-primary">{detail.quantity}</p></div>
              <div><p className="text-xs text-ink-muted">PIC</p><p className="text-ink-primary">{detail.PIC}</p></div>
              <div><p className="text-xs text-ink-muted">Pinjam</p><p className="text-ink-primary">{detail.borrowDate}</p></div>
              <div><p className="text-xs text-ink-muted">Rencana Kembali</p><p className="text-ink-primary">{detail.plannedReturn}</p></div>
              <div><p className="text-xs text-ink-muted">Kondisi Keluar</p><ConditionBadge condition={detail.conditionOut} /></div>
              {detail.conditionReturn && <div><p className="text-xs text-ink-muted">Kondisi Kembali</p><ConditionBadge condition={detail.conditionReturn} /></div>}
            </div>
            {detail.purpose && <div><p className="text-xs text-ink-muted">Tujuan</p><p className="text-ink-secondary">{detail.purpose}</p></div>}
            {detail.notes && <div><p className="text-xs text-ink-muted">Catatan</p><p className="text-ink-secondary">{detail.notes}</p></div>}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-base-700">
              {canApprove && detail.status === 'Diajukan' && <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => approve(detail)}>Setujui</Button>}
              {canApprove && detail.status === 'Disetujui' && <Button size="sm" onClick={() => handover(detail)}>Serahkan</Button>}
              {canUpdate && detail.status === 'Dipinjam' && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => openReturn(detail)}>Kembalikan</Button>}
              {canExport && <Button size="sm" variant="ghost" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Cetak Bukti</Button>}
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={Boolean(returnOpen)} onClose={() => setReturnOpen(null)} title="Pengembalian Barang" size="md">
        {returnOpen && (
          <div className="space-y-4">
            <div className="rounded-lg border border-base-700 bg-base-800/60 p-3 text-sm">
              <p className="text-ink-muted">Barang</p>
              <p className="text-ink-primary">{returnOpen.itemName} ({returnOpen.quantity})</p>
              <p className="mt-2 text-ink-muted">Peminjam</p>
              <p className="text-ink-primary">{returnOpen.borrowerName}</p>
            </div>
            <Select label="Kondisi Kembali" value={returnForm.condition} onChange={(e) => setReturnForm({ ...returnForm, condition: e.target.value as AssetCondition })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
            <Textarea label="Catatan" value={returnForm.notes} onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })} />
            {canCreateIncident && returnForm.condition !== 'Baik' && (
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input type="checkbox" checked={returnForm.createIncident} onChange={(e) => setReturnForm({ ...returnForm, createIncident: e.target.checked })} className="rounded border-base-600 text-accent-blue" />
                Buat incident dari kerusakan ini
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReturnOpen(null)}>Batal</Button>
              <Button onClick={doReturn}>Kembalikan</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
