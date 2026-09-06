import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Play,
  Square,
  FileText,
  History,
  Clock3,
  RefreshCw,
  Eye,
  Pencil,
  Send,
  CheckCircle2,
  RotateCcw,
  Download,
  Plus,
  XCircle,
  AlertTriangle,
  Paperclip,
  Upload,
  ExternalLink,
  Link2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { hasServerPermission } from '@/lib/authIdentity';
import { ApiClientError } from '@/lib/apiClient';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  laboratorySessionGateway,
  LaboratorySessionContractError,
  type LaboratorySessionDto,
  type LaboratorySessionSourceDto,
  type PrepareLaboratorySessionInput,
  type EndLaboratorySessionInput,
} from '@/services/laboratorySessionApi';
import {
  activityReportGateway,
  ActivityReportContractError,
  type ActivityReportDto,
  type ActivityReportType,
  type CreateActivityReportBackfillInput,
  type ActivityReportAttachmentDto,
  activityReportAttachmentDownloadUrl,
} from '@/services/activityReportApi';
import {
  clearOfflineActivityReportDraft,
  conflictingEditableFields,
  createClientMutationId,
  diffEditableSnapshot,
  editableSnapshotFromReport,
  isEditableSnapshotEqual,
  loadOfflineActivityReportDraft,
  makeOfflineActivityReportDraft,
  rebaseEditableSnapshot,
  saveOfflineActivityReportDraft,
  type ActivityReportEditableSnapshot,
  type OfflineActivityReportDraft,
  type OfflineDraftIdentity,
} from '@/services/activityReportOfflineDraft';
import {
  sessionObservationGateway,
  SessionObservationContractError,
  type SessionIssueObservationDto,
  type SessionObservationSubjectType,
  type SessionObservationSeverity,
} from '@/services/sessionObservationApi';
import {
  incidentGateway,
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  type IncidentCategory,
  type IncidentPriority,
  type IncidentReportingDeviceDto,
} from '@/services/incidentApi';

type TabKey = 'today' | 'in-progress' | 'awaiting-report' | 'history';

const REPORT_TYPE_LABELS: Record<ActivityReportType, string> = {
  practicum: 'Praktikum',
  exam: 'Ujian',
  workshop: 'Workshop',
  general: 'Umum',
};

const SOURCE_LABELS: Record<LaboratorySessionSourceDto['sourceType'], string> = {
  schedule_occurrence: 'Jadwal TESSELA',
  laboratory_reservation: 'Reservasi',
  priority_event: 'Kegiatan Prioritas',
};

const OBSERVATION_SUBJECT_LABELS: Record<SessionObservationSubjectType, string> = {
  device: 'Perangkat',
  asset: 'Aset / Perlengkapan',
  facility: 'Fasilitas',
  other: 'Lainnya',
};

const OBSERVATION_SEVERITY_LABELS: Record<SessionObservationSeverity, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  critical: 'Kritis',
};

const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  hardware: 'Hardware',
  software: 'Software',
  network: 'Jaringan',
  electrical: 'Kelistrikan',
  peripheral: 'Periferal',
  facility: 'Fasilitas',
  cleanliness: 'Kebersihan',
  security: 'Keamanan',
  other: 'Lainnya',
};

const INCIDENT_PRIORITY_LABELS: Record<IncidentPriority, string> = {
  low: 'Rendah',
  normal: 'Normal',
  high: 'Tinggi',
  critical: 'Kritis',
};

const TYPE_FIELDS: Record<ActivityReportType, { key: string; label: string }[]> = {
  practicum: [
    { key: 'topic', label: 'Topik Praktikum' },
    { key: 'steps', label: 'Langkah Kegiatan' },
    { key: 'softwareTools', label: 'Software / Tools' },
    { key: 'learningOutcome', label: 'Capaian Pembelajaran' },
  ],
  exam: [
    { key: 'classification', label: 'Klasifikasi Ujian' },
    { key: 'proctor', label: 'Pengawas' },
    { key: 'readiness', label: 'Kesiapan' },
    { key: 'continuityNotes', label: 'Catatan Kelangsungan' },
    { key: 'accommodationEvidence', label: 'Bukti Akomodasi' },
  ],
  workshop: [
    { key: 'organizer', label: 'Penyelenggara' },
    { key: 'facilitator', label: 'Fasilitator' },
    { key: 'agenda', label: 'Agenda' },
    { key: 'resources', label: 'Sumber Daya' },
    { key: 'output', label: 'Output' },
  ],
  general: [
    { key: 'activityOwner', label: 'Penanggung Jawab Kegiatan' },
    { key: 'classification', label: 'Klasifikasi' },
    { key: 'resourceUse', label: 'Penggunaan Sumber Daya' },
    { key: 'result', label: 'Hasil' },
  ],
};

const COMMON_FIELDS = [
  { key: 'objective', label: 'Tujuan' },
  { key: 'material', label: 'Materi / Pokok Kegiatan' },
  { key: 'resources', label: 'Sumber Daya' },
  { key: 'issues', label: 'Kendala' },
  { key: 'followUp', label: 'Tindak Lanjut' },
  { key: 'outcomeReflection', label: 'Refleksi Hasil' },
] as const;

interface ReportFormState {
  reportType: ActivityReportType;
  presentCount: string;
  absentCount: string;
  attendanceNotes: string;
  externalAttendanceSystem: string;
  externalAttendanceReferenceId: string;
  commonContent: Record<string, string>;
  typeSpecificContent: Record<string, string>;
}

interface ObservationFormState {
  subjectType: SessionObservationSubjectType;
  referenceId: string;
  summary: string;
  severity: SessionObservationSeverity;
  observedAt: string;
}

interface PromoteObservationFormState {
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  description: string;
  impact: string;
  blocksLaboratoryOperation: boolean;
  stepsTaken: string;
}

interface DraftSyncContext {
  baseVersion: number;
  baseSnapshot: ActivityReportEditableSnapshot;
  clientMutationId: string;
}

interface DraftConflictState {
  local: OfflineActivityReportDraft;
  server: ActivityReportDto;
  fields: string[];
}

type DraftSyncStatus = 'clean' | 'local' | 'syncing' | 'conflict';

interface BackfillFormState extends ReportFormState {
  laboratoryId: string;
  occurredOn: string;
  manualBackfillReason: string;
  responsibleName: string;
  activityDescription: string;
  plannedParticipantCount: string;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function severityTone(severity: SessionObservationSeverity): 'muted' | 'warning' | 'danger' {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  return 'muted';
}

function emptyCommon(): Record<string, string> {
  return Object.fromEntries(COMMON_FIELDS.map((field) => [field.key, '']));
}

function emptySpecific(type: ActivityReportType): Record<string, string> {
  return Object.fromEntries(TYPE_FIELDS[type].map((field) => [field.key, '']));
}

function reportForm(report: ActivityReportDto): ReportFormState {
  return {
    reportType: report.reportType,
    presentCount: report.attendance.presentCount === null ? '' : String(report.attendance.presentCount),
    absentCount: report.attendance.absentCount === null ? '' : String(report.attendance.absentCount),
    attendanceNotes: report.attendance.notes ?? '',
    externalAttendanceSystem: report.attendance.externalSystem ?? '',
    externalAttendanceReferenceId: report.attendance.externalReferenceId ?? '',
    commonContent: { ...emptyCommon(), ...Object.fromEntries(Object.entries(report.commonContent).map(([key, value]) => [key, value ?? ''])) },
    typeSpecificContent: { ...emptySpecific(report.reportType), ...Object.fromEntries(Object.entries(report.typeSpecificContent).map(([key, value]) => [key, value ?? ''])) },
  };
}

function reportFormFromSnapshot(snapshot: ActivityReportEditableSnapshot): ReportFormState {
  return {
    reportType: snapshot.reportType,
    presentCount: snapshot.presentCount === null ? '' : String(snapshot.presentCount),
    absentCount: snapshot.absentCount === null ? '' : String(snapshot.absentCount),
    attendanceNotes: snapshot.attendanceNotes ?? '',
    externalAttendanceSystem: snapshot.externalAttendanceSystem ?? '',
    externalAttendanceReferenceId: snapshot.externalAttendanceReferenceId ?? '',
    commonContent: {
      ...emptyCommon(),
      ...Object.fromEntries(Object.entries(snapshot.commonContent).map(([key, value]) => [key, value ?? ''])),
    },
    typeSpecificContent: {
      ...emptySpecific(snapshot.reportType),
      ...Object.fromEntries(Object.entries(snapshot.typeSpecificContent).map(([key, value]) => [key, value ?? ''])),
    },
  };
}

function compactContent(value: Record<string, string>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.trim() === '' ? null : item.trim()]));
}

function nullableCount(value: string): number | null {
  if (value.trim() === '') return null;
  return Number(value);
}

function editableSnapshotFromForm(form: ReportFormState): ActivityReportEditableSnapshot {
  return {
    reportType: form.reportType,
    presentCount: nullableCount(form.presentCount),
    absentCount: nullableCount(form.absentCount),
    attendanceNotes: form.attendanceNotes.trim() || null,
    externalAttendanceSystem: form.externalAttendanceSystem.trim() || null,
    externalAttendanceReferenceId: form.externalAttendanceReferenceId.trim() || null,
    commonContent: compactContent(form.commonContent),
    typeSpecificContent: compactContent(form.typeSpecificContent),
  };
}

