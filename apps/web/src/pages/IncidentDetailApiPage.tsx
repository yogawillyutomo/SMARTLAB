import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  History,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  UserRoundCheck,
  XCircle,
} from 'lucide-react';
import { FormDialog } from '@/components/forms/FormDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { hasServerPermission } from '@/lib/authIdentity';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_PRIORITIES,
  INCIDENT_PRIORITY_LABELS,
  INCIDENT_STATUS_LABELS,
  incidentPresentationIssue,
  incidentPriorityTone,
  incidentStatusTone,
  isTerminalIncidentStatus,
} from '@/lib/incidentPresentation';
import {
  incidentGateway,
  type IncidentAssigneeCandidateDto,
  type IncidentCategory,
  type IncidentCommentPage,
  type IncidentDto,
  type IncidentEventPage,
  type IncidentPriority,
  type TransitionIncidentInput,
  type UpdateIncidentInput,
} from '@/services/incidentApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import type { AuthenticatedUser } from '@/types';

export type IncidentDetailState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string; retryable: boolean }
  | { status: 'ready'; incident: IncidentDto };

export interface IncidentActionAvailability {
  correct: boolean;
  assign: boolean;
  triage: boolean;
  reject: boolean;
  start: boolean;
  resolve: boolean;
  verify: boolean;
  close: boolean;
  reopen: boolean;
  comment: boolean;
  viewHistory: boolean;
}

// Exported for focused workflow permission regression coverage.
// eslint-disable-next-line react-refresh/only-export-components
export function incidentActionAvailability(incident: IncidentDto, user: AuthenticatedUser | null): IncidentActionAvailability {
  const canUpdate = hasServerPermission(user, 'incidents.update');
  const canAssign = hasServerPermission(user, 'incidents.assign');
  const canApprove = hasServerPermission(user, 'incidents.approve');
  const ownsProgress = incident.assignee?.membershipId === user?.membership.id;
  const progressAuthority = canUpdate && (ownsProgress || canAssign);
  const hasAssigneeSnapshot = incident.assignee !== null;

  return {
    correct: incident.status === 'reported' && canUpdate && canAssign,
    assign: canAssign && (
      incident.status === 'triaged'
      || incident.status === 'assigned'
      || incident.status === 'in_progress'
      || (incident.status === 'resolved' && hasAssigneeSnapshot)
    ),
    triage: incident.status === 'reported' && canApprove,
    reject: incident.status === 'reported' && canApprove,
    start: incident.status === 'assigned' && progressAuthority,
    resolve: (incident.status === 'triaged' && canApprove)
      || ((incident.status === 'assigned' || incident.status === 'in_progress') && progressAuthority),
    verify: incident.status === 'resolved' && canApprove,
    close: incident.status === 'verified' && canApprove,
    reopen: incident.status === 'resolved' && canApprove,
    comment: hasServerPermission(user, 'incidents.comment') && !isTerminalIncidentStatus(incident.status),
    viewHistory: hasServerPermission(user, 'incidents.view-history'),
  };
}

// Exported for focused snapshot-aware reopen regression coverage.
// eslint-disable-next-line react-refresh/only-export-components
export function resolvedReopenTarget(incident: IncidentDto): 'in_progress' | 'triaged' {
  return incident.assignee ? 'in_progress' : 'triaged';
}

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function LabelValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-base-700/60 bg-base-800/50 p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink-primary">{children}</dd>
    </div>
  );
}

