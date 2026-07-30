import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, CalendarDays, Plus, Check, X, Eye, Download } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import type { Booking } from '@/types';

export function BookingsPage() {
  const { db, mutate } = useAppData();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('bookings', 'create');
  const canApprove = usePermission('bookings', 'approve');
  const canExport = usePermission('bookings', 'export');
  const canViewSchedules = usePermission('schedules', 'view');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [rejectOpen, setRejectOpen] = useState<Booking | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [form, setForm] = useState<Partial<Booking>>({});

  function openCreate() {
    setForm({ requesterName: user?.name ?? '', laboratoryId: db.labs[0]?.id, date: new Date().toISOString().split('T')[0], startTime: '13:00', endTime: '15:00', participants: 30, status: 'Diajukan', PIC: user?.name ?? '' });
    setOpen(true);
  }

  function checkConflict(input: Partial<Booking>): string | null {
    const conflict = db.bookings.find((b) => {
      if (b.id === detail?.id) return false;
      if (b.laboratoryId !== input.laboratoryId) return false;
      if (b.date !== input.date) return false;
      if (b.startTime < input.endTime! && b.endTime > input.startTime!) {
        return ['Disetujui', 'Menunggu Persetujuan', 'Diajukan'].includes(b.status);
      }
      return false;
    });
    return conflict ? `Bentrok dengan "${conflict.activity}" (${conflict.startTime}-${conflict.endTime})` : null;
  }

  function save() {
    if (!form.laboratoryId || !form.activity || !form.date) {
      toast('Lengkapi field wajib', 'error');
      return;
    }
    const conflict = checkConflict(form);
    if (conflict) {
      toast(conflict, 'error');
      return;
    }
    mutate((d) => {
      d.bookings.push({
        id: `bkg-${Date.now()}`,
        requesterName: form.requesterName ?? '',
        laboratoryId: form.laboratoryId ?? '',
        date: form.date ?? '',
        startTime: form.startTime ?? '',
        endTime: form.endTime ?? '',
        activity: form.activity ?? '',
        participants: form.participants ?? 0,
        deviceNeeds: form.deviceNeeds ?? '',
        notes: form.notes,
        PIC: form.PIC ?? '',
        status: 'Diajukan',
        timeline: [{ status: 'Diajukan', at: new Date().toISOString(), by: form.requesterName ?? 'User' }],
      });
    });
    toast('Reservasi diajukan', 'success');
    setOpen(false);
  }

  function approve(b: Booking) {
    mutate((d) => {
      const idx = d.bookings.findIndex((x) => x.id === b.id);
      if (idx >= 0) {
        d.bookings[idx].status = 'Disetujui';
        d.bookings[idx].timeline.push({ status: 'Disetujui', at: new Date().toISOString(), by: user?.name ?? 'Admin' });
      }
    });
    setDetail(null);
    toast('Reservasi disetujui', 'success');
  }

  function reject() {
    if (!rejectOpen) return;
    mutate((d) => {
      const idx = d.bookings.findIndex((x) => x.id === rejectOpen.id);
      if (idx >= 0) {
        d.bookings[idx].status = 'Ditolak';
        d.bookings[idx].rejectionReason = rejectReason;
        d.bookings[idx].timeline.push({ status: 'Ditolak', at: new Date().toISOString(), by: user?.name ?? 'Admin' });
      }
    });
    toast('Reservasi ditolak', 'info');
    setRejectOpen(null);
    setRejectReason('');
    setDetail(null);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('booking-lab.csv', db.bookings.map((b) => ({
      Pemohon: b.requesterName, Lab: db.labs.find((l) => l.id === b.laboratoryId)?.name, Tanggal: b.date, Jam: `${b.startTime}-${b.endTime}`, Kegiatan: b.activity, Status: b.status,
    })));
  }

  const pendingCount = db.bookings.filter((b) => b.status === 'Menunggu Persetujuan' || b.status === 'Diajukan').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservasi Lab"
        description="Pengajuan penggunaan laboratorium pada tanggal tertentu untuk kegiatan insidental, tambahan, atau kegiatan resmi sekolah."
        icon={<CalendarClock className="h-5 w-5" />}
        actions={
          <>
            {canViewSchedules && <Button variant="secondary" size="sm" icon={<CalendarDays className="h-4 w-4" />} onClick={() => navigate('/schedules')}>Jadwal Reguler</Button>}
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Ajukan Reservasi</Button>}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">Reservasi Lab digunakan untuk penggunaan bertanggal dan tidak menggantikan definisi Jadwal Reguler.</p>
          {canViewSchedules && <Button variant="secondary" size="sm" onClick={() => navigate('/schedules')}>Buka Jadwal Reguler</Button>}
        </CardContent>
      </Card>

      {pendingCount > 0 && canApprove && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <CalendarClock className="h-4 w-4" />
          {pendingCount} reservasi menunggu persetujuan Anda
        </div>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-base-700 text-left text-ink-muted">
              <th className="px-4 py-3 font-medium">Pemohon</th><th className="px-4 py-3 font-medium">Lab</th><th className="px-4 py-3 font-medium">Tanggal</th><th className="px-4 py-3 font-medium">Jam</th><th className="px-4 py-3 font-medium">Kegiatan</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Aksi</th>
            </tr></thead>
            <tbody>
              {db.bookings.length === 0 ? (
                <tr><td colSpan={7}><EmptyState title="Belum ada reservasi" className="py-10" /></td></tr>
              ) : db.bookings.map((b) => (
                <tr key={b.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                  <td className="px-4 py-3 text-ink-primary">{b.requesterName}</td>
                  <td className="px-4 py-3 text-ink-secondary">{db.labs.find((l) => l.id === b.laboratoryId)?.name}</td>
                  <td className="px-4 py-3 text-ink-secondary">{b.date}</td>
                  <td className="px-4 py-3 text-ink-secondary">{b.startTime} - {b.endTime}</td>
                  <td className="px-4 py-3 text-ink-secondary">{b.activity}</td>
                  <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <button onClick={() => setDetail(b)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Eye className="h-4 w-4" /></button>
                    {canApprove && (b.status === 'Menunggu Persetujuan' || b.status === 'Diajukan') && (
                      <>
                        <button onClick={() => approve(b)} className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10"><Check className="h-4 w-4" /></button>
                        <button onClick={() => { setRejectOpen(b); setRejectReason(''); }} className="rounded p-1 text-danger hover:bg-danger/10"><X className="h-4 w-4" /></button>
                      </>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title="Ajukan Reservasi Lab" onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Pemohon" value={form.requesterName ?? ''} onChange={(e) => setForm({ ...form, requesterName: e.target.value })} />
          <Select label="Laboratorium" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Tanggal" type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Jam Mulai" type="time" value={form.startTime ?? ''} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          <Input label="Jam Selesai" type="time" value={form.endTime ?? ''} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          <Input label="Peserta" type="number" value={form.participants ?? 0} onChange={(e) => setForm({ ...form, participants: Number(e.target.value) })} />
          <div className="sm:col-span-2">
            <Input label="Kegiatan" value={form.activity ?? ''} onChange={(e) => setForm({ ...form, activity: e.target.value })} />
          </div>
          <Input label="Kebutuhan Perangkat" value={form.deviceNeeds ?? ''} onChange={(e) => setForm({ ...form, deviceNeeds: e.target.value })} />
          <Input label="Penanggung Jawab" value={form.PIC ?? ''} onChange={(e) => setForm({ ...form, PIC: e.target.value })} />
          <div className="sm:col-span-2">
            <Textarea label="Catatan" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.activity} description={`${detail?.requesterName} · ${detail?.date}`} width="max-w-lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">Laboratorium</p><p className="text-ink-primary">{db.labs.find((l) => l.id === detail.laboratoryId)?.name}</p></div>
              <div><p className="text-xs text-ink-muted">Jam</p><p className="text-ink-primary">{detail.startTime} - {detail.endTime}</p></div>
              <div><p className="text-xs text-ink-muted">Peserta</p><p className="text-ink-primary">{detail.participants} orang</p></div>
              <div><p className="text-xs text-ink-muted">PIC</p><p className="text-ink-primary">{detail.PIC}</p></div>
              <div className="col-span-2"><p className="text-xs text-ink-muted">Kebutuhan Perangkat</p><p className="text-ink-primary">{detail.deviceNeeds || '-'}</p></div>
              <div className="col-span-2"><p className="text-xs text-ink-muted">Catatan</p><p className="text-ink-primary">{detail.notes || '-'}</p></div>
              {detail.rejectionReason && <div className="col-span-2"><p className="text-xs text-ink-muted">Alasan Penolakan</p><p className="text-danger">{detail.rejectionReason}</p></div>}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline Status</p>
              <ActivityTimeline items={detail.timeline.map((t) => ({ label: t.status, by: t.by, at: relativeTime(t.at), tone: 'accent' as const }))} />
            </div>
            {canApprove && (detail.status === 'Menunggu Persetujuan' || detail.status === 'Diajukan') && (
              <div className="flex gap-2 pt-2">
                <Button variant="success" size="sm" icon={<Check className="h-4 w-4" />} onClick={() => approve(detail)} className="flex-1">Setujui</Button>
                <Button variant="danger" size="sm" icon={<X className="h-4 w-4" />} onClick={() => { setRejectOpen(detail); setRejectReason(''); }} className="flex-1">Tolak</Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={Boolean(rejectOpen)} onClose={() => setRejectOpen(null)} title="Tolak Reservasi" size="sm">
        <Textarea label="Alasan Penolakan" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Masukkan alasan penolakan..." />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejectOpen(null)}>Batal</Button>
          <Button variant="danger" onClick={reject}>Tolak Reservasi</Button>
        </div>
      </Modal>
    </div>
  );
}