function issueMessage(error: unknown): string {
  if (error instanceof LaboratorySessionContractError) return 'Respons Pelaksanaan Lab dari server tidak sesuai kontrak.';
  if (error instanceof ActivityReportContractError) return 'Respons Laporan Pelaksanaan dari server tidak sesuai kontrak.';
  if (error instanceof SessionObservationContractError) return 'Respons Temuan Pelaksanaan dari server tidak sesuai kontrak.';
  if (error instanceof ApiClientError) {
    if (error.code === 'LABORATORY_SESSION_VERSION_CONFLICT' || error.code === 'ACTIVITY_REPORT_VERSION_CONFLICT') {
      return 'Data sudah berubah di server. Data terbaru telah dimuat ulang.';
    }
    if (error.code === 'SESSION_SOURCE_CHANGED') return 'Sumber pelaksanaan berubah. Periksa jadwal/reservasi terbaru sebelum memulai.';
    if (error.code === 'LABORATORY_SESSION_STATE_CONFLICT' || error.code === 'ACTIVITY_REPORT_STATE_CONFLICT'
      || error.code === 'SESSION_ISSUE_OBSERVATION_STATE_CONFLICT') {
      return 'Status data sudah berubah dan aksi ini tidak lagi berlaku.';
    }
    if (error.code === 'ACTIVITY_REPORT_ATTACHMENT_UNAVAILABLE') return 'File bukti sedang tidak tersedia, tetapi metadata laporan tetap dapat dibaca.';
    if (error.code === 'ACTIVITY_REPORT_OFFLINE_SYNC_CONFLICT') return 'Draft lokal berbenturan dengan versi server yang lebih baru. Pilih cara penyelesaian konflik.';
    if (error.code === 'ACTIVITY_REPORT_SYNC_MUTATION_REUSED') return 'Identitas sinkronisasi sudah pernah dipakai untuk isi berbeda. Muat ulang draft sebelum mencoba lagi.';
    if (error.status === 403) return 'Anda tidak memiliki izin untuk aksi ini.';
    if (error.status === 422) return Object.values(error.errors ?? {}).flat()[0] ?? 'Data belum valid.';
    if (error.kind === 'network') return 'Layanan Pelaksanaan Lab tidak dapat dijangkau.';
  }
  return 'Operasi Pelaksanaan Lab gagal.';
}

function sessionTimelineLabel(event: LaboratorySessionDto['timeline'][number]): string {
  const labels: Record<string, string> = {
    'laboratory_session.prepared': 'Pelaksanaan disiapkan',
    'laboratory_session.started': 'Pelaksanaan dimulai',
    'laboratory_session.ended': 'Pelaksanaan diakhiri',
    'laboratory_session.cancelled': 'Pelaksanaan dibatalkan',
  };
  return labels[event.eventType] ?? event.eventType;
}

function reportTimelineLabel(event: ActivityReportDto['timeline'][number]): string {
  const labels: Record<string, string> = {
    'activity_report.created': 'Draft laporan dibuat otomatis',
    'activity_report.manual_backfill_created': 'Backfill laporan dibuat',
    'activity_report.updated': 'Draft laporan diperbarui',
    'activity_report.offline_sync_applied': 'Draft laporan disinkronkan',
    'activity_report.submitted': 'Laporan diajukan',
    'activity_report.revision_requested': 'Perbaikan diminta',
    'activity_report.reopened': 'Laporan dibuka kembali',
    'activity_report.verified': 'Laporan diverifikasi',
  };
  return labels[event.eventType] ?? event.eventType;
}