export function IncidentDetailView({
  state,
  user,
  comments,
  commentsLoading,
  events,
  eventsLoading,
  mutationBusy,
  commentText,
  onCommentTextChange,
  onRetry,
  onBack,
  onOpenAction,
  onAddComment,
  onCommentsPage,
  onEventsPage,
}: {
  state: IncidentDetailState;
  user: AuthenticatedUser | null;
  comments: IncidentCommentPage | null;
  commentsLoading: boolean;
  events: IncidentEventPage | null;
  eventsLoading: boolean;
  mutationBusy: boolean;
  commentText: string;
  onCommentTextChange: (value: string) => void;
  onRetry: () => void;
  onBack: () => void;
  onOpenAction: (action: ActionKind) => void;
  onAddComment: () => void;
  onCommentsPage: (page: number) => void;
  onEventsPage: (page: number) => void;
}) {
  if (state.status === 'loading') return <Card><LoadingState label="Memuat detail tiket dari server..." /></Card>;
  if (state.status === 'not_found') {
    return <Card><EmptyState icon={<AlertTriangle className="h-7 w-7" />} title="Tiket tidak ditemukan" description="Tiket tidak tersedia pada konteks sekolah atau kebijakan visibility aktif." action={<Button variant="secondary" onClick={onBack}>Kembali ke daftar</Button>} /></Card>;
  }
  if (state.status === 'error') return <Card><ErrorState message={state.message} onRetry={state.retryable ? onRetry : undefined} /></Card>;

  const { incident } = state;
  const actions = incidentActionAvailability(incident, user);
  const timestamps = [
    ['Terjadi', incident.occurredAt],
    ['Dilaporkan', incident.reportedAt],
    ['Triage', incident.triagedAt],
    ['Ditugaskan', incident.assignedAt],
    ['Mulai', incident.startedAt],
    ['Selesai', incident.resolvedAt],
    ['Diverifikasi', incident.verifiedAt],
    ['Ditutup', incident.closedAt],
    ['Ditolak', incident.rejectedAt],
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button type="button" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink-primary" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Kembali ke tiket
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-primary">{incident.ticketNumber}</h1>
            <Badge tone={incidentStatusTone(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge>
            <Badge tone={incidentPriorityTone(incident.priority)}>{INCIDENT_PRIORITY_LABELS[incident.priority]}</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-ink-secondary">{incident.title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.correct && <Button size="sm" variant="secondary" onClick={() => onOpenAction('correct')}>Koreksi Laporan</Button>}
          {actions.assign && <Button size="sm" variant="secondary" icon={<UserRoundCheck className="h-4 w-4" />} onClick={() => onOpenAction('assign')}>{incident.assignee ? 'Tugaskan Ulang' : 'Tugaskan'}</Button>}
          {actions.triage && <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => onOpenAction('triage')}>Triage</Button>}
          {actions.reject && <Button size="sm" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => onOpenAction('reject')}>Tolak</Button>}
          {actions.start && <Button size="sm" icon={<Play className="h-4 w-4" />} disabled={mutationBusy} onClick={() => onOpenAction('start')}>Mulai Penanganan</Button>}
          {actions.resolve && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onOpenAction('resolve')}>Selesaikan</Button>}
          {actions.verify && <Button size="sm" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => onOpenAction('verify')}>Verifikasi</Button>}
          {actions.reopen && <Button size="sm" variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => onOpenAction('reopen')}>Buka Kembali</Button>}
          {actions.close && <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onOpenAction('close')}>Tutup Tiket</Button>}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card><CardContent className="space-y-4">
          <div>
            <h2 className="font-semibold text-ink-primary">Informasi Laporan</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-secondary">{incident.description}</p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <LabelValue label="Pelapor">{incident.reporter.name}</LabelValue>
            <LabelValue label="Kategori">{INCIDENT_CATEGORY_LABELS[incident.category]}</LabelValue>
            <LabelValue label="Laboratorium">{incident.laboratory.code} · {incident.laboratory.name}</LabelValue>
            <LabelValue label="Perangkat">{incident.device ? `${incident.device.deviceCode} · ${incident.device.deviceType}` : 'Tanpa perangkat'}</LabelValue>
            <LabelValue label="Menghambat Lab">{incident.blocksLaboratoryOperation ? 'Ya' : 'Tidak'}</LabelValue>
            <LabelValue label="Versi Aggregate">v{incident.version}</LabelValue>
          </dl>
          {incident.impact && <div><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Dampak</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.impact}</p></div>}
          {incident.stepsTaken && <div><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Langkah yang Sudah Dilakukan</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.stepsTaken}</p></div>}
          {incident.triageSummary && <div><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Ringkasan Triage</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.triageSummary}</p></div>}
          {incident.resolutionSummary && <div><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Resolusi</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.resolutionSummary}</p></div>}
          {incident.verificationNote && <div><p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Catatan Verifikasi</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.verificationNote}</p></div>}
          {incident.rejectionReason && <div><p className="text-xs font-medium uppercase tracking-wide text-danger">Alasan Penolakan</p><p className="mt-1 whitespace-pre-wrap text-sm text-ink-secondary">{incident.rejectionReason}</p></div>}
        </CardContent></Card>

        <div className="space-y-4">
          <Card><CardContent>
            <h2 className="font-semibold text-ink-primary">Penugasan</h2>
            <div className="mt-3 rounded-lg bg-base-700/30 p-3">
              {incident.assignee ? <><p className="font-medium text-ink-primary">{incident.assignee.name}</p><p className="mt-1 text-xs text-ink-muted">Membership {incident.assignee.membershipId}</p></> : <p className="text-sm text-ink-muted">Belum ada teknisi.</p>}
            </div>
          </CardContent></Card>
          <Card><CardContent>
            <h2 className="font-semibold text-ink-primary">Waktu Proses</h2>
            <div className="mt-3 space-y-2">
              {timestamps.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 text-xs"><span className="text-ink-muted">{label}</span><span className="text-right text-ink-secondary">{dateLabel(value)}</span></div>)}
            </div>
          </CardContent></Card>
        </div>
      </div>

      <Card><CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 font-semibold text-ink-primary"><MessageSquare className="h-4 w-4" /> Komentar</h2><p className="mt-1 text-xs text-ink-muted">Percakapan participant-safe. Bukti audit internal memiliki izin akses terpisah.</p></div>
          {comments && <span className="text-xs text-ink-muted">{comments.meta.total} komentar</span>}
        </div>
        {actions.comment && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1"><Textarea value={commentText} maxLength={2000} placeholder="Tambahkan komentar..." onChange={(event) => onCommentTextChange(event.target.value)} /></div>
            <Button size="sm" icon={<Send className="h-4 w-4" />} disabled={mutationBusy || commentText.trim() === ''} onClick={onAddComment}>Kirim</Button>
          </div>
        )}
        {isTerminalIncidentStatus(incident.status) && <p className="rounded-lg bg-base-700/30 px-3 py-2 text-xs text-ink-muted">Tiket terminal tetap dapat dibaca, tetapi komentar baru tidak dapat ditambahkan.</p>}
        {commentsLoading && <LoadingState label="Memuat komentar..." />}
        {!commentsLoading && comments?.data.length === 0 && <EmptyState title="Belum ada komentar" className="py-6" />}
        {!commentsLoading && comments && comments.data.length > 0 && <div className="space-y-3">{comments.data.map((comment) => (
          <div key={comment.id} className="rounded-xl border border-base-700/60 bg-base-800/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-ink-primary">{comment.actor.name}</p><span className="text-xs text-ink-muted">{dateLabel(comment.createdAt)}</span></div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">{comment.text}</p>
          </div>
        ))}</div>}
        {comments && comments.meta.lastPage > 1 && <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={comments.meta.page <= 1} onClick={() => onCommentsPage(comments.meta.page - 1)}>Sebelumnya</Button><Button size="sm" variant="ghost" disabled={comments.meta.page >= comments.meta.lastPage} onClick={() => onCommentsPage(comments.meta.page + 1)}>Berikutnya</Button></div>}
      </CardContent></Card>

      {actions.viewHistory && <Card><CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold text-ink-primary"><History className="h-4 w-4" /> Riwayat Internal</h2><p className="mt-1 text-xs text-ink-muted">Bukti typed event immutable untuk pengguna dengan incidents.view-history.</p></div>{events && <span className="text-xs text-ink-muted">{events.meta.total} event</span>}</div>
        {eventsLoading && <LoadingState label="Memuat riwayat internal..." />}
        {!eventsLoading && events?.data.length === 0 && <EmptyState title="Belum ada event" className="py-6" />}
        {!eventsLoading && events && <div className="space-y-3">{events.data.map((event) => (
          <div key={event.id} className="rounded-xl border border-base-700/60 bg-base-800/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-mono text-xs font-semibold text-accent-content">{event.eventType}</p><p className="mt-1 text-xs text-ink-muted">v{event.incidentVersionBefore} → v{event.incidentVersionAfter} · {event.actor.name}</p></div><span className="text-xs text-ink-muted">{dateLabel(event.createdAt)}</span></div>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-base-900/80 p-3 text-xs text-ink-secondary">{JSON.stringify(event.payload, null, 2)}</pre>
          </div>
        ))}</div>}
        {events && events.meta.lastPage > 1 && <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={events.meta.page <= 1} onClick={() => onEventsPage(events.meta.page - 1)}>Sebelumnya</Button><Button size="sm" variant="ghost" disabled={events.meta.page >= events.meta.lastPage} onClick={() => onEventsPage(events.meta.page + 1)}>Berikutnya</Button></div>}
      </CardContent></Card>}
    </div>
  );
}

