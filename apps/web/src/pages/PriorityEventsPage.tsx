import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Download, Eye, Megaphone, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { PageHeader } from '@/components/common/PageHeader';
import { FormDialog } from '@/components/forms/FormDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  laboratoryAvailabilityGateway,
  LaboratoryAvailabilityContractError,
  type LaboratoryAvailabilityDto,
} from '@/services/laboratoryAvailabilityApi';
import {
  priorityEventGateway,
  PriorityEventContractError,
  type CreatePriorityEventInput,
  type PriorityEventCategory,
  type PriorityEventDto,
  type PriorityEventStatus,
} from '@/services/priorityEventApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';

const STATUS_OPTIONS: { value: 'all' | PriorityEventStatus; label: string }[] = [
  { value: 'all', label: 'Semua status' },
  { value: 'submitted', label: 'Diajukan' },
  { value: 'approved', label: 'Disetujui' },
  { value: 'rejected', label: 'Ditolak' },
  { value: 'cancelled', label: 'Dibatalkan' },
];

const CATEGORY_OPTIONS: { value: PriorityEventCategory; label: string }[] = [
  { value: 'school_event', label: 'Kegiatan Sekolah' },
  { value: 'exam', label: 'Ujian' },
  { value: 'competition', label: 'Lomba/Seleksi' },
  { value: 'official_visit', label: 'Kunjungan Resmi' },
  { value: 'emergency', label: 'Darurat' },
  { value: 'other', label: 'Lainnya' },
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

function defaultForm(userName: string, laboratoryId?: string): CreatePriorityEventInput {
  return {
    laboratoryId: laboratoryId ?? '',
    date: dateKey(new Date()),
    startsAt: '09:00',
    endsAt: '11:00',
    category: 'school_event',
    title: '',
    participants: 30,
    description: null,
    picName: userName,
  };
}

function categoryLabel(category: PriorityEventCategory): string {
  return CATEGORY_OPTIONS.find((item) => item.value === category)?.label ?? category;
}

function statusBadge(status: PriorityEventStatus) {
  const value = {
    submitted: { tone: 'warning' as const, label: 'Diajukan' },
    approved: { tone: 'success' as const, label: 'Disetujui' },
    rejected: { tone: 'danger' as const, label: 'Ditolak' },
    cancelled: { tone: 'muted' as const, label: 'Dibatalkan' },
  }[status];

  return <Badge tone={value.tone}>{value.label}</Badge>;
}

function issueMessage(error: unknown): string {
  if (error instanceof PriorityEventContractError) return 'Respons Priority Event dari server tidak sesuai kontrak.';
  if (error instanceof LaboratoryAvailabilityContractError) return 'Respons availability dari server tidak sesuai kontrak.';
  if (error instanceof ApiClientError) {
    if (error.code === 'PRIORITY_EVENT_RECONCILIATION_REQUIRED') {
      return 'Masih ada konflik operasional. Selesaikan jadwal, reservasi, closure, atau event lain lalu coba setujui kembali.';
    }
    if (error.code === 'PRIORITY_EVENT_VERSION_CONFLICT') return 'Priority Event sudah berubah di server. Data terbaru dimuat ulang.';
    if (error.code === 'PRIORITY_EVENT_STATE_CONFLICT') return 'Status Priority Event tidak lagi mendukung aksi tersebut.';
    if (error.status === 403) return 'Anda tidak memiliki izin untuk aksi Priority Event ini.';
    if (error.status === 422) return Object.values(error.errors ?? {}).flat()[0] ?? 'Data Priority Event belum valid.';
    if (error.kind === 'network') return 'Layanan Priority Event tidak dapat dijangkau.';
  }
  return 'Operasi Priority Event gagal.';
}

function timelineLabel(event: PriorityEventDto['timeline'][number]): string {
  const labels: Record<string, string> = {
    'priority_event.submitted': 'Priority Event diajukan',
    'priority_event.approved': 'Priority Event disetujui',
    'priority_event.rejected': 'Priority Event ditolak',
    'priority_event.cancelled': 'Priority Event dibatalkan',
  };
  const reason = typeof event.payload.reason === 'string' ? event.payload.reason : null;
  return reason ? `${labels[event.eventType] ?? event.eventType} — ${reason}` : (labels[event.eventType] ?? event.eventType);
}

export function PriorityEventsPage() {
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'priority-events.create');
  const canApprove = hasServerPermission(user, 'priority-events.approve');
  const canCancel = hasServerPermission(user, 'priority-events.cancel');
  const canExport = hasServerPermission(user, 'priority-events.export');
  const canViewAll = hasServerPermission(user, 'priority-events.view-all');

  const initialRange = useMemo(defaultRange, []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [statusFilter, setStatusFilter] = useState<'all' | PriorityEventStatus>('all');
  const [events, setEvents] = useState<PriorityEventDto[]>([]);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PriorityEventDto | null>(null);
  const [form, setForm] = useState<CreatePriorityEventInput>(() => defaultForm(user?.name ?? ''));
  const [availabilityPreview, setAvailabilityPreview] = useState<LaboratoryAvailabilityDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [mutating, setMutating] = useState(false);

  const [rejectOpen, setRejectOpen] = useState<PriorityEventDto | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState<PriorityEventDto | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, laboratoryItems] = await Promise.all([
        priorityEventGateway.listAll({
          from,
          to,
          scope: canViewAll ? 'all' : 'mine',
        }),
        canCreate ? laboratoryGateway.list() : Promise.resolve([]),
      ]);
      setEvents(items);
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
    () => events.filter((event) => statusFilter === 'all' || event.status === statusFilter),
    [events, statusFilter],
  );

  const pendingCount = events.filter((event) => event.status === 'submitted').length;

  function openCreate(): void {
    setForm(defaultForm(user?.name ?? '', labs[0]?.id ?? ''));
    setAvailabilityPreview(null);
    setOpen(true);
  }

  async function checkAvailability(): Promise<void> {
    if (!form.laboratoryId || !form.date || !form.startsAt || !form.endsAt || form.startsAt >= form.endsAt) {
      toast('Pilih Laboratorium serta window waktu yang valid.', 'error');
      return;
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
    } catch (err) {
      toast(issueMessage(err), 'error');
    } finally {
      setChecking(false);
    }
  }

  async function createEvent(): Promise<void> {
    setMutating(true);
    try {
      await priorityEventGateway.create(form);
      toast('Priority Event diajukan. Konflik boleh ada saat submission, tetapi wajib selesai sebelum approval.', 'success');
      setOpen(false);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
    } finally {
      setMutating(false);
    }
  }

  async function approve(event: PriorityEventDto): Promise<void> {
    setMutating(true);
    try {
      const updated = await priorityEventGateway.approve(event.id, event.version);
      toast('Priority Event disetujui dan sekarang menjadi blocker operasional canonical.', 'success');
      setDetail(updated);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    } finally {
      setMutating(false);
    }
  }

  async function reject(): Promise<void> {
    if (!rejectOpen || rejectReason.trim() === '') {
      toast('Alasan penolakan wajib diisi.', 'error');
      return;
    }

    setMutating(true);
    try {
      const updated = await priorityEventGateway.reject(rejectOpen.id, rejectOpen.version, rejectReason);
      toast('Priority Event ditolak.', 'success');
      setRejectOpen(null);
      setRejectReason('');
      setDetail(updated);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    } finally {
      setMutating(false);
    }
  }

  async function cancelEvent(): Promise<void> {
    if (!cancelOpen || cancelReason.trim() === '') {
      toast('Alasan pembatalan wajib diisi.', 'error');
      return;
    }

    setMutating(true);
    try {
      const updated = await priorityEventGateway.cancel(cancelOpen.id, cancelOpen.version, cancelReason);
      toast('Priority Event dibatalkan.', 'success');
      setCancelOpen(null);
      setCancelReason('');
      setDetail(updated);
      await load();
    } catch (err) {
      toast(issueMessage(err), 'error');
      await load();
    } finally {
      setMutating(false);
    }
  }

  function canCancelEvent(event: PriorityEventDto): boolean {
    if (!canCancel || !['submitted', 'approved'].includes(event.status)) return false;
    return canViewAll || event.requester.membershipId === user?.membership?.id;
  }

  function exportCsv(): void {
    downloadCSV('priority-events.csv', displayed.map((event) => ({
      Nomor: event.eventNumber,
      Tanggal: event.date,
      Jam: `${event.startsAt.slice(0, 5)}-${event.endsAt.slice(0, 5)}`,
      Laboratorium: event.laboratory.name,
      Kategori: categoryLabel(event.category),
      Kegiatan: event.title,
      Peserta: event.participants,
      PIC: event.picName,
      Pemohon: event.requester.name,
      Status: event.status,
    })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kegiatan Prioritas"
        description="Kegiatan khusus yang boleh diajukan saat masih konflik, tetapi hanya dapat disetujui setelah rekonsiliasi operasional selesai."
        icon={<Megaphone className="h-5 w-5" />}
        actions={(
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
              Muat ulang
            </Button>
            {canExport && (
              <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv} disabled={displayed.length === 0}>
                Export
              </Button>
            )}
            {canCreate && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                Ajukan Event
              </Button>
            )}
          </>
        )}
      />

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <Input label="Dari" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <Input label="Sampai" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | PriorityEventStatus)}
              options={STATUS_OPTIONS}
            />
            <div className="lg:ml-auto">
              <Badge tone={pendingCount > 0 ? 'warning' : 'muted'}>{pendingCount} menunggu keputusan</Badge>
            </div>
          </div>

          <div className="rounded-xl border border-warning/20 bg-warning/10 p-3 text-xs leading-5 text-ink-secondary">
            <ShieldAlert className="mr-1 inline h-4 w-4 text-warning-foreground" />
            Priority tidak berarti force override. Jika approval ditolak karena conflict, selesaikan dulu melalui Schedule Exception, Reservation, Calendar, atau event operasional terkait; lalu approve ulang.
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card><LoadingState label="Memuat Priority Event..." /></Card>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : displayed.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Megaphone className="h-7 w-7" />}
            title="Belum ada Priority Event"
            description="Tidak ada event yang cocok dengan rentang dan filter yang dipilih."
          />
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Kegiatan</th>
                  <th className="px-4 py-3 font-medium">Lab</th>
                  <th className="px-4 py-3 font-medium">Pemohon</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((event) => (
                  <tr key={event.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-primary">
                      {event.date}<div className="text-xs text-ink-muted">{event.startsAt.slice(0, 5)}-{event.endsAt.slice(0, 5)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink-primary">{event.title}</p>
                      <p className="text-xs text-ink-muted">{categoryLabel(event.category)} · {event.eventNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{event.laboratory.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{event.requester.name}</td>
                    <td className="px-4 py-3">{statusBadge(event.status)}</td>
                    <td className="px-4 py-3">
                      <Button type="button" variant="ghost" size="sm" icon={<Eye className="h-4 w-4" />} onClick={() => setDetail(event)}>
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Ajukan Priority Event"
        description="Submission boleh mencatat konflik. Approval tetap fail-closed sampai slot aman."
        onSubmit={() => void createEvent()}
        submitLabel="Ajukan Event"
        loading={mutating}
        size="lg"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Laboratorium"
            value={form.laboratoryId}
            onChange={(event) => {
              setForm({ ...form, laboratoryId: event.target.value });
              setAvailabilityPreview(null);
            }}
            options={labs.map((lab) => ({ value: lab.id, label: `${lab.code} · ${lab.name} · kapasitas ${lab.capacity}` }))}
            placeholder="Pilih Laboratorium"
          />
          <Select
            label="Kategori"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value as PriorityEventCategory })}
            options={CATEGORY_OPTIONS}
          />
          <Input label="Tanggal" type="date" value={form.date} onChange={(event) => { setForm({ ...form, date: event.target.value }); setAvailabilityPreview(null); }} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Mulai" type="time" value={form.startsAt} onChange={(event) => { setForm({ ...form, startsAt: event.target.value }); setAvailabilityPreview(null); }} />
            <Input label="Selesai" type="time" value={form.endsAt} onChange={(event) => { setForm({ ...form, endsAt: event.target.value }); setAvailabilityPreview(null); }} />
          </div>
          <div className="md:col-span-2">
            <Input label="Nama Kegiatan" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Contoh: Kunjungan Industri Mitra" />
          </div>
          <Input label="Jumlah Peserta" type="number" min={1} value={form.participants} onChange={(event) => setForm({ ...form, participants: Number(event.target.value) })} />
          <Input label="PIC" value={form.picName} onChange={(event) => setForm({ ...form, picName: event.target.value })} />
          <div className="md:col-span-2">
            <Textarea label="Deskripsi" value={form.description ?? ''} onChange={(event) => setForm({ ...form, description: event.target.value || null })} placeholder="Konteks dan kebutuhan kegiatan..." />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-base-700 bg-base-900/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-ink-primary">Preflight availability</p>
              <p className="text-xs text-ink-muted">Preview konflik untuk membantu rekonsiliasi; submission tetap boleh dilanjutkan.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" disabled={checking} onClick={() => void checkAvailability()}>
              {checking ? 'Memeriksa...' : 'Cek Konflik'}
            </Button>
          </div>
          {availabilityPreview && (
            <div className="mt-3 space-y-2">
              <Badge tone={availabilityPreview.available ? 'success' : availabilityPreview.state === 'unknown' ? 'warning' : 'danger'}>
                {availabilityPreview.available ? 'Siap disetujui jika kondisi tidak berubah' : availabilityPreview.state === 'unknown' ? 'Coverage belum pasti' : `${availabilityPreview.blockerCount} konflik perlu direkonsiliasi`}
              </Badge>
              {availabilityPreview.blockers.slice(0, 5).map((blocker) => (
                <p key={`${blocker.type}-${blocker.sourceId}`} className="text-xs text-ink-secondary">
                  • {blocker.title}{blocker.allDay ? ' · seharian' : ` · ${blocker.startsAt?.slice(0, 5)}-${blocker.endsAt?.slice(0, 5)}`}
                </p>
              ))}
            </div>
          )}
        </div>
      </FormDialog>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title}
        description={detail ? `${detail.eventNumber} · ${detail.requester.name}` : undefined}
        width="max-w-lg"
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              {statusBadge(detail.status)}
              <span className="text-xs text-ink-muted">v{detail.version}</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">Laboratorium</p><p className="text-ink-primary">{detail.laboratory.name}</p></div>
              <div><p className="text-xs text-ink-muted">Kategori</p><p className="text-ink-primary">{categoryLabel(detail.category)}</p></div>
              <div><p className="text-xs text-ink-muted">Tanggal</p><p className="text-ink-primary">{detail.date}</p></div>
              <div><p className="text-xs text-ink-muted">Jam</p><p className="text-ink-primary">{detail.startsAt.slice(0, 5)}-{detail.endsAt.slice(0, 5)}</p></div>
              <div><p className="text-xs text-ink-muted">Peserta</p><p className="text-ink-primary">{detail.participants} / {detail.laboratory.capacity}</p></div>
              <div><p className="text-xs text-ink-muted">PIC</p><p className="text-ink-primary">{detail.picName}</p></div>
              <div className="col-span-2"><p className="text-xs text-ink-muted">Deskripsi</p><p className="text-ink-primary">{detail.description || '-'}</p></div>
              {detail.rejectionReason && <div className="col-span-2"><p className="text-xs text-ink-muted">Alasan Penolakan</p><p className="text-danger">{detail.rejectionReason}</p></div>}
            </div>

            {detail.status === 'submitted' && canApprove && (
              <div className="rounded-xl border border-warning/25 bg-warning/10 p-3 text-xs leading-5 text-ink-secondary">
                Approval akan mengecek availability ulang di server. Jika gagal, jangan force; rekonsiliasikan blocker lalu approve ulang.
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Timeline Audit</p>
              <ActivityTimeline items={detail.timeline.map((event) => ({
                label: timelineLabel(event),
                by: event.actorName,
                at: relativeTime(event.at),
                tone: event.eventType === 'priority_event.approved' ? 'success' : event.eventType === 'priority_event.rejected' || event.eventType === 'priority_event.cancelled' ? 'danger' : 'accent',
              }))} />
            </div>

            <div className="flex gap-2 pt-2">
              {canApprove && detail.status === 'submitted' && (
                <>
                  <Button variant="success" size="sm" icon={<Check className="h-4 w-4" />} loading={mutating} onClick={() => void approve(detail)} className="flex-1">
                    Setujui
                  </Button>
                  <Button variant="danger" size="sm" icon={<X className="h-4 w-4" />} onClick={() => { setRejectOpen(detail); setRejectReason(''); }} className="flex-1">
                    Tolak
                  </Button>
                </>
              )}
              {canCancelEvent(detail) && (
                <Button variant="secondary" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => { setCancelOpen(detail); setCancelReason(''); }} className="flex-1">
                  Batalkan
                </Button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={Boolean(rejectOpen)} onClose={() => setRejectOpen(null)} title="Tolak Priority Event" size="sm">
        <Textarea label="Alasan Penolakan" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRejectOpen(null)}>Kembali</Button>
          <Button variant="danger" loading={mutating} onClick={() => void reject()}>Tolak Event</Button>
        </div>
      </Modal>

      <Modal open={Boolean(cancelOpen)} onClose={() => setCancelOpen(null)} title="Batalkan Priority Event" size="sm">
        <Textarea label="Alasan Pembatalan" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCancelOpen(null)}>Kembali</Button>
          <Button variant="danger" loading={mutating} onClick={() => void cancelEvent()}>Batalkan Event</Button>
        </div>
      </Modal>
    </div>
  );
}
