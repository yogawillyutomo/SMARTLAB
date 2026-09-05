import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Plus, Check, X, Eye, Download, Ban, ShieldCheck, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { hasServerPermission } from '@/lib/authIdentity';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import { ApiClientError } from '@/lib/apiClient';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  laboratoryAvailabilityGateway,
  LaboratoryAvailabilityContractError,
  type LaboratoryAvailabilityDto,
} from '@/services/laboratoryAvailabilityApi';
import {
  laboratoryReservationGateway,
  LaboratoryReservationContractError,
  type CreateLaboratoryReservationInput,
  type LaboratoryReservationDto,
  type LaboratoryReservationStatus,
} from '@/services/laboratoryReservationApi';

const STATUS_OPTIONS: { value: 'all' | LaboratoryReservationStatus; label: string }[] = [
  { value: 'all', label: 'Semua status' },
  { value: 'submitted', label: 'Diajukan' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'cancelled', label: 'Dibatalkan' },
];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  return { from: dateKey(addDays(today, -30)), to: dateKey(addDays(today, 180)) };
}

function defaultForm(userName: string, laboratoryId?: string): CreateLaboratoryReservationInput {
  return {
    laboratoryId: laboratoryId ?? '',
    date: dateKey(new Date()),
    startsAt: '13:00',
    endsAt: '15:00',
    activity: '',
    participants: 30,
    deviceNeeds: null,
    notes: null,
    picName: userName,
  };
}

function issueMessage(error: unknown): string {
  if (error instanceof LaboratoryReservationContractError) return 'Respons reservasi dari server tidak sesuai kontrak.';
  if (error instanceof LaboratoryAvailabilityContractError) return 'Respons availability dari server tidak sesuai kontrak.';
  if (error instanceof ApiClientError) {
    if (error.code === 'LABORATORY_RESERVATION_VERSION_CONFLICT') return 'Reservasi sudah berubah di server. Data terbaru telah dimuat ulang.';
    if (error.code === 'LABORATORY_RESERVATION_UNAVAILABLE') return 'Slot tidak lagi tersedia. Jadwal, closure, atau reservasi lain mungkin berubah.';
    if (error.code === 'LABORATORY_RESERVATION_STATE_CONFLICT') return 'Status reservasi tidak lagi mendukung aksi tersebut.';
    if (error.status === 403) return 'Anda tidak memiliki izin untuk aksi reservasi ini.';
    if (error.status === 422) return Object.values(error.errors ?? {}).flat()[0] ?? 'Data reservasi belum valid.';
    if (error.kind === 'network') return 'Layanan reservasi tidak dapat dijangkau.';
  }
  return 'Operasi reservasi gagal.';
}

function availabilityLabel(value: LaboratoryAvailabilityDto): { tone: 'success' | 'danger' | 'warning'; label: string } {
  if (value.available) return { tone: 'success', label: 'Slot tersedia' };
  if (value.state === 'unknown') return { tone: 'warning', label: 'Belum dapat dipastikan' };
  return { tone: 'danger', label: 'Slot tidak tersedia' };
}

function timelineLabel(event: LaboratoryReservationDto['timeline'][number]): string {
  const labels: Record<string, string> = {
    'reservation.submitted': 'Reservasi diajukan',
    'reservation.approved': 'Reservasi disetujui',
    'reservation.rejected': 'Reservasi ditolak',
    'reservation.cancelled': 'Reservasi dibatalkan',
  };
  const reason = typeof event.payload.reason === 'string' ? event.payload.reason : null;
  return reason ? `${labels[event.eventType] ?? event.eventType} — ${reason}` : (labels[event.eventType] ?? event.eventType);
}