export function SessionsPage() {
  const user = useAuthStore((state) => state.user);
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const canViewAllSessions = hasServerPermission(user, 'sessions.view-all');
  const canPrepare = hasServerPermission(user, 'sessions.prepare');
  const canStart = hasServerPermission(user, 'sessions.start');
  const canEnd = hasServerPermission(user, 'sessions.end');
  const canCancel = hasServerPermission(user, 'sessions.cancel');
  const canExportSessions = hasServerPermission(user, 'sessions.export');

  const canViewReports = hasServerPermission(user, 'activity-reports.view');
  const canViewAllReports = hasServerPermission(user, 'activity-reports.view-all');
  const canEditReport = hasServerPermission(user, 'activity-reports.edit');
  const canSubmitReport = hasServerPermission(user, 'activity-reports.submit');
  const canVerifyReport = hasServerPermission(user, 'activity-reports.verify');
  const canRequestRevision = hasServerPermission(user, 'activity-reports.request-revision');
  const canBackfill = hasServerPermission(user, 'activity-reports.create-backfill');
  const canExportReports = hasServerPermission(user, 'activity-reports.export');

  const canViewObservations = hasServerPermission(user, 'session-observations.view');
  const canCreateObservation = hasServerPermission(user, 'session-observations.create');
  const canPromoteObservation = hasServerPermission(user, 'session-observations.promote')
    && hasServerPermission(user, 'incidents.create');

  const offlineIdentity = useMemo<OfflineDraftIdentity | null>(() => user ? ({
    userId: user.id,
    membershipId: user.membership.id,
    schoolId: user.school.id,
  }) : null, [user]);

  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);

  const today = useMemo(() => dateKey(new Date()), []);
  const defaultFrom = useMemo(() => dateKey(addDays(new Date(), -90)), []);
  const [historyFrom, setHistoryFrom] = useState(defaultFrom);
  const [historyTo, setHistoryTo] = useState(today);

  const requestedTab = searchParams.get('tab');
  const activeTab: TabKey = ['today', 'in-progress', 'awaiting-report', 'history'].includes(requestedTab ?? '')
    && (requestedTab !== 'awaiting-report' || canViewReports)
    ? requestedTab as TabKey
    : 'today';

  const [sources, setSources] = useState<LaboratorySessionSourceDto[]>([]);
  const [sessions, setSessions] = useState<LaboratorySessionDto[]>([]);
  const [reports, setReports] = useState<ActivityReportDto[]>([]);
  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [prepareSource, setPrepareSource] = useState<LaboratorySessionSourceDto | null>(null);
  const [prepareForm, setPrepareForm] = useState<Pick<PrepareLaboratorySessionInput, 'openingCondition' | 'operationalNotes'>>({
    openingCondition: '',
    operationalNotes: '',
  });
  const [endSession, setEndSession] = useState<LaboratorySessionDto | null>(null);
  const [endForm, setEndForm] = useState<EndLaboratorySessionInput>({ endOutcome: 'completed', closingCondition: '', operationalNotes: '' });
  const [cancelSession, setCancelSession] = useState<LaboratorySessionDto | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [observations, setObservations] = useState<SessionIssueObservationDto[]>([]);
  const [observationSession, setObservationSession] = useState<LaboratorySessionDto | null>(null);
  const [observationForm, setObservationForm] = useState<ObservationFormState>({
    subjectType: 'other',
    referenceId: '',
    summary: '',
    severity: 'medium',
    observedAt: localDateTimeValue(),
  });
  const [observationDevices, setObservationDevices] = useState<IncidentReportingDeviceDto[]>([]);
  const [observationDeviceSearch, setObservationDeviceSearch] = useState('');
  const [observationDeviceBusy, setObservationDeviceBusy] = useState(false);
  const [promoteObservation, setPromoteObservation] = useState<SessionIssueObservationDto | null>(null);
  const [promoteForm, setPromoteForm] = useState<PromoteObservationFormState>({
    category: 'other',
    priority: 'normal',
    title: '',
    description: '',
    impact: '',
    blocksLaboratoryOperation: false,
    stepsTaken: '',
  });

  const [sessionDetail, setSessionDetail] = useState<LaboratorySessionDto | null>(null);
  const [reportDetail, setReportDetail] = useState<ActivityReportDto | null>(null);
  const [editingReport, setEditingReport] = useState<ActivityReportDto | null>(null);
  const [reportEditForm, setReportEditForm] = useState<ReportFormState | null>(null);
  const [draftSyncContext, setDraftSyncContext] = useState<DraftSyncContext | null>(null);
  const [draftSyncStatus, setDraftSyncStatus] = useState<DraftSyncStatus>('clean');
  const [draftConflict, setDraftConflict] = useState<DraftConflictState | null>(null);
  const [revisionReport, setRevisionReport] = useState<ActivityReportDto | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
  const [attachments, setAttachments] = useState<ActivityReportAttachmentDto[]>([]);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillForm, setBackfillForm] = useState<BackfillFormState>({
    reportType: 'general',
    laboratoryId: '',
    occurredOn: today,
    manualBackfillReason: '',
    responsibleName: user?.name ?? '',
    activityDescription: '',
    plannedParticipantCount: '',
    presentCount: '',
    absentCount: '',
    attendanceNotes: '',
    externalAttendanceSystem: '',
    externalAttendanceReferenceId: '',
    commonContent: emptyCommon(),
    typeSpecificContent: emptySpecific('general'),
  });

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener('online', markOnline);
    window.addEventListener('offline', markOffline);
    return () => {
      window.removeEventListener('online', markOnline);
      window.removeEventListener('offline', markOffline);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const scopeSessions = canViewAllSessions ? 'all' : 'mine';
      const scopeReports = canViewAllReports ? 'all' : 'mine';
      const [sourceRows, sessionRows, reportRows, labRows] = await Promise.all([
        laboratorySessionGateway.sources({ from: today, to: today, scope: scopeSessions }),
        laboratorySessionGateway.listAll({ from: historyFrom, to: historyTo, scope: scopeSessions }),
        canViewReports
          ? activityReportGateway.listAll({ from: historyFrom, to: historyTo, scope: scopeReports })
          : Promise.resolve([]),
        canBackfill ? laboratoryGateway.list() : Promise.resolve([]),
      ]);
      setSources(sourceRows);
      setSessions(sessionRows);
      setReports(reportRows);
      setLabs(labRows);
    } catch (cause) {
      setError(issueMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [canBackfill, canViewAllReports, canViewAllSessions, canViewReports, historyFrom, historyTo, today]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const sessionId = params.id;
    if (!sessionId || loading) return;
    const current = sessions.find((item) => item.id === sessionId);
    if (current) {
      setSessionDetail(current);
      return;
    }
    void laboratorySessionGateway.show(sessionId).then(setSessionDetail).catch((cause) => setError(issueMessage(cause)));
  }, [loading, params.id, sessions]);

  useEffect(() => {
    const reportId = searchParams.get('reportId');
    if (!reportId || !canViewReports || loading) return;
    const current = reports.find((item) => item.id === reportId);
    if (current) {
      setReportDetail(current);
      return;
    }
    void activityReportGateway.show(reportId).then(setReportDetail).catch((cause) => setError(issueMessage(cause)));
  }, [canViewReports, loading, reports, searchParams]);

  useEffect(() => {
    if (!sessionDetail || !canViewObservations) {
      setObservations([]);
      return;
    }
    if (!online) return;
    let active = true;
    void sessionObservationGateway.list(sessionDetail.id)
      .then((items) => { if (active) setObservations(items); })
      .catch((cause) => { if (active) toast(issueMessage(cause), 'error'); });
    return () => { active = false; };
  }, [canViewObservations, online, sessionDetail]);

  useEffect(() => {
    const report = editingReport ?? reportDetail;
    if (!report || !canViewReports) {
      setAttachments([]);
      return;
    }
    if (!online) return;
    let active = true;
    void activityReportGateway.attachments(report.id)
      .then((items) => { if (active) setAttachments(items); })
      .catch((cause) => { if (active) toast(issueMessage(cause), 'error'); });
    return () => { active = false; };
  }, [canViewReports, editingReport, online, reportDetail]);

  useEffect(() => {
    if (!editingReport || !reportEditForm || !draftSyncContext || !offlineIdentity
      || editingReport.status !== 'draft' || draftConflict) {
      return;
    }

    const draftSnapshot = editableSnapshotFromForm(reportEditForm);
    if (isEditableSnapshotEqual(draftSyncContext.baseSnapshot, draftSnapshot)) {
      clearOfflineActivityReportDraft(offlineIdentity, editingReport.id);
      setDraftSyncStatus((current) => current === 'syncing' ? current : 'clean');
      return;
    }

    const local = makeOfflineActivityReportDraft(
      offlineIdentity,
      editingReport.id,
      draftSyncContext.baseVersion,
      draftSyncContext.baseSnapshot,
      draftSnapshot,
      draftSyncContext.clientMutationId,
    );
    saveOfflineActivityReportDraft(local);
    setDraftSyncStatus((current) => current === 'syncing' ? current : 'local');
  }, [draftConflict, draftSyncContext, editingReport, offlineIdentity, reportEditForm]);

  const inProgress = useMemo(() => sessions.filter((session) => session.status === 'in_progress'), [sessions]);
  const awaiting = useMemo(
    () => reports.filter((report) => report.status === 'draft' || report.status === 'revision_required'),
    [reports],
  );

  function changeTab(tab: string) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    next.delete('reportId');
    setSearchParams(next);
  }

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast(success, 'success');
      await load();
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!prepareSource || !canPrepare) return;
    if (!online) {
      toast('Menyiapkan Pelaksanaan tetap online-only karena sumber harus divalidasi server.', 'info');
      return;
    }
    const source = prepareSource;
    setBusy(true);
    try {
      const prepared = await laboratorySessionGateway.prepare({
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        openingCondition: prepareForm.openingCondition?.trim() || null,
        operationalNotes: prepareForm.operationalNotes?.trim() || null,
      });
      setPrepareSource(null);
      toast('Pelaksanaan berhasil disiapkan.', 'success');
      await load();
      setSessionDetail(prepared);
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function start(sessionId: string, version: number) {
    if (!canStart) return;
    if (!online) {
      toast('Mulai Pelaksanaan tetap online-only karena server harus memvalidasi sumber dan availability.', 'info');
      return;
    }
    await mutate(async () => {
      const result = await laboratorySessionGateway.start(sessionId, version);
      setSessionDetail(result);
    }, 'Pelaksanaan dimulai.');
  }

  async function finish() {
    if (!endSession || !canEnd) return;
    if (!online) {
      toast('Mengakhiri Pelaksanaan tetap online-only karena Session dan draft laporan harus dibuat atomik.', 'info');
      return;
    }
    const current = endSession;
    setBusy(true);
    try {
      const result = await laboratorySessionGateway.end(current.id, current.version, {
        endOutcome: endForm.endOutcome,
        closingCondition: endForm.closingCondition?.trim() || null,
        operationalNotes: endForm.operationalNotes?.trim() || null,
      });
      setEndSession(null);
      toast('Pelaksanaan diakhiri dan draft laporan dibuat.', 'success');
      await load();
      if (canViewReports && result.activityReport) {
        const report = await activityReportGateway.show(result.activityReport.id);
        restoreDraftEditor(report);
        const next = new URLSearchParams(searchParams);
        next.set('tab', 'awaiting-report');
        next.set('reportId', report.id);
        setSearchParams(next);
      }
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelPrepared() {
    if (!cancelSession || !canCancel || cancelReason.trim() === '') return;
    if (!online) {
      toast('Pembatalan Pelaksanaan memerlukan koneksi ke server.', 'info');
      return;
    }
    const current = cancelSession;
    await mutate(async () => {
      await laboratorySessionGateway.cancel(current.id, current.version, cancelReason);
      setCancelSession(null);
      setCancelReason('');
    }, 'Pelaksanaan dibatalkan.');
  }

  function openObservationDialog(session: LaboratorySessionDto) {
    setObservationSession(session);
    setObservationDevices([]);
    setObservationDeviceSearch('');
    setObservationForm({
      subjectType: 'other',
      referenceId: '',
      summary: '',
      severity: 'medium',
      observedAt: localDateTimeValue(),
    });
  }

  async function searchObservationDevices() {
    if (!observationSession || observationDeviceSearch.trim().length < 2) return;
    if (!online) {
      toast('Pencarian Device canonical memerlukan koneksi ke server.', 'info');
      return;
    }
    setObservationDeviceBusy(true);
    try {
      const result = await incidentGateway.reportingDevices(observationSession.laboratory.id, observationDeviceSearch);
      setObservationDevices(result.data);
      if (observationForm.referenceId && !result.data.some((device) => device.id === observationForm.referenceId)) {
        setObservationForm((current) => ({ ...current, referenceId: '' }));
      }
    } catch (cause) {
      toast(issueMessage(cause), 'error');
    } finally {
      setObservationDeviceBusy(false);
    }
  }

  async function createObservation() {
    if (!observationSession || !canCreateObservation || observationForm.summary.trim() === '') return;
    if (!online) {
      toast('Pencatatan Temuan tetap online-only pada S3.6.', 'info');
      return;
    }
    if (observationForm.subjectType === 'device' && observationForm.referenceId === '') {
      toast('Pilih Device canonical untuk temuan perangkat.', 'error');
      return;
    }

    setBusy(true);
    try {
      await sessionObservationGateway.create(observationSession.id, {
        subjectType: observationForm.subjectType,
        referenceId: observationForm.subjectType === 'device' ? observationForm.referenceId : null,
        summary: observationForm.summary,
        severity: observationForm.severity,
        observedAt: new Date(observationForm.observedAt).toISOString(),
      });
      setObservationSession(null);
      setObservations(await sessionObservationGateway.list(observationSession.id));
      toast('Temuan tersimpan sebagai evidence. Incident belum dibuat.', 'success');
    } catch (cause) {
      toast(issueMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openPromotion(observation: SessionIssueObservationDto) {
    const category: IncidentCategory = observation.subjectType === 'device'
      ? 'hardware'
      : observation.subjectType === 'facility' ? 'facility' : 'other';
    const priority: IncidentPriority = observation.severity === 'critical'
      ? 'critical'
      : observation.severity === 'high' ? 'high' : 'normal';
    setPromoteObservation(observation);
    setPromoteForm({
      category,
      priority,
      title: observation.referenceCode
        ? `${observation.referenceCode}: ${observation.summary.slice(0, 150)}`
        : observation.summary.slice(0, 180),
      description: `Temuan Pelaksanaan Lab: ${observation.summary}`,
      impact: '',
      blocksLaboratoryOperation: observation.severity === 'critical',
      stepsTaken: '',
    });
  }

  async function promoteToIncident() {
    if (!promoteObservation || !canPromoteObservation || promoteForm.title.trim() === '' || promoteForm.description.trim() === '') return;
    if (!online) {
      toast('Promosi ke Incident tetap online-only.', 'info');
      return;
    }
    setBusy(true);
    try {
      const updated = await sessionObservationGateway.promote(promoteObservation.id, {
        category: promoteForm.category,
        priority: promoteForm.priority,
        title: promoteForm.title,
        description: promoteForm.description,
        impact: promoteForm.impact || null,
        blocksLaboratoryOperation: promoteForm.blocksLaboratoryOperation,
        stepsTaken: promoteForm.stepsTaken || null,
      });
      setObservations((items) => items.map((item) => item.id === updated.id ? updated : item));
      setPromoteObservation(null);
      toast(`Incident ${updated.incident?.ticketNumber ?? ''} dibuat dan ditautkan secara eksplisit.`, 'success');
    } catch (cause) {
      toast(issueMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function uploadAttachment(report: ActivityReportDto) {
    if (!attachmentFile || !canEditReport || report.status !== 'draft') return;
    if (!online) {
      toast('Upload lampiran tetap online-only. Draft teks lokal tidak akan hilang.', 'info');
      return;
    }
    if (draftSyncStatus !== 'clean') {
      toast('Sinkronkan draft teks terlebih dahulu sebelum mengunggah lampiran.', 'info');
      return;
    }
    setAttachmentBusy(true);
    try {
      await activityReportGateway.uploadAttachment(report.id, report.version, attachmentFile);
      const fresh = await activityReportGateway.show(report.id);
      const items = await activityReportGateway.attachments(report.id);
      setAttachments(items);
      setAttachmentFile(null);
      if (editingReport?.id === report.id) {
        setDraftEditorFromServer(fresh);
      }
      if (reportDetail?.id === report.id) setReportDetail(fresh);
      toast('Bukti tersimpan di private storage dan checksum SHA-256 tercatat.', 'success');
      await load();
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      const fresh = await activityReportGateway.show(report.id).catch(() => null);
      if (fresh && editingReport?.id === report.id) setEditingReport(fresh);
      if (fresh && reportDetail?.id === report.id) setReportDetail(fresh);
    } finally {
      setAttachmentBusy(false);
    }
  }

  function openAttachment(attachment: ActivityReportAttachmentDto) {
    if (!online) {
      toast('Download lampiran memerlukan koneksi ke private storage server.', 'info');
      return;
    }
    if (!attachment.available) {
      toast('File bukti sedang tidak tersedia. Metadata tetap dipertahankan.', 'info');
      return;
    }
    window.open(activityReportAttachmentDownloadUrl(attachment.reportId, attachment.id), '_blank', 'noopener,noreferrer');
  }

  function setDraftEditorFromServer(report: ActivityReportDto): void {
    const baseSnapshot = editableSnapshotFromReport(report);
    setEditingReport(report);
    setReportEditForm(reportForm(report));
    setDraftSyncContext({
      baseVersion: report.version,
      baseSnapshot,
      clientMutationId: createClientMutationId(),
    });
    setDraftConflict(null);
    setDraftSyncStatus('clean');
  }

  function restoreDraftEditor(report: ActivityReportDto): void {
    if (!offlineIdentity) {
      setDraftEditorFromServer(report);
      return;
    }

    const cached = loadOfflineActivityReportDraft(offlineIdentity, report.id);
    if (!cached) {
      setDraftEditorFromServer(report);
      return;
    }

    setEditingReport(report);
    setReportEditForm(reportFormFromSnapshot(cached.draftSnapshot));
    setDraftSyncContext({
      baseVersion: cached.baseVersion,
      baseSnapshot: cached.baseSnapshot,
      clientMutationId: cached.clientMutationId,
    });

    if (cached.baseVersion !== report.version) {
      setDraftConflict({
        local: cached,
        server: report,
        fields: conflictingEditableFields(
          cached.baseSnapshot,
          cached.draftSnapshot,
          editableSnapshotFromReport(report),
        ),
      });
      setDraftSyncStatus('conflict');
      return;
    }

    setDraftConflict(null);
    setDraftSyncStatus('local');
  }

  function closeDraftEditor(): void {
    setEditingReport(null);
    setReportEditForm(null);
    setDraftSyncContext(null);
    setDraftConflict(null);
    setDraftSyncStatus('clean');
  }

  async function openReport(report: ActivityReportDto) {
    if (!online) {
      setReportDetail(report);
      return;
    }

    setBusy(true);
    try {
      const fresh = await activityReportGateway.show(report.id);
      setReportDetail(fresh);
    } catch (cause) {
      toast(issueMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function editReport(report: ActivityReportDto) {
    if (!canEditReport) return;
    setBusy(true);
    try {
      let fresh = online ? await activityReportGateway.show(report.id) : report;
      if (fresh.status === 'revision_required') {
        if (!online) {
          toast('Membuka ulang laporan revisi memerlukan koneksi ke server.', 'info');
          return;
        }
        fresh = await activityReportGateway.reopen(fresh.id, fresh.version);
      }
      restoreDraftEditor(fresh);
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      if (online) await load();
    } finally {
      setBusy(false);
    }
  }

  function currentOfflineDraft(): OfflineActivityReportDraft | null {
    if (!editingReport || !reportEditForm || !draftSyncContext || !offlineIdentity) return null;
    return makeOfflineActivityReportDraft(
      offlineIdentity,
      editingReport.id,
      draftSyncContext.baseVersion,
      draftSyncContext.baseSnapshot,
      editableSnapshotFromForm(reportEditForm),
      draftSyncContext.clientMutationId,
    );
  }

  async function synchronizeEditingDraft(submitAfter: boolean): Promise<void> {
    if (!editingReport || !reportEditForm || !draftSyncContext || !offlineIdentity || !canEditReport) return;
    const local = currentOfflineDraft();
    if (!local) return;

    const patch = diffEditableSnapshot(local.baseSnapshot, local.draftSnapshot);
    if (Object.keys(patch).length === 0) {
      clearOfflineActivityReportDraft(offlineIdentity, editingReport.id);
      setDraftSyncStatus('clean');
      if (submitAfter) {
        if (!online) {
          toast('Pengajuan laporan tetap online-only. Draft lokal aman di perangkat ini.', 'info');
          return;
        }
        const submitted = await activityReportGateway.submit(editingReport.id, editingReport.version);
        closeDraftEditor();
        setReportDetail(submitted);
        toast('Laporan diajukan untuk verifikasi.', 'success');
        await load();
      } else {
        toast('Tidak ada perubahan draft yang perlu disinkronkan.', 'info');
      }
      return;
    }

    saveOfflineActivityReportDraft(local);

    if (!online) {
      setDraftSyncStatus('local');
      toast(
        submitAfter
          ? 'Draft tersimpan lokal. Pengajuan akan tersedia setelah koneksi kembali.'
          : 'Draft tersimpan lokal di perangkat ini dan belum menjadi versi kanonik server.',
        'info',
      );
      return;
    }

    setBusy(true);
    setDraftSyncStatus('syncing');
    try {
      const result = await activityReportGateway.syncDraft(editingReport.id, {
        clientMutationId: local.clientMutationId,
        baseVersion: local.baseVersion,
        patch,
      });
      clearOfflineActivityReportDraft(offlineIdentity, editingReport.id);

      if (result.report.status !== 'draft') {
        closeDraftEditor();
        setReportDetail(result.report);
        toast('Draft sudah pernah diterapkan; status server terbaru dimuat.', 'info');
        await load();
        return;
      }

      if (result.report.version !== result.sync.appliedVersion) {
        setDraftEditorFromServer(result.report);
        toast(
          submitAfter
            ? 'Mutation lokal sudah pernah diterapkan, tetapi server berubah lagi setelahnya. Periksa versi terbaru sebelum mengajukan.'
            : 'Mutation lokal sudah pernah diterapkan dan server memiliki perubahan lebih baru. Editor dimuat dari versi terbaru.',
          'info',
        );
        await load();
        return;
      }

      if (submitAfter) {
        const submitted = await activityReportGateway.submit(result.report.id, result.report.version);
        closeDraftEditor();
        setReportDetail(submitted);
        toast('Draft tersinkron dan laporan diajukan untuk verifikasi.', 'success');
        await load();
        return;
      }

      setDraftEditorFromServer(result.report);
      toast(result.sync.replayed ? 'Retry sinkronisasi dikonfirmasi tanpa duplikasi.' : 'Draft tersinkron ke server.', 'success');
      await load();
    } catch (cause) {
      if (cause instanceof ApiClientError
        && (cause.code === 'ACTIVITY_REPORT_OFFLINE_SYNC_CONFLICT' || cause.code === 'ACTIVITY_REPORT_STATE_CONFLICT')) {
        const server = await activityReportGateway.show(editingReport.id).catch(() => null);
        if (server) {
          setEditingReport(server);
          setDraftConflict({
            local,
            server,
            fields: conflictingEditableFields(
              local.baseSnapshot,
              local.draftSnapshot,
              editableSnapshotFromReport(server),
            ),
          });
          setDraftSyncStatus('conflict');
          toast(
            server.status === 'draft'
              ? 'Versi server lebih baru. Draft lokal dipertahankan sampai konflik diselesaikan.'
              : 'Lifecycle laporan berubah di server. Draft lokal dipertahankan untuk ditinjau, tetapi tidak dapat disinkronkan ke status ini.',
            'info',
          );
          return;
        }
      }

      if (cause instanceof ApiClientError && cause.kind === 'network') {
        saveOfflineActivityReportDraft(local);
        setDraftSyncStatus('local');
        toast('Koneksi terputus. Draft tetap aman di cache lokal dan dapat di-retry dengan ID yang sama.', 'info');
        return;
      }

      setDraftSyncStatus('local');
      toast(issueMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    await synchronizeEditingDraft(false);
  }

  async function submitReport(report: ActivityReportDto) {
    if (!canSubmitReport) return;
    if (!online) {
      toast('Pengajuan laporan memerlukan koneksi ke server.', 'info');
      return;
    }
    await mutate(async () => {
      const updated = await activityReportGateway.submit(report.id, report.version);
      if (offlineIdentity) clearOfflineActivityReportDraft(offlineIdentity, report.id);
      setReportDetail(updated);
      closeDraftEditor();
    }, 'Laporan diajukan untuk verifikasi.');
  }

  async function saveAndSubmitReport() {
    if (!canSubmitReport) return;
    await synchronizeEditingDraft(true);
  }

  function useServerConflictVersion(): void {
    if (!draftConflict || !offlineIdentity) return;
    clearOfflineActivityReportDraft(offlineIdentity, draftConflict.server.id);
    setDraftEditorFromServer(draftConflict.server);
    toast('Draft lokal dibuang. Editor memakai versi kanonik server.', 'info');
  }

  function rebaseLocalConflictVersion(): void {
    if (!draftConflict || !offlineIdentity) return;
    if (draftConflict.server.status !== 'draft') {
      toast('Rebase hanya dapat dilakukan ketika versi kanonik server masih berstatus draft.', 'info');
      return;
    }

    const serverSnapshot = editableSnapshotFromReport(draftConflict.server);
    const rebased = rebaseEditableSnapshot(
      draftConflict.local.baseSnapshot,
      draftConflict.local.draftSnapshot,
      serverSnapshot,
    );
    const clientMutationId = createClientMutationId();
    const next = makeOfflineActivityReportDraft(
      offlineIdentity,
      draftConflict.server.id,
      draftConflict.server.version,
      serverSnapshot,
      rebased,
      clientMutationId,
    );

    clearOfflineActivityReportDraft(offlineIdentity, draftConflict.server.id);
    saveOfflineActivityReportDraft(next);
    setEditingReport(draftConflict.server);
    setReportEditForm(reportFormFromSnapshot(rebased));
    setDraftSyncContext({
      baseVersion: draftConflict.server.version,
      baseSnapshot: serverSnapshot,
      clientMutationId,
    });
    setDraftConflict(null);
    setDraftSyncStatus('local');
    toast('Draft lokal direbase ke versi server terbaru. Periksa lalu sinkronkan.', 'success');
  }

  async function verifyReport(report: ActivityReportDto) {
    if (!canVerifyReport) return;
    if (!online) {
      toast('Verifikasi laporan tetap online-only.', 'info');
      return;
    }
    await mutate(async () => {
      const updated = await activityReportGateway.verify(report.id, report.version);
      setReportDetail(updated);
    }, 'Laporan diverifikasi.');
  }

  async function requestRevision() {
    if (!revisionReport || !canRequestRevision || revisionReason.trim() === '') return;
    if (!online) {
      toast('Permintaan revisi tetap online-only.', 'info');
      return;
    }
    const report = revisionReport;
    await mutate(async () => {
      const updated = await activityReportGateway.requestRevision(report.id, report.version, revisionReason);
      setReportDetail(updated);
      setRevisionReport(null);
      setRevisionReason('');
    }, 'Laporan dikembalikan untuk diperbaiki.');
  }

  async function createBackfill() {
    if (!online) {
      toast('Backfill historis tetap online-only.', 'info');
      return;
    }
    if (!canBackfill || backfillForm.laboratoryId === '' || backfillForm.manualBackfillReason.trim() === ''
      || backfillForm.responsibleName.trim() === '' || backfillForm.activityDescription.trim() === '') {
      toast('Lengkapi bukti wajib backfill.', 'error');
      return;
    }
    const form = backfillForm;
    const payload: CreateActivityReportBackfillInput = {
      reportType: form.reportType,
      laboratoryId: form.laboratoryId,
      occurredOn: form.occurredOn,
      manualBackfillReason: form.manualBackfillReason.trim(),
      responsibleName: form.responsibleName.trim(),
      activityDescription: form.activityDescription.trim(),
      plannedParticipantCount: nullableCount(form.plannedParticipantCount),
      presentCount: nullableCount(form.presentCount),
      absentCount: nullableCount(form.absentCount),
      attendanceNotes: form.attendanceNotes.trim() || null,
      externalAttendanceSystem: form.externalAttendanceSystem.trim() || null,
      externalAttendanceReferenceId: form.externalAttendanceReferenceId.trim() || null,
      commonContent: compactContent(form.commonContent),
      typeSpecificContent: compactContent(form.typeSpecificContent),
    };
    setBusy(true);
    try {
      const created = await activityReportGateway.backfill(payload);
      setBackfillOpen(false);
      toast('Backfill laporan dibuat sebagai draft.', 'success');
      await load();
      restoreDraftEditor(created);
    } catch (cause) {
      toast(issueMessage(cause), 'error');
    } finally {
      setBusy(false);
    }
  }

  function exportCanonical() {
    if (activeTab === 'history' && canExportReports) {
      downloadCSV('laporan-pelaksanaan.csv', reports.map((report) => ({
        Nomor: report.reportNumber,
        Tanggal: report.occurredOn,
        Lab: report.laboratory.name,
        PenanggungJawab: report.responsibility.name,
        Kelas: report.responsibility.academicClass?.name ?? '',
        Mapel: report.responsibility.subject?.name ?? '',
        Tipe: REPORT_TYPE_LABELS[report.reportType],
        Status: report.status,
        Hadir: report.attendance.presentCount ?? '',
        TidakHadir: report.attendance.absentCount ?? '',
        Sumber: report.origin,
      })));
      return;
    }
    if (canExportSessions) {
      downloadCSV('pelaksanaan-lab.csv', sessions.map((session) => ({
        Nomor: session.sessionNumber,
        Tanggal: session.source.date,
        Lab: session.laboratory.name,
        PenanggungJawab: session.responsibility.name,
        Kelas: session.responsibility.academicClass?.name ?? '',
        Mapel: session.responsibility.subject?.name ?? '',
        Status: session.status,
        MulaiAktual: session.actualStartedAt ?? '',
        SelesaiAktual: session.actualEndedAt ?? '',
      })));
    }
  }

  function sessionActions(source: LaboratorySessionSourceDto) {
    const session = source.session;
    if (!session && canPrepare) {
      return <Button size="sm" icon={<BookOpen className="h-3.5 w-3.5" />} disabled={!online} onClick={() => {
        setPrepareSource(source);
        setPrepareForm({ openingCondition: '', operationalNotes: '' });
      }}>Siapkan</Button>;
    }
    if (!session) return <Badge tone="muted">Belum disiapkan</Badge>;
    if (session.status === 'prepared') {
      return (
        <div className="flex flex-wrap gap-1">
          {canStart && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} disabled={!online} onClick={() => void start(session.id, session.version)}>Mulai</Button>}
          {canCancel && <Button size="sm" variant="ghost" icon={<XCircle className="h-3.5 w-3.5" />} disabled={!online} onClick={() => setCancelSession(sessions.find((item) => item.id === session.id) ?? null)}>Batal</Button>}
        </div>
      );
    }
    if (session.status === 'in_progress') {
      return <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} disabled={!online} onClick={() => {
        const full = sessions.find((item) => item.id === session.id);
        if (full) {
          setEndSession(full);
          setEndForm({ endOutcome: 'completed', closingCondition: '', operationalNotes: '' });
        }
      }}>Akhiri</Button>;
    }
    if (session.activityReport && canViewReports) {
      return <Button size="sm" variant="secondary" icon={<FileText className="h-3.5 w-3.5" />} onClick={() => {
        const report = reports.find((item) => item.id === session.activityReport?.id);
        if (report) void openReport(report);
      }}>Laporan</Button>;
    }
    return <StatusBadge status={session.status} />;
  }

  const tabs = [
    { key: 'today', label: `Hari Ini (${sources.length})`, icon: <Clock3 className="h-4 w-4" /> },
    { key: 'in-progress', label: `Sedang Berlangsung (${inProgress.length})`, icon: <Play className="h-4 w-4" /> },
    ...(canViewReports ? [{ key: 'awaiting-report', label: `Menunggu Laporan (${awaiting.length})`, icon: <FileText className="h-4 w-4" /> }] : []),
    { key: 'history', label: 'Riwayat & Laporan', icon: <History className="h-4 w-4" /> },
  ];

  if (loading) return <LoadingState label="Memuat Pelaksanaan Lab dari server..." />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pelaksanaan Lab"
        description="Satu workflow canonical dari sumber kegiatan, pelaksanaan aktual, hingga laporan terverifikasi."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={busy} disabled={!online}>Muat Ulang</Button>
            {(canExportSessions || canExportReports) && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCanonical}>Export</Button>}
            {canBackfill && <Button size="sm" icon={<Plus className="h-4 w-4" />} disabled={!online} onClick={() => {
              const nextType: ActivityReportType = 'general';
              setBackfillForm({
                reportType: nextType,
                laboratoryId: labs[0]?.id ?? '',
                occurredOn: today,
                manualBackfillReason: '',
                responsibleName: user?.name ?? '',
                activityDescription: '',
                plannedParticipantCount: '',
                presentCount: '',
                absentCount: '',
                attendanceNotes: '',
                externalAttendanceSystem: '',
                externalAttendanceReferenceId: '',
                commonContent: emptyCommon(),
                typeSpecificContent: emptySpecific(nextType),
              });
              setBackfillOpen(true);
            }}>Backfill Laporan</Button>}
          </>
        }
      />

      {!online && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning-foreground">
          <p className="font-semibold">Mode offline terbatas</p>
          <p className="mt-1">
            Hanya working copy draft ActivityReport yang dapat disimpan lokal. Session lifecycle, Temuan/Incident, submit/verifikasi, backfill, dan attachment tetap online-only.
          </p>
        </div>
      )}

      <Card>
        <CardContent>
          <p className="text-sm text-ink-secondary">
            Data pada halaman ini berasal dari API canonical SmartLab. Sumber normal hanya Jadwal TESSELA, Reservasi yang disetujui, atau Kegiatan Prioritas yang disetujui. Tidak ada lagi Session/Journal browser-local pada route ini.
          </p>
        </CardContent>
      </Card>

      <Tabs tabs={tabs} active={activeTab} onChange={changeTab} />

      {activeTab === 'today' && (
        <div className="space-y-3">
          {sources.length === 0 ? (
            <Card><EmptyState title="Tidak ada sumber pelaksanaan hari ini" description="Sumber yang dibatalkan, tidak aktif, atau di luar scope Anda tidak ditampilkan." /></Card>
          ) : sources.map((source) => (
            <Card key={`${source.sourceType}:${source.sourceId}`}>
              <CardContent>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{SOURCE_LABELS[source.sourceType]}</Badge>
                      {source.session && <StatusBadge status={source.session.status} />}
                      {source.session?.activityReport && <StatusBadge status={source.session.activityReport.status} />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink-primary">{source.title}</h3>
                      <p className="text-sm text-ink-muted">{source.subtitle || source.sourceNumber}</p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-secondary">
                      <span>{source.startsAt.slice(0, 5)}–{source.endsAt.slice(0, 5)}</span>
                      <span>{source.laboratory.name}</span>
                      <span>{source.responsibility.name}</span>
                      <span>{source.responsibility.plannedParticipantCount} peserta</span>
                    </div>
                  </div>
                  <div className="shrink-0">{sessionActions(source)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'in-progress' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {inProgress.length === 0 ? <Card className="lg:col-span-2"><EmptyState title="Tidak ada pelaksanaan yang sedang berlangsung" /></Card> : inProgress.map((session) => (
            <Card key={session.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Badge tone="warning">Sedang Berlangsung</Badge>
                    <h3 className="mt-2 font-semibold text-ink-primary">{session.responsibility.subject?.name ?? session.sessionNumber}</h3>
                    <p className="text-sm text-ink-muted">{session.responsibility.academicClass?.name ?? session.responsibility.name}</p>
                  </div>
                  <Button size="sm" variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setSessionDetail(session)}>Detail</Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-ink-muted">Laboratorium</p><p className="text-ink-primary">{session.laboratory.name}</p></div>
                  <div><p className="text-xs text-ink-muted">Mulai aktual</p><p className="text-ink-primary">{session.actualStartedAt ? relativeTime(session.actualStartedAt) : '-'}</p></div>
                </div>
                {canEnd && <Button className="mt-4 w-full" variant="danger" icon={<Square className="h-4 w-4" />} disabled={!online} onClick={() => {
                  setEndSession(session);
                  setEndForm({ endOutcome: 'completed', closingCondition: '', operationalNotes: '' });
                }}>Akhiri Pelaksanaan</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 'awaiting-report' && canViewReports && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                <th className="px-4 py-3 font-medium">Laporan</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Lab</th>
                <th className="px-4 py-3 font-medium">Penanggung Jawab</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr></thead>
              <tbody>
                {awaiting.length === 0 ? <tr><td colSpan={6}><EmptyState title="Tidak ada laporan yang menunggu dilengkapi" className="py-10" /></td></tr> : awaiting.map((report) => (
                  <tr key={report.id} className="border-b border-base-700/40">
                    <td className="px-4 py-3"><p className="font-medium text-ink-primary">{report.reportNumber}</p><p className="text-xs text-ink-muted">{REPORT_TYPE_LABELS[report.reportType]}</p></td>
                    <td className="px-4 py-3 text-ink-secondary">{report.occurredOn}</td>
                    <td className="px-4 py-3 text-ink-secondary">{report.laboratory.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{report.responsibility.name}</td>
                    <td className="px-4 py-3"><StatusBadge status={report.status} /></td>
                    <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                      <Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void openReport(report)}>Detail</Button>
                      {canEditReport && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void editReport(report)}>{report.status === 'revision_required' ? 'Perbaiki' : 'Lengkapi'}</Button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <Card>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Input label="Dari" type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)} />
                <Input label="Sampai" type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)} />
                <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>Terapkan</Button>
              </div>
            </CardContent>
          </Card>

          {canViewReports && (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                    <th className="px-4 py-3 font-medium">Nomor</th>
                    <th className="px-4 py-3 font-medium">Tanggal</th>
                    <th className="px-4 py-3 font-medium">Lab</th>
                    <th className="px-4 py-3 font-medium">Kelas / Kegiatan</th>
                    <th className="px-4 py-3 font-medium">Tipe</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Aksi</th>
                  </tr></thead>
                  <tbody>
                    {reports.length === 0 ? <tr><td colSpan={7}><EmptyState title="Belum ada laporan pada rentang ini" className="py-10" /></td></tr> : reports.map((report) => (
                      <tr key={report.id} className="border-b border-base-700/40">
                        <td className="px-4 py-3 font-medium text-ink-primary">{report.reportNumber}</td>
                        <td className="px-4 py-3 text-ink-secondary">{report.occurredOn}</td>
                        <td className="px-4 py-3 text-ink-secondary">{report.laboratory.name}</td>
                        <td className="px-4 py-3 text-ink-secondary">{report.responsibility.academicClass?.name ?? report.responsibility.name}</td>
                        <td className="px-4 py-3"><Badge tone="muted">{REPORT_TYPE_LABELS[report.reportType]}</Badge></td>
                        <td className="px-4 py-3"><StatusBadge status={report.status} /></td>
                        <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                          <Button size="sm" variant="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => void openReport(report)}>Detail</Button>
                          {(report.status === 'draft' || report.status === 'revision_required') && canEditReport && <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => void editReport(report)}>Edit</Button>}
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <CardContent>
              <h3 className="mb-3 font-semibold text-ink-primary">Riwayat Pelaksanaan</h3>
              <div className="space-y-2">
                {sessions.length === 0 ? <EmptyState title="Belum ada Pelaksanaan Lab pada rentang ini" /> : sessions.slice(0, 50).map((session) => (
                  <button key={session.id} type="button" onClick={() => setSessionDetail(session)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-base-700 px-3 py-3 text-left hover:bg-base-700/30">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-primary">{session.responsibility.subject?.name ?? session.sessionNumber}</p>
                      <p className="text-xs text-ink-muted">{session.source.date} · {session.laboratory.name} · {session.responsibility.name}</p>
                    </div>
                    <StatusBadge status={session.status} />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <FormDialog open={Boolean(prepareSource)} onClose={() => setPrepareSource(null)} title="Siapkan Pelaksanaan" description={prepareSource ? `${prepareSource.title} · ${prepareSource.laboratory.name}` : ''} onSubmit={() => void prepare()} submitLabel="Siapkan" loading={busy}>
        <div className="space-y-4">
          <Textarea label="Kondisi Awal" value={prepareForm.openingCondition ?? ''} onChange={(event) => setPrepareForm({ ...prepareForm, openingCondition: event.target.value })} placeholder="Kondisi laboratorium sebelum digunakan..." />
          <Textarea label="Catatan Operasional" value={prepareForm.operationalNotes ?? ''} onChange={(event) => setPrepareForm({ ...prepareForm, operationalNotes: event.target.value })} />
        </div>
      </FormDialog>

      <FormDialog open={Boolean(endSession)} onClose={() => setEndSession(null)} title="Akhiri Pelaksanaan" description="Session dan draft ActivityReport akan disimpan atomik oleh server." onSubmit={() => void finish()} submitLabel="Akhiri & Buat Draft" loading={busy}>
        <div className="space-y-4">
          <Select label="Hasil Pelaksanaan" value={endForm.endOutcome} onChange={(event) => setEndForm({ ...endForm, endOutcome: event.target.value as EndLaboratorySessionInput['endOutcome'] })} options={[
            { value: 'completed', label: 'Selesai' },
            { value: 'interrupted', label: 'Terhenti / Terganggu' },
          ]} />
          <Textarea label="Kondisi Akhir" value={endForm.closingCondition ?? ''} onChange={(event) => setEndForm({ ...endForm, closingCondition: event.target.value })} />
          <Textarea label="Catatan Operasional" value={endForm.operationalNotes ?? ''} onChange={(event) => setEndForm({ ...endForm, operationalNotes: event.target.value })} />
        </div>
      </FormDialog>

      <FormDialog open={Boolean(cancelSession)} onClose={() => setCancelSession(null)} title="Batalkan Pelaksanaan yang Disiapkan" onSubmit={() => void cancelPrepared()} submitLabel="Batalkan Pelaksanaan" loading={busy} submitDisabled={cancelReason.trim() === ''}>
        <Textarea label="Alasan" required value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
      </FormDialog>

      <FormDialog
        open={Boolean(editingReport && reportEditForm)}
        onClose={closeDraftEditor}
        title={editingReport ? `Lengkapi ${editingReport.reportNumber}` : 'Lengkapi Laporan'}
        description={editingReport?.revisionReason
          ? `Catatan revisi: ${editingReport.revisionReason}`
          : 'Draft teks dapat disimpan lokal saat koneksi putus; server tetap authority dan presensi individual tetap di luar SmartLab.'}
        onSubmit={() => void saveReport()}
        submitLabel={online ? (draftSyncStatus === 'clean' ? 'Draft Tersinkron' : 'Sinkronkan Draft') : 'Simpan Lokal'}
        submitDisabled={draftSyncStatus === 'conflict'}
        loading={busy}
        size="xl"
      >
        {reportEditForm && (
          <div className="space-y-6">
            <div className="rounded-xl border border-base-700 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-primary">Status working copy</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {draftSyncStatus === 'clean' && 'Tidak ada perubahan lokal yang belum tersinkron.'}
                    {draftSyncStatus === 'local' && `Perubahan tersimpan lokal pada perangkat ini${online ? ' dan menunggu sinkronisasi.' : '.'}`}
                    {draftSyncStatus === 'syncing' && 'Sedang mengirim draft ke server dengan clientMutationId yang stabil.'}
                    {draftSyncStatus === 'conflict' && 'Versi server berubah sejak draft lokal dibuat. Tidak ada overwrite otomatis.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={online ? 'success' : 'warning'}>{online ? 'Online' : 'Offline'}</Badge>
                  <Badge tone={draftSyncStatus === 'conflict' ? 'danger' : draftSyncStatus === 'local' ? 'warning' : 'muted'}>
                    {draftSyncStatus === 'clean' ? 'Tersinkron' : draftSyncStatus === 'local' ? 'Draft Lokal' : draftSyncStatus === 'syncing' ? 'Sync…' : 'Konflik'}
                  </Badge>
                </div>
              </div>
              {draftConflict && (
                <div className="mt-4 rounded-lg border border-danger/30 bg-danger/10 p-3">
                  <p className="text-sm font-semibold text-danger">Konflik draft vs server</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    Basis lokal v{draftConflict.local.baseVersion}, server sekarang v{draftConflict.server.version}.
                    {draftConflict.fields.length > 0
                      ? ` Field bentrok: ${draftConflict.fields.join(', ')}.`
                      : ' Perubahan berada pada field berbeda dan dapat direbase tanpa menimpa field server lain.'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={useServerConflictVersion}>Gunakan Versi Server</Button>
                    {draftConflict.server.status === 'draft' && (
                      <Button type="button" size="sm" onClick={rebaseLocalConflictVersion}>Rebase Draft Lokal</Button>
                    )}
                  </div>
                </div>
              )}
              {draftSyncStatus === 'local' && online && !draftConflict && (
                <div className="mt-3">
                  <Button type="button" size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void saveReport()}>
                    Sinkronkan Sekarang
                  </Button>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Select label="Tipe Laporan" value={reportEditForm.reportType} onChange={(event) => {
                const reportType = event.target.value as ActivityReportType;
                setReportEditForm({ ...reportEditForm, reportType, typeSpecificContent: emptySpecific(reportType) });
              }} options={Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
              <Input label="Jumlah Hadir" type="number" min={0} max={32767} value={reportEditForm.presentCount} onChange={(event) => setReportEditForm({ ...reportEditForm, presentCount: event.target.value })} />
              <Input label="Jumlah Tidak Hadir" type="number" min={0} max={32767} value={reportEditForm.absentCount} onChange={(event) => setReportEditForm({ ...reportEditForm, absentCount: event.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {COMMON_FIELDS.map((field) => (
                <Textarea key={field.key} label={field.label} value={reportEditForm.commonContent[field.key] ?? ''} onChange={(event) => setReportEditForm({
                  ...reportEditForm,
                  commonContent: { ...reportEditForm.commonContent, [field.key]: event.target.value },
                })} />
              ))}
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink-primary">Detail {REPORT_TYPE_LABELS[reportEditForm.reportType]}</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {TYPE_FIELDS[reportEditForm.reportType].map((field) => (
                  <Textarea key={field.key} label={field.label} value={reportEditForm.typeSpecificContent[field.key] ?? ''} onChange={(event) => setReportEditForm({
                    ...reportEditForm,
                    typeSpecificContent: { ...reportEditForm.typeSpecificContent, [field.key]: event.target.value },
                  })} />
                ))}
              </div>
            </div>
            <Textarea label="Catatan Agregat Kehadiran" value={reportEditForm.attendanceNotes} onChange={(event) => setReportEditForm({ ...reportEditForm, attendanceNotes: event.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Sistem Presensi Eksternal" value={reportEditForm.externalAttendanceSystem} onChange={(event) => setReportEditForm({ ...reportEditForm, externalAttendanceSystem: event.target.value })} placeholder="Contoh: HADIRA" />
              <Input label="Referensi Presensi Eksternal" value={reportEditForm.externalAttendanceReferenceId} onChange={(event) => setReportEditForm({ ...reportEditForm, externalAttendanceReferenceId: event.target.value })} />
            </div>
            {editingReport && (
              <div className="rounded-xl border border-base-700 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-primary"><Paperclip className="h-4 w-4" /> Lampiran Bukti</h3>
                    <p className="mt-1 text-xs text-ink-muted">Private storage · JPEG/PNG/WebP/PDF · maksimal 10 MiB per file · online-only.</p>
                  </div>
                  <Badge tone="muted">{attachments.length} file</Badge>
                </div>
                <div className="space-y-2">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between gap-3 rounded-lg bg-base-700/30 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink-primary">{attachment.fileName}</p>
                        <p className="text-xs text-ink-muted">{attachment.mediaType} · {(attachment.sizeBytes / 1024).toFixed(1)} KiB · SHA-256 {attachment.sha256.slice(0, 12)}…</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" disabled={!online || !attachment.available} icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => openAttachment(attachment)}>Buka</Button>
                    </div>
                  ))}
                  {attachments.length === 0 && <p className="text-xs text-ink-muted">Belum ada lampiran.</p>}
                </div>
                {editingReport.status === 'draft' && canEditReport && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1">
                      <Input
                        label="Tambah Bukti"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
                      />
                    </div>
                    <Button type="button" variant="secondary" loading={attachmentBusy} disabled={!online || draftSyncStatus !== 'clean' || !attachmentFile} icon={<Upload className="h-4 w-4" />} onClick={() => void uploadAttachment(editingReport)}>Upload</Button>
                  </div>
                )}
              </div>
            )}
            {editingReport && canSubmitReport && <div className="flex justify-end"><Button variant="success" icon={<Send className="h-4 w-4" />} onClick={() => void saveAndSubmitReport()} disabled={busy || !online || draftSyncStatus === 'conflict'}>Sinkronkan lalu Ajukan</Button></div>}
          </div>
        )}
      </FormDialog>

      <FormDialog
        open={Boolean(observationSession)}
        onClose={() => setObservationSession(null)}
        title="Catat Temuan Pelaksanaan"
        description="Temuan adalah evidence pelaksanaan. Menyimpan form ini tidak membuat Incident."
        onSubmit={() => void createObservation()}
        submitLabel="Simpan Temuan"
        loading={busy}
        submitDisabled={!online || observationForm.summary.trim() === '' || (observationForm.subjectType === 'device' && observationForm.referenceId === '')}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Jenis Temuan"
              value={observationForm.subjectType}
              options={Object.entries(OBSERVATION_SUBJECT_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(event) => {
                const subjectType = event.target.value as SessionObservationSubjectType;
                setObservationForm({ ...observationForm, subjectType, referenceId: '' });
                setObservationDevices([]);
              }}
            />
            <Select
              label="Tingkat Keparahan"
              value={observationForm.severity}
              options={Object.entries(OBSERVATION_SEVERITY_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(event) => setObservationForm({ ...observationForm, severity: event.target.value as SessionObservationSeverity })}
            />
          </div>
          {observationForm.subjectType === 'device' && (
            <div className="space-y-2 rounded-xl border border-base-700 p-3">
              <div className="flex gap-2">
                <div className="flex-1"><Input label="Cari Device Canonical" value={observationDeviceSearch} onChange={(event) => setObservationDeviceSearch(event.target.value)} placeholder="Minimal 2 karakter kode Device" /></div>
                <Button type="button" variant="secondary" className="mt-7" loading={observationDeviceBusy} disabled={observationDeviceSearch.trim().length < 2} onClick={() => void searchObservationDevices()}>Cari</Button>
              </div>
              <Select
                label="Device"
                value={observationForm.referenceId}
                placeholder="Pilih Device"
                options={observationDevices.map((device) => ({ value: device.id, label: `${device.deviceCode} · ${device.deviceType}` }))}
                onChange={(event) => setObservationForm({ ...observationForm, referenceId: event.target.value })}
              />
            </div>
          )}
          {observationForm.subjectType === 'asset' && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
              Domain Asset canonical baru masuk S4. S3.5 menyimpan temuan Asset sebagai evidence teks tanpa mengarang reference ID.
            </div>
          )}
          <Input label="Waktu Temuan" type="datetime-local" value={observationForm.observedAt} onChange={(event) => setObservationForm({ ...observationForm, observedAt: event.target.value })} />
          <Textarea label="Ringkasan Temuan" required maxLength={4000} value={observationForm.summary} onChange={(event) => setObservationForm({ ...observationForm, summary: event.target.value })} />
        </div>
      </FormDialog>

      <FormDialog
        open={Boolean(promoteObservation)}
        onClose={() => setPromoteObservation(null)}
        title="Promosikan Temuan menjadi Incident"
        description="Aksi eksplisit ini membuat tepat satu tiket Incident dan menautkannya kembali ke evidence Pelaksanaan."
        onSubmit={() => void promoteToIncident()}
        submitLabel="Buat & Tautkan Incident"
        loading={busy}
        submitDisabled={!online || promoteForm.title.trim() === '' || promoteForm.description.trim() === ''}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Kategori" value={promoteForm.category} options={INCIDENT_CATEGORIES.map((value) => ({ value, label: INCIDENT_CATEGORY_LABELS[value] }))} onChange={(event) => setPromoteForm({ ...promoteForm, category: event.target.value as IncidentCategory })} />
            <Select label="Prioritas" value={promoteForm.priority} options={INCIDENT_PRIORITIES.map((value) => ({ value, label: INCIDENT_PRIORITY_LABELS[value] }))} onChange={(event) => setPromoteForm({ ...promoteForm, priority: event.target.value as IncidentPriority })} />
          </div>
          <Input label="Judul Incident" required maxLength={200} value={promoteForm.title} onChange={(event) => setPromoteForm({ ...promoteForm, title: event.target.value })} />
          <Textarea label="Deskripsi" required maxLength={4000} value={promoteForm.description} onChange={(event) => setPromoteForm({ ...promoteForm, description: event.target.value })} />
          <Textarea label="Dampak" maxLength={2000} value={promoteForm.impact} onChange={(event) => setPromoteForm({ ...promoteForm, impact: event.target.value })} />
          <Textarea label="Langkah yang Sudah Dilakukan" maxLength={2000} value={promoteForm.stepsTaken} onChange={(event) => setPromoteForm({ ...promoteForm, stepsTaken: event.target.value })} />
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={promoteForm.blocksLaboratoryOperation} onChange={(event) => setPromoteForm({ ...promoteForm, blocksLaboratoryOperation: event.target.checked })} />
            Menghambat operasional laboratorium
          </label>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(revisionReport)} onClose={() => setRevisionReport(null)} title="Minta Perbaikan Laporan" onSubmit={() => void requestRevision()} submitLabel="Kirim untuk Perbaikan" loading={busy} submitDisabled={!online || revisionReason.trim() === ''}>
        <Textarea label="Alasan / Catatan Perbaikan" required value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} />
      </FormDialog>

      <FormDialog open={backfillOpen} onClose={() => setBackfillOpen(false)} title="Backfill Laporan Historis" description="Jalur ini tidak membuat Session palsu. Gunakan hanya untuk bukti historis/legacy yang memang perlu dipertahankan." onSubmit={() => void createBackfill()} submitLabel="Buat Draft Backfill" loading={busy} size="xl">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Laboratorium" value={backfillForm.laboratoryId} onChange={(event) => setBackfillForm({ ...backfillForm, laboratoryId: event.target.value })} options={labs.map((lab) => ({ value: lab.id, label: lab.name }))} />
            <Input label="Tanggal" type="date" value={backfillForm.occurredOn} onChange={(event) => setBackfillForm({ ...backfillForm, occurredOn: event.target.value })} />
            <Select label="Tipe Laporan" value={backfillForm.reportType} onChange={(event) => {
              const reportType = event.target.value as ActivityReportType;
              setBackfillForm({ ...backfillForm, reportType, typeSpecificContent: emptySpecific(reportType) });
            }} options={Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </div>
          <Textarea label="Alasan Backfill" required value={backfillForm.manualBackfillReason} onChange={(event) => setBackfillForm({ ...backfillForm, manualBackfillReason: event.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Penanggung Jawab" required value={backfillForm.responsibleName} onChange={(event) => setBackfillForm({ ...backfillForm, responsibleName: event.target.value })} />
            <Input label="Jumlah Peserta Rencana" type="number" min={0} max={32767} value={backfillForm.plannedParticipantCount} onChange={(event) => setBackfillForm({ ...backfillForm, plannedParticipantCount: event.target.value })} />
          </div>
          <Textarea label="Deskripsi Aktivitas Historis" required value={backfillForm.activityDescription} onChange={(event) => setBackfillForm({ ...backfillForm, activityDescription: event.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Hadir" type="number" min={0} max={32767} value={backfillForm.presentCount} onChange={(event) => setBackfillForm({ ...backfillForm, presentCount: event.target.value })} />
            <Input label="Tidak Hadir" type="number" min={0} max={32767} value={backfillForm.absentCount} onChange={(event) => setBackfillForm({ ...backfillForm, absentCount: event.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {COMMON_FIELDS.map((field) => <Textarea key={field.key} label={field.label} value={backfillForm.commonContent[field.key] ?? ''} onChange={(event) => setBackfillForm({
              ...backfillForm,
              commonContent: { ...backfillForm.commonContent, [field.key]: event.target.value },
            })} />)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TYPE_FIELDS[backfillForm.reportType].map((field) => <Textarea key={field.key} label={field.label} value={backfillForm.typeSpecificContent[field.key] ?? ''} onChange={(event) => setBackfillForm({
              ...backfillForm,
              typeSpecificContent: { ...backfillForm.typeSpecificContent, [field.key]: event.target.value },
            })} />)}
          </div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(sessionDetail)} onClose={() => setSessionDetail(null)} title={sessionDetail?.sessionNumber} description={sessionDetail ? `${sessionDetail.source.date} · ${sessionDetail.laboratory.name}` : ''} width="max-w-xl">
        {sessionDetail && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap gap-2"><StatusBadge status={sessionDetail.status} /><Badge tone="accent">{SOURCE_LABELS[sessionDetail.source.type]}</Badge></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Penanggung Jawab</p><p className="text-ink-primary">{sessionDetail.responsibility.name}</p></div>
              <div><p className="text-xs text-ink-muted">Kelas</p><p className="text-ink-primary">{sessionDetail.responsibility.academicClass?.name ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Mapel</p><p className="text-ink-primary">{sessionDetail.responsibility.subject?.name ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Peserta Rencana</p><p className="text-ink-primary">{sessionDetail.responsibility.plannedParticipantCount ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Mulai Aktual</p><p className="text-ink-primary">{sessionDetail.actualStartedAt ? relativeTime(sessionDetail.actualStartedAt) : '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Selesai Aktual</p><p className="text-ink-primary">{sessionDetail.actualEndedAt ? relativeTime(sessionDetail.actualEndedAt) : '-'}</p></div>
            </div>
            {sessionDetail.openingCondition && <div><p className="text-xs text-ink-muted">Kondisi Awal</p><p className="text-ink-secondary">{sessionDetail.openingCondition}</p></div>}
            {sessionDetail.closingCondition && <div><p className="text-xs text-ink-muted">Kondisi Akhir</p><p className="text-ink-secondary">{sessionDetail.closingCondition}</p></div>}
            {canViewObservations && (
              <div className="rounded-xl border border-base-700 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold text-ink-primary"><AlertTriangle className="h-4 w-4" /> Temuan Pelaksanaan</h3>
                    <p className="mt-1 text-xs text-ink-muted">Evidence tidak otomatis menjadi Incident.</p>
                  </div>
                  {canCreateObservation && (sessionDetail.status === 'in_progress' || (sessionDetail.status === 'ended' && sessionDetail.activityReport?.status === 'draft')) && (
                    <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => openObservationDialog(sessionDetail)}>Catat Temuan</Button>
                  )}
                </div>
                <div className="space-y-2">
                  {observations.length === 0 && <p className="text-xs text-ink-muted">Belum ada temuan tercatat.</p>}
                  {observations.map((observation) => (
                    <div key={observation.id} className="rounded-lg bg-base-700/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={severityTone(observation.severity)}>{OBSERVATION_SEVERITY_LABELS[observation.severity]}</Badge>
                        <Badge tone="neutral">{OBSERVATION_SUBJECT_LABELS[observation.subjectType]}</Badge>
                        {observation.referenceCode && <span className="text-xs font-semibold text-accent-content">{observation.referenceCode}</span>}
                      </div>
                      <p className="mt-2 text-ink-secondary">{observation.summary}</p>
                      <p className="mt-1 text-xs text-ink-muted">{relativeTime(observation.observedAt)} · {observation.observedBy.name}</p>
                      <div className="mt-2">
                        {observation.incident ? (
                          <Button size="sm" variant="ghost" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => window.open(`/incidents/${observation.incident?.id}`, '_blank', 'noopener,noreferrer')}>
                            {observation.incident.ticketNumber}
                          </Button>
                        ) : canPromoteObservation ? (
                          <Button size="sm" variant="secondary" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => openPromotion(observation)}>Promosikan ke Incident</Button>
                        ) : (
                          <Badge tone="muted">Belum ditautkan</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ActivityTimeline items={sessionDetail.timeline.map((event) => ({
              label: sessionTimelineLabel(event),
              by: event.actorName,
              at: relativeTime(event.at),
              tone: event.eventType.endsWith('.ended') ? 'success' : event.eventType.endsWith('.cancelled') ? 'danger' : 'accent',
            }))} />
          </div>
        )}
      </Drawer>

      <Drawer open={Boolean(reportDetail)} onClose={() => {
        setReportDetail(null);
        const next = new URLSearchParams(searchParams);
        next.delete('reportId');
        setSearchParams(next);
      }} title={reportDetail?.reportNumber} description={reportDetail ? `${reportDetail.occurredOn} · ${REPORT_TYPE_LABELS[reportDetail.reportType]}` : ''} width="max-w-xl">
        {reportDetail && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={reportDetail.status} />
              <Badge tone={reportDetail.origin === 'session' ? 'accent' : 'warning'}>{reportDetail.origin === 'session' ? 'Dari Pelaksanaan' : 'Backfill Manual'}</Badge>
            </div>
            {reportDetail.revisionReason && <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-warning-foreground">Perlu perbaikan: {reportDetail.revisionReason}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Lab</p><p className="text-ink-primary">{reportDetail.laboratory.name}</p></div>
              <div><p className="text-xs text-ink-muted">Penanggung Jawab</p><p className="text-ink-primary">{reportDetail.responsibility.name}</p></div>
              <div><p className="text-xs text-ink-muted">Hadir</p><p className="text-ink-primary">{reportDetail.attendance.presentCount ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Tidak Hadir</p><p className="text-ink-primary">{reportDetail.attendance.absentCount ?? '-'}</p></div>
            </div>
            {COMMON_FIELDS.map((field) => reportDetail.commonContent[field.key] ? <div key={field.key}><p className="text-xs text-ink-muted">{field.label}</p><p className="whitespace-pre-wrap text-ink-secondary">{reportDetail.commonContent[field.key]}</p></div> : null)}
            <div className="rounded-xl border border-base-700 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-semibold text-ink-primary"><Paperclip className="h-4 w-4" /> Lampiran Bukti</h3>
                <Badge tone="muted">{attachments.length} file</Badge>
              </div>
              <div className="space-y-2">
                {attachments.length === 0 && <p className="text-xs text-ink-muted">Belum ada lampiran.</p>}
                {attachments.map((attachment) => (
                  <button key={attachment.id} type="button" disabled={!attachment.available} onClick={() => openAttachment(attachment)} className="flex w-full items-center justify-between gap-3 rounded-lg bg-base-700/30 px-3 py-2 text-left disabled:opacity-60">
                    <div className="min-w-0">
                      <p className="truncate text-ink-primary">{attachment.fileName}</p>
                      <p className="text-xs text-ink-muted">{attachment.available ? 'Tersedia' : 'File tidak tersedia'} · SHA-256 {attachment.sha256.slice(0, 12)}…</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-ink-muted" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {(reportDetail.status === 'draft' || reportDetail.status === 'revision_required') && canEditReport && <Button icon={<Pencil className="h-4 w-4" />} onClick={() => void editReport(reportDetail)}>Edit</Button>}
              {reportDetail.status === 'draft' && canSubmitReport && <Button variant="success" icon={<Send className="h-4 w-4" />} onClick={() => void submitReport(reportDetail)}>Ajukan</Button>}
              {reportDetail.status === 'submitted' && canVerifyReport && <Button variant="success" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void verifyReport(reportDetail)}>Verifikasi</Button>}
              {reportDetail.status === 'submitted' && canRequestRevision && <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => { setRevisionReport(reportDetail); setRevisionReason(''); }}>Minta Perbaikan</Button>}
            </div>
            <ActivityTimeline items={reportDetail.timeline.map((event) => ({
              label: reportTimelineLabel(event),
              by: event.actorName,
              at: relativeTime(event.at),
              tone: event.eventType.endsWith('.verified') ? 'success' : event.eventType.endsWith('.revision_requested') ? 'warning' : 'accent',
            }))} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