type ActionKind = 'correct' | 'assign' | 'triage' | 'reject' | 'start' | 'resolve' | 'verify' | 'close' | 'reopen';

type ActionFields = {
  title: string;
  description: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  impact: string;
  stepsTaken: string;
  blocksLaboratoryOperation: boolean;
  occurredAt: string;
  assigneeMembershipId: string;
  reason: string;
  triageSummary: string;
  resolutionSummary: string;
  verificationNote: string;
};

function actionFieldsFromIncident(incident: IncidentDto): ActionFields {
  const occurred = new Date(new Date(incident.occurredAt).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return {
    title: incident.title,
    description: incident.description,
    category: incident.category,
    priority: incident.priority,
    impact: incident.impact ?? '',
    stepsTaken: incident.stepsTaken ?? '',
    blocksLaboratoryOperation: incident.blocksLaboratoryOperation,
    occurredAt: occurred,
    assigneeMembershipId: incident.assignee?.membershipId ?? '',
    reason: '',
    triageSummary: incident.triageSummary ?? '',
    resolutionSummary: '',
    verificationNote: '',
  };
}

function ActionFieldsView({ kind, fields, candidates, candidateSearch, onCandidateSearchChange, onSearchCandidates, onChange }: { kind: ActionKind; fields: ActionFields; candidates: IncidentAssigneeCandidateDto[]; candidateSearch: string; onCandidateSearchChange: (value: string) => void; onSearchCandidates: () => void; onChange: (fields: ActionFields) => void }) {
  if (kind === 'correct') return <div className="grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Input label="Judul" value={fields.title} maxLength={200} onChange={(e) => onChange({ ...fields, title: e.target.value })} /></div><div className="sm:col-span-2"><Textarea label="Deskripsi" value={fields.description} maxLength={4000} onChange={(e) => onChange({ ...fields, description: e.target.value })} /></div><Select label="Kategori" value={fields.category} options={INCIDENT_CATEGORIES.map((value) => ({ value, label: INCIDENT_CATEGORY_LABELS[value] }))} onChange={(e) => onChange({ ...fields, category: e.target.value as IncidentCategory })} /><Select label="Prioritas" value={fields.priority} options={INCIDENT_PRIORITIES.map((value) => ({ value, label: INCIDENT_PRIORITY_LABELS[value] }))} onChange={(e) => onChange({ ...fields, priority: e.target.value as IncidentPriority })} /><Textarea label="Dampak" value={fields.impact} maxLength={2000} onChange={(e) => onChange({ ...fields, impact: e.target.value })} /><Textarea label="Langkah yang Sudah Dilakukan" value={fields.stepsTaken} maxLength={2000} onChange={(e) => onChange({ ...fields, stepsTaken: e.target.value })} /><Input label="Waktu Kejadian" type="datetime-local" value={fields.occurredAt} onChange={(e) => onChange({ ...fields, occurredAt: e.target.value })} /><label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-secondary"><input type="checkbox" checked={fields.blocksLaboratoryOperation} onChange={(e) => onChange({ ...fields, blocksLaboratoryOperation: e.target.checked })} />Menghambat operasional lab</label></div>;
  if (kind === 'assign') return <div className="space-y-4"><div className="flex gap-2"><div className="flex-1"><Input label="Cari Teknisi" value={candidateSearch} maxLength={100} placeholder="Kosongkan untuk kandidat awal, atau cari nama" onChange={(e) => onCandidateSearchChange(e.target.value)} /></div><Button className="self-end" type="button" variant="secondary" size="sm" onClick={onSearchCandidates}>Cari</Button></div><Select label="Teknisi" value={fields.assigneeMembershipId} placeholder="Pilih membership aktif" options={candidates.map((candidate) => ({ value: candidate.membershipId, label: candidate.user.name }))} onChange={(e) => onChange({ ...fields, assigneeMembershipId: e.target.value })} /><Textarea label="Alasan" value={fields.reason} maxLength={1000} onChange={(e) => onChange({ ...fields, reason: e.target.value })} /></div>;
  if (kind === 'triage') return <div className="space-y-4"><Textarea label="Ringkasan Triage" value={fields.triageSummary} maxLength={2000} onChange={(e) => onChange({ ...fields, triageSummary: e.target.value })} /><Select label="Prioritas Final" value={fields.priority} options={INCIDENT_PRIORITIES.map((value) => ({ value, label: INCIDENT_PRIORITY_LABELS[value] }))} onChange={(e) => onChange({ ...fields, priority: e.target.value as IncidentPriority })} /><Textarea label="Dampak Final" value={fields.impact} maxLength={2000} onChange={(e) => onChange({ ...fields, impact: e.target.value })} /><label className="flex items-center gap-2 text-sm text-ink-secondary"><input type="checkbox" checked={fields.blocksLaboratoryOperation} onChange={(e) => onChange({ ...fields, blocksLaboratoryOperation: e.target.checked })} />Menghambat operasional lab</label></div>;
  if (kind === 'reject' || kind === 'reopen') return <Textarea label="Alasan" value={fields.reason} maxLength={1000} onChange={(e) => onChange({ ...fields, reason: e.target.value })} />;
  if (kind === 'resolve') return <Textarea label="Ringkasan Resolusi" value={fields.resolutionSummary} maxLength={4000} onChange={(e) => onChange({ ...fields, resolutionSummary: e.target.value })} />;
  if (kind === 'verify') return <Textarea label="Catatan Verifikasi" value={fields.verificationNote} maxLength={2000} onChange={(e) => onChange({ ...fields, verificationNote: e.target.value })} />;
  if (kind === 'start') return <p className="text-sm text-ink-secondary">Mulai penanganan menggunakan versi tiket terbaru dan assignee aktif saat ini.</p>;
  return <p className="text-sm text-ink-secondary">Tutup tiket setelah resolusi telah diverifikasi.</p>;
}

const ACTION_TITLES: Record<ActionKind, string> = { correct: 'Koreksi Laporan', assign: 'Penugasan Incident', triage: 'Triage Incident', reject: 'Tolak Incident', start: 'Mulai Penanganan', resolve: 'Selesaikan Incident', verify: 'Verifikasi Resolusi', close: 'Tutup Incident', reopen: 'Buka Kembali Incident' };

export function IncidentDetailPage() {
  const { incidentId = '' } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [state, setState] = useState<IncidentDetailState>({ status: 'loading' });
  const [comments, setComments] = useState<IncidentCommentPage | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [events, setEvents] = useState<IncidentEventPage | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [mutationBusy, setMutationBusy] = useState(false);
  const [action, setAction] = useState<ActionKind | null>(null);
  const [actionFields, setActionFields] = useState<ActionFields | null>(null);
  const [actionIssue, setActionIssue] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<IncidentAssigneeCandidateDto[]>([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const requestGeneration = useRef(0);

  const currentIncident = state.status === 'ready' ? state.incident : null;

  const loadComments = useCallback(async (page = 1, generation = requestGeneration.current) => {
    if (!incidentId) return;
    setCommentsLoading(true);
    try {
      const next = await incidentGateway.comments(incidentId, { page, perPage: 25 });
      if (generation === requestGeneration.current) setComments(next);
    } catch (error) {
      if (generation === requestGeneration.current) toast(incidentPresentationIssue(error).message, 'error');
    } finally {
      if (generation === requestGeneration.current) setCommentsLoading(false);
    }
  }, [incidentId]);

  const loadEvents = useCallback(async (page = 1, generation = requestGeneration.current) => {
    if (!incidentId || !hasServerPermission(user, 'incidents.view-history')) return;
    setEventsLoading(true);
    try {
      const next = await incidentGateway.events(incidentId, { page, perPage: 25 });
      if (generation === requestGeneration.current) setEvents(next);
    } catch (error) {
      if (generation === requestGeneration.current) toast(incidentPresentationIssue(error).message, 'error');
    } finally {
      if (generation === requestGeneration.current) setEventsLoading(false);
    }
  }, [incidentId, user]);

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setComments(null);
    setEvents(null);
    setCommentsLoading(false);
    setEventsLoading(false);
    if (!incidentId) { setState({ status: 'not_found' }); return; }
    setState({ status: 'loading' });
    try {
      const incident = await incidentGateway.show(incidentId);
      if (generation !== requestGeneration.current) return;
      setState({ status: 'ready', incident });
      void loadComments(1, generation);
      if (hasServerPermission(user, 'incidents.view-history')) void loadEvents(1, generation);
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      const issue = incidentPresentationIssue(error);
      setState(issue.notFound ? { status: 'not_found' } : { status: 'error', message: issue.message, retryable: issue.retryable });
    }
  }, [incidentId, loadComments, loadEvents, user]);

  useEffect(() => { void load(); }, [load]);

  async function refreshAfterMutation(next: IncidentDto, refreshComments = false) {
    setState({ status: 'ready', incident: next });
    if (refreshComments) await loadComments(1);
    if (hasServerPermission(user, 'incidents.view-history')) await loadEvents(1);
  }

  async function handleMutation(run: (incident: IncidentDto) => Promise<IncidentDto>, successMessage: string) {
    if (!currentIncident) return;
    setMutationBusy(true);
    setActionIssue(null);
    try {
      const next = await run(currentIncident);
      await refreshAfterMutation(next);
      setAction(null);
      toast(successMessage, 'success');
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      setActionIssue(issue.message);
      if (issue.versionConflict || issue.preconditionFailure || issue.assigneeIneligible) await load();
    } finally { setMutationBusy(false); }
  }

  async function searchCandidates(search = candidateSearch) {
    const normalizedSearch = search.trim();
    try {
      const result = await incidentGateway.assigneeCandidates({ ...(normalizedSearch.length >= 2 ? { search: normalizedSearch } : {}), page: 1, perPage: 100 });
      setCandidates(result.data);
    } catch (error) { setActionIssue(incidentPresentationIssue(error).message); }
  }

  function openAction(kind: ActionKind) {
    if (!currentIncident) return;
    if (kind === 'start') {
      void handleMutation((incident) => incidentGateway.transition(incident.id, incident.version, { toStatus: 'in_progress' }), 'Penanganan Incident dimulai.');
      return;
    }
    setActionIssue(null);
    setActionFields(actionFieldsFromIncident(currentIncident));
    setAction(kind);
    if (kind === 'assign') {
      setCandidateSearch('');
      setCandidates([]);
      void searchCandidates('');
    }
  }

  async function submitAction() {
    if (!action || !actionFields || !currentIncident) return;
    if (action === 'correct') {
      const occurredAt = new Date(actionFields.occurredAt);
      if (actionFields.title.trim().length < 5 || actionFields.description.trim().length < 10 || Number.isNaN(occurredAt.getTime())) { setActionIssue('Judul minimal 5 karakter, deskripsi minimal 10 karakter, dan waktu kejadian harus valid.'); return; }
      const payload: UpdateIncidentInput = { title: actionFields.title.trim(), description: actionFields.description.trim(), category: actionFields.category, priority: actionFields.priority, impact: actionFields.impact.trim() || null, blocksLaboratoryOperation: actionFields.blocksLaboratoryOperation, stepsTaken: actionFields.stepsTaken.trim() || null, occurredAt: occurredAt.toISOString() };
      await handleMutation((incident) => incidentGateway.update(incident.id, incident.version, payload), 'Laporan Incident diperbarui.');
      return;
    }
    if (action === 'assign') {
      if (!actionFields.assigneeMembershipId) { setActionIssue('Pilih teknisi terlebih dahulu.'); return; }
      const isReassignment = currentIncident.assignee && currentIncident.assignee.membershipId !== actionFields.assigneeMembershipId;
      if (isReassignment && actionFields.reason.trim().length < 5) { setActionIssue('Penugasan ulang memerlukan alasan minimal 5 karakter.'); return; }
      await handleMutation((incident) => incidentGateway.assign(incident.id, incident.version, { assigneeMembershipId: actionFields.assigneeMembershipId, ...(actionFields.reason.trim() ? { reason: actionFields.reason.trim() } : {}) }), 'Penugasan Incident diperbarui.');
      return;
    }
    let transition: TransitionIncidentInput;
    if (action === 'triage') {
      if (actionFields.triageSummary.trim() === '') { setActionIssue('Ringkasan triage wajib diisi.'); return; }
      transition = { toStatus: 'triaged', triageSummary: actionFields.triageSummary.trim(), priority: actionFields.priority, impact: actionFields.impact.trim() || null, blocksLaboratoryOperation: actionFields.blocksLaboratoryOperation };
    } else if (action === 'reject') {
      if (actionFields.reason.trim().length < 5) { setActionIssue('Alasan penolakan minimal 5 karakter.'); return; }
      transition = { toStatus: 'rejected', reason: actionFields.reason.trim() };
    } else if (action === 'resolve') {
      if (actionFields.resolutionSummary.trim().length < 5) { setActionIssue('Ringkasan resolusi minimal 5 karakter.'); return; }
      transition = { toStatus: 'resolved', resolutionSummary: actionFields.resolutionSummary.trim() };
    } else if (action === 'verify') {
      if (actionFields.verificationNote.trim() === '') { setActionIssue('Catatan verifikasi wajib diisi.'); return; }
      transition = { toStatus: 'verified', verificationNote: actionFields.verificationNote.trim() };
    } else if (action === 'reopen') {
      if (actionFields.reason.trim().length < 5) { setActionIssue('Alasan buka kembali minimal 5 karakter.'); return; }
      transition = { toStatus: resolvedReopenTarget(currentIncident), reason: actionFields.reason.trim() };
    } else {
      transition = { toStatus: 'closed' };
    }
    await handleMutation((incident) => incidentGateway.transition(incident.id, incident.version, transition), 'Status Incident diperbarui.');
  }

  async function addComment() {
    if (!currentIncident || commentText.trim() === '') return;
    setMutationBusy(true);
    try {
      await incidentGateway.addComment(currentIncident.id, currentIncident.version, commentText.trim());
      const latest = await incidentGateway.show(currentIncident.id);
      setCommentText('');
      await refreshAfterMutation(latest, true);
      toast('Komentar ditambahkan.', 'success');
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      toast(issue.message, 'error');
      if (issue.versionConflict || issue.preconditionFailure) await load();
    } finally { setMutationBusy(false); }
  }

  const actionDescription = useMemo(() => {
    if (!currentIncident || !action) return undefined;
    if (action === 'reopen') return currentIncident.assignee ? 'Snapshot assignee ada: tiket hanya dapat dibuka kembali ke Diproses. Jika live membership sudah tidak eligible, lakukan penugasan ulang terlebih dahulu.' : 'Tanpa snapshot assignee, tiket dibuka kembali ke Diverifikasi.';
    if (action === 'assign' && currentIncident.status === 'resolved') return 'Penugasan ulang pada status Selesai adalah recovery assignee dan tidak menghapus bukti resolusi.';
    return 'Aksi memakai optimistic concurrency dari versi tiket yang sedang tampil.';
  }, [action, currentIncident]);

  return <>
    <IncidentDetailView state={state} user={user} comments={comments} commentsLoading={commentsLoading} events={events} eventsLoading={eventsLoading} mutationBusy={mutationBusy} commentText={commentText} onCommentTextChange={setCommentText} onRetry={() => void load()} onBack={() => navigate('/incidents')} onOpenAction={openAction} onAddComment={() => void addComment()} onCommentsPage={(page) => void loadComments(page)} onEventsPage={(page) => void loadEvents(page)} />
    <FormDialog open={action !== null} onClose={() => { if (!mutationBusy) setAction(null); }} title={action ? ACTION_TITLES[action] : 'Aksi Incident'} description={actionDescription} onSubmit={action && action !== 'start' ? () => void submitAction() : undefined} submitLabel={action === 'close' ? 'Tutup Tiket' : 'Simpan'} loading={mutationBusy} size={action === 'correct' ? 'xl' : 'md'}>
      {actionIssue && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{actionIssue}</div>}
      {action && actionFields && <ActionFieldsView kind={action} fields={actionFields} candidates={candidates} candidateSearch={candidateSearch} onCandidateSearchChange={setCandidateSearch} onSearchCandidates={() => void searchCandidates()} onChange={setActionFields} />}
    </FormDialog>
  </>;
}