export function BookingsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'bookings.create');
  const canApprove = hasServerPermission(user, 'bookings.approve');
  const canCancel = hasServerPermission(user, 'bookings.cancel');
  const canExport = hasServerPermission(user, 'bookings.export');
  const canViewAll = hasServerPermission(user, 'bookings.view-all');
  const canViewSchedules = hasServerPermission(user, 'schedules.view');

  const initialRange = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [statusFilter, setStatusFilter] = useState<'all' | LaboratoryReservationStatus>('all');
  const [reservations, setReservations] = useState<LaboratoryReservationDto[]>([]);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LaboratoryReservationDto | null>(null);
  const [form, setForm] = useState<CreateLaboratoryReservationInput>(() => defaultForm(user?.name ?? ''));
  const [checking, setChecking] = useState(false);
  const [availabilityPreview, setAvailabilityPreview] = useState<LaboratoryAvailabilityDto | null>(null);

  const [rejectOpen, setRejectOpen] = useState<LaboratoryReservationDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState<LaboratoryReservationDto | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const reservationPromise = laboratoryReservationGateway.listAll({
        from,
        to,
        scope: canViewAll ? 'all' : 'mine',
      });
      const labsPromise = canCreate ? laboratoryGateway.list() : Promise.resolve([]);
      const [items, laboratoryItems] = await Promise.all([reservationPromise, labsPromise]);
      setReservations(items);
      setLabs(laboratoryItems.filter((lab) => lab.status === 'active'));
    } catch (err) {
      setError(issueMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canCreate, canViewAll, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayed = useMemo(
    () => reservations.filter((reservation) => statusFilter === 'all' || reservation.status === statusFilter),
    [reservations, statusFilter],
  );

  const pendingCount = reservations.filter((reservation) => reservation.status === 'submitted').length;

  function openCreate(): void {
    const firstLab = labs[0]?.id ?? '';
    setForm(defaultForm(user?.name ?? '', firstLab));
    setAvailabilityPreview(null);
    setOpen(true);
  }

  async function checkAvailability(): Promise<LaboratoryAvailabilityDto | null> {
    if (!form.laboratoryId || !form.date || !form.startsAt || !form.endsAt || form.startsAt >= form.endsAt) {
      toast('Pilih lab serta window waktu yang valid.', 'error');
      return null;
    }

    setChecking(true);
    try {
      const result = await laboratoryAvailabilityGateway.check({
        laboratoryId: form.laboratoryId,
        date: form.date,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
      });
      setAvailabilityPreview(result);
      return result;
    } catch (err) {
      toast(issueMessage(err), 'error');
      return null;
    } finally {
      setChecking(false);
    }
  }

  async function save(): Promise<void> {
    if (!canCreate) return;
    if (!form.laboratoryId || !form.activity.trim() || !form.picName.trim() || form.participants < 1) {
      toast('Lengkapi field wajib.', 'error');
      return;
    }

    const availability = await checkAvailability();
    if (!availability?.available) {
      toast(availability?.state === 'unknown' ? 'Slot belum dapat dipastikan aman.' : 'Slot sedang terpakai atau terblokir.', 'error');
      return;
    }

    try {
      await laboratoryReservationGateway.create({
        ...form,
        activity: form.activity.trim(),
        picName: form.picName.trim(),
        deviceNeeds: form.deviceNeeds?.trim() || null,
        notes: form.notes?.trim() || null,
      });
      toast('Reservasi diajukan dan slot ditahan sampai diputuskan.', 'success');
      setOpen(false);
      setAvailabilityPreview(null);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    }
  }

  async function approve(reservation: LaboratoryReservationDto): Promise<void> {
    if (!canApprove) return;
    try {
      await laboratoryReservationGateway.approve(reservation.id, reservation.version);
      toast('Reservasi disetujui setelah availability dicek ulang.', 'success');
      setDetail(null);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      setDetail(null);
      await load();
    }
  }

  async function reject(): Promise<void> {
    if (!rejectOpen || !canApprove || !rejectReason.trim()) {
      if (!rejectReason.trim()) toast('Alasan penolakan wajib diisi.', 'error');
      return;
    }
    try {
      await laboratoryReservationGateway.reject(rejectOpen.id, rejectOpen.version, rejectReason.trim());
      toast('Reservasi ditolak dan slot dilepaskan.', 'success');
      setRejectOpen(null);
      setRejectReason('');
      setDetail(null);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    }
  }

  async function cancelReservation(): Promise<void> {
    if (!cancelOpen || !canCancel || !cancelReason.trim()) {
      if (!cancelReason.trim()) toast('Alasan pembatalan wajib diisi.', 'error');
      return;
    }
    try {
      await laboratoryReservationGateway.cancel(cancelOpen.id, cancelOpen.version, cancelReason.trim());
      toast('Reservasi dibatalkan dan slot dilepaskan.', 'success');
      setCancelOpen(null);
      setCancelReason('');
      setDetail(null);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    }
  }

  function canCancelReservation(reservation: LaboratoryReservationDto): boolean {
    return canCancel
      && ['submitted', 'approved'].includes(reservation.status)
      && (canViewAll || reservation.requester.membershipId === user?.membership.id);
  }

  function exportCSV(): void {
    if (!canExport) return;
    downloadCSV('reservasi-lab.csv', displayed.map((reservation) => ({
      Nomor: reservation.reservationNumber,
      Pemohon: reservation.requester.name,
      Lab: reservation.laboratory.name,
      Tanggal: reservation.date,
      Jam: `${reservation.startsAt.slice(0, 5)}-${reservation.endsAt.slice(0, 5)}`,
      Kegiatan: reservation.activity,
      Peserta: reservation.participants,
      PIC: reservation.picName,
      Status: reservation.status,
    })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservasi Lab"
        description="Pengajuan penggunaan laboratorium bertanggal dengan availability canonical dan approval yang dicek ulang secara transaksional."
        icon={<CalendarClock className="h-5 w-5" />}
        actions={(
          <>
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Ajukan Reservasi</Button>}
          </>
        )}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink-primary">Reservasi tidak mengubah Jadwal Reguler TESSELA.</p>
            <p className="mt-1 text-xs text-ink-muted">Status Diajukan sudah menahan slot. Approval selalu mengecek ulang schedule, closure, status lab, dan reservasi lain.</p>
          </div>
          {canViewSchedules && <Button variant="secondary" size="sm" onClick={() => navigate('/schedules')}>Buka Jadwal Reguler</Button>}
        </CardContent>
      </Card>

      {pendingCount > 0 && canApprove && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <CalendarClock className="h-4 w-4" />
          {pendingCount} reservasi menunggu keputusan
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Input label="Dari" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input label="Sampai" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | LaboratoryReservationStatus)} options={STATUS_OPTIONS} />
          <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>Muat ulang</Button>
          <div className="ml-auto text-xs text-ink-muted">{canViewAll ? 'Scope: seluruh sekolah' : 'Scope: reservasi saya'}</div>
        </CardContent>
      </Card>

      {loading ? (
        <Card><LoadingState label="Memuat reservasi canonical..." /></Card>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                <th className="px-4 py-3 font-medium">Nomor / Pemohon</th>
                <th className="px-4 py-3 font-medium">Lab</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Jam</th>
                <th className="px-4 py-3 font-medium">Kegiatan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr></thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState title="Belum ada reservasi pada rentang ini" className="py-10" /></td></tr>
                ) : displayed.map((reservation) => (
                  <tr key={reservation.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-primary">{reservation.reservationNumber}</p>
                      <p className="text-xs text-ink-muted">{reservation.requester.name}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{reservation.laboratory.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{reservation.date}</td>
                    <td className="px-4 py-3 text-ink-secondary">{reservation.startsAt.slice(0, 5)} - {reservation.endsAt.slice(0, 5)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{reservation.activity}</td>
                    <td className="px-4 py-3"><StatusBadge status={reservation.status} /></td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      <button onClick={() => setDetail(reservation)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary" aria-label="Lihat reservasi"><Eye className="h-4 w-4" /></button>
                      {canApprove && reservation.status === 'submitted' && (
                        <>
                          <button onClick={() => void approve(reservation)} className="rounded p-1 text-success-foreground hover:bg-success/10" aria-label="Setujui reservasi"><Check className="h-4 w-4" /></button>
                          <button onClick={() => { setRejectOpen(reservation); setRejectReason(''); }} className="rounded p-1 text-danger hover:bg-danger/10" aria-label="Tolak reservasi"><X className="h-4 w-4" /></button>
                        </>
                      )}
                      {canCancelReservation(reservation) && (
                        <button onClick={() => { setCancelOpen(reservation); setCancelReason(''); }} className="rounded p-1 text-warning-foreground hover:bg-warning/10" aria-label="Batalkan reservasi"><Ban className="h-4 w-4" /></button>
                      )}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <FormDialog open={open} onClose={() => setOpen(false)} title="Ajukan Reservasi Lab" onSubmit={() => void save()} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Pemohon" value={user?.name ?? ''} disabled />
          <Select
            label="Laboratorium"
            value={form.laboratoryId}
            onChange={(event) => { setForm({ ...form, laboratoryId: event.target.value }); setAvailabilityPreview(null); }}
            options={labs.map((lab) => ({ value: lab.id, label: `${lab.code} · ${lab.name} · kapasitas ${lab.capacity}` }))}
          />
          <Input label="Tanggal" type="date" value={form.date} onChange={(event) => { setForm({ ...form, date: event.target.value }); setAvailabilityPreview(null); }} />
          <Input label="Peserta" type="number" min={1} value={form.participants} onChange={(event) => setForm({ ...form, participants: Number(event.target.value) })} />
          <Input label="Jam Mulai" type="time" value={form.startsAt} onChange={(event) => { setForm({ ...form, startsAt: event.target.value }); setAvailabilityPreview(null); }} />
          <Input label="Jam Selesai" type="time" value={form.endsAt} onChange={(event) => { setForm({ ...form, endsAt: event.target.value }); setAvailabilityPreview(null); }} />
          <div className="sm:col-span-2"><Input label="Kegiatan" value={form.activity} onChange={(event) => setForm({ ...form, activity: event.target.value })} /></div>
          <Input label="Kebutuhan Perangkat" value={form.deviceNeeds ?? ''} onChange={(event) => setForm({ ...form, deviceNeeds: event.target.value })} />
          <Input label="Penanggung Jawab" value={form.picName} onChange={(event) => setForm({ ...form, picName: event.target.value })} />
          <div className="sm:col-span-2"><Textarea label="Catatan" value={form.notes ?? ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>

          <div className="sm:col-span-2 rounded-xl border border-base-700 bg-base-800/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink-primary">Preflight availability</p>
                <p className="text-xs text-ink-muted">Hanya preview UX. Backend akan mengecek ulang secara transaksional saat submit.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" icon={<ShieldCheck className="h-4 w-4" />} disabled={checking} onClick={() => void checkAvailability()}>
                {checking ? 'Memeriksa...' : 'Cek Ketersediaan'}
              </Button>
            </div>
            {availabilityPreview && (() => {
              const display = availabilityLabel(availabilityPreview);
              return <div className="mt-3 space-y-2">
                <Badge tone={display.tone}>{display.label}</Badge>
                {availabilityPreview.blockers.length > 0 && <div className="space-y-1">
                  {availabilityPreview.blockers.map((blocker) => (
                    <p key={`${blocker.type}-${blocker.sourceId}`} className="text-xs text-ink-secondary">
                      • {blocker.title}{blocker.allDay ? ' · seharian' : ` · ${blocker.startsAt?.slice(0, 5)}-${blocker.endsAt?.slice(0, 5)}`}
                    </p>
                  ))}
                </div>}
                {availabilityPreview.issues.map((issue) => <p key={issue.code} className="text-xs text-warning-foreground">• {issue.message}</p>)}
              </div>;
            })()}
          </div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.activity} description={detail ? `${detail.reservationNumber} · ${detail.requester.name}` : undefined} width="max-w-lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between"><StatusBadge status={detail.status} /><span className="text-xs text-ink-muted">v{detail.version}</span></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">Laboratorium</p><p className="text-ink-primary">{detail.laboratory.name}</p></div>
              <div><p className="text-xs text-ink-muted">Tanggal</p><p className="text-ink-primary">{detail.date}</p></div>
              <div><p className="text-xs text-ink-muted">Jam</p><p className="text-ink-primary">{detail.startsAt.slice(0, 5)} - {detail.endsAt.slice(0, 5)}</p></div>
              <div><p className="text-xs text-ink-muted">Peserta</p><p className="text-ink-primary">{detail.participants} / {detail.laboratory.capacity}</p></div>
              <div><p className="text-xs text-ink-muted">PIC</p><p className="text-ink-primary">{detail.picName}</p></div>
              <div><p className="text-xs text-ink-muted">Pemohon</p><p className="text-ink-primary">{detail.requester.name}</p></div>
              <div className="col-span-2"><p className="text-xs text-ink-muted">Kebutuhan Perangkat</p><p className="text-ink-primary">{detail.deviceNeeds || '-'}</p></div>
              <div className="col-span-2"><p className="text-xs text-ink-muted">Catatan</p><p className="text-ink-primary">{detail.notes || '-'}</p></div>
              {detail.rejectionReason && <div className="col-span-2"><p className="text-xs text-ink-muted">Alasan Penolakan</p><p className="text-danger">{detail.rejectionReason}</p></div>}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline Audit</p>
              <ActivityTimeline items={detail.timeline.map((event) => ({
                label: timelineLabel(event),
                by: event.actorName,
                at: relativeTime(event.at),
                tone: event.eventType === 'reservation.approved' ? 'success' : event.eventType === 'reservation.rejected' || event.eventType === 'reservation.cancelled' ? 'danger' : 'accent',
              }))} />
            </div>
            <div className="flex gap-2 pt-2">
              {canApprove && detail.status === 'submitted' && <>
                <Button variant="success" size="sm" icon={<Check className="h-4 w-4" />} onClick={() => void approve(detail)} className="flex-1">Setujui</Button>
                <Button variant="danger" size="sm" icon={<X className="h-4 w-4" />} onClick={() => { setRejectOpen(detail); setRejectReason(''); }} className="flex-1">Tolak</Button>
              </>}
              {canCancelReservation(detail) && <Button variant="secondary" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => { setCancelOpen(detail); setCancelReason(''); }} className="flex-1">Batalkan</Button>}
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={Boolean(rejectOpen)} onClose={() => setRejectOpen(null)} title="Tolak Reservasi" size="sm">
        <Textarea label="Alasan Penolakan" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Masukkan alasan penolakan..." />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejectOpen(null)}>Batal</Button>
          <Button variant="danger" onClick={() => void reject()}>Tolak Reservasi</Button>
        </div>
      </Modal>

      <Modal open={Boolean(cancelOpen)} onClose={() => setCancelOpen(null)} title="Batalkan Reservasi" size="sm">
        <Textarea label="Alasan Pembatalan" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Masukkan alasan pembatalan..." />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCancelOpen(null)}>Kembali</Button>
          <Button variant="danger" onClick={() => void cancelReservation()}>Batalkan Reservasi</Button>
        </div>
      </Modal>
    </div>
  );
}
