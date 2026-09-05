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
  type UpdateActivityReportInput,
} from '@/services/activityReportApi';

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

function compactContent(value: Record<string, string>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.trim() === '' ? null : item.trim()]));
}

function nullableCount(value: string): number | null {
  if (value.trim() === '') return null;
  return Number(value);
}

function issueMessage(error: unknown): string {
  if (error instanceof LaboratorySessionContractError) return 'Respons Pelaksanaan Lab dari server tidak sesuai kontrak.';
  if (error instanceof ActivityReportContractError) return 'Respons Laporan Pelaksanaan dari server tidak sesuai kontrak.';
  if (error instanceof ApiClientError) {
    if (error.code === 'LABORATORY_SESSION_VERSION_CONFLICT' || error.code === 'ACTIVITY_REPORT_VERSION_CONFLICT') {
      return 'Data sudah berubah di server. Data terbaru telah dimuat ulang.';
    }
    if (error.code === 'SESSION_SOURCE_CHANGED') return 'Sumber pelaksanaan berubah. Periksa jadwal/reservasi terbaru sebelum memulai.';
    if (error.code === 'LABORATORY_SESSION_STATE_CONFLICT' || error.code === 'ACTIVITY_REPORT_STATE_CONFLICT') {
      return 'Status data sudah berubah dan aksi ini tidak lagi berlaku.';
    }
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

  const today = useMemo(() => dateKey(new Date()), []);
  const defaultFrom = useMemo(() => dateKey(addDays(new Date(), -90)), []);
  const [historyFrom, setHistoryFrom] = useState(defaultFrom);
  const [historyTo, setHistoryTo] = useState(today);

  const requestedTab = searchParams.get('tab');
  const activeTab: TabKey = ['today', 'in-progress', 'awaiting-report', 'history'].includes(requestedTab ?? '')
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

  const [sessionDetail, setSessionDetail] = useState<LaboratorySessionDto | null>(null);
  const [reportDetail, setReportDetail] = useState<ActivityReportDto | null>(null);
  const [editingReport, setEditingReport] = useState<ActivityReportDto | null>(null);
  const [reportEditForm, setReportEditForm] = useState<ReportFormState | null>(null);
  const [revisionReport, setRevisionReport] = useState<ActivityReportDto | null>(null);
  const [revisionReason, setRevisionReason] = useState('');
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
        canBackfill || canExportReports ? laboratoryGateway.list() : Promise.resolve([]),
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
  }, [canBackfill, canExportReports, canViewAllReports, canViewAllSessions, canViewReports, historyFrom, historyTo, today]);

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
    await mutate(async () => {
      const result = await laboratorySessionGateway.start(sessionId, version);
      setSessionDetail(result);
    }, 'Pelaksanaan dimulai.');
  }

  async function finish() {
    if (!endSession || !canEnd) return;
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
        setEditingReport(report);
        setReportEditForm(reportForm(report));
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
    const current = cancelSession;
    await mutate(async () => {
      await laboratorySessionGateway.cancel(current.id, current.version, cancelReason);
      setCancelSession(null);
      setCancelReason('');
    }, 'Pelaksanaan dibatalkan.');
  }

  async function openReport(report: ActivityReportDto) {
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
      let fresh = await activityReportGateway.show(report.id);
      if (fresh.status === 'revision_required') {
        fresh = await activityReportGateway.reopen(fresh.id, fresh.version);
      }
      setEditingReport(fresh);
      setReportEditForm(reportForm(fresh));
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveReport() {
    if (!editingReport || !reportEditForm || !canEditReport) return;
    const form = reportEditForm;
    const payload: UpdateActivityReportInput = {
      reportType: form.reportType,
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
      const updated = await activityReportGateway.update(editingReport.id, editingReport.version, payload);
      setEditingReport(updated);
      setReportEditForm(reportForm(updated));
      toast('Draft laporan disimpan.', 'success');
      await load();
    } catch (cause) {
      toast(issueMessage(cause), 'error');
      const fresh = await activityReportGateway.show(editingReport.id).catch(() => null);
      if (fresh) {
        setEditingReport(fresh);
        setReportEditForm(reportForm(fresh));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(report: ActivityReportDto) {
    if (!canSubmitReport) return;
    await mutate(async () => {
      const updated = await activityReportGateway.submit(report.id, report.version);
      setReportDetail(updated);
      setEditingReport(null);
      setReportEditForm(null);
    }, 'Laporan diajukan untuk verifikasi.');
  }

  async function verifyReport(report: ActivityReportDto) {
    if (!canVerifyReport) return;
    await mutate(async () => {
      const updated = await activityReportGateway.verify(report.id, report.version);
      setReportDetail(updated);
    }, 'Laporan diverifikasi.');
  }

  async function requestRevision() {
    if (!revisionReport || !canRequestRevision || revisionReason.trim() === '') return;
    const report = revisionReport;
    await mutate(async () => {
      const updated = await activityReportGateway.requestRevision(report.id, report.version, revisionReason);
      setReportDetail(updated);
      setRevisionReport(null);
      setRevisionReason('');
    }, 'Laporan dikembalikan untuk diperbaiki.');
  }

  async function createBackfill() {
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
      setEditingReport(created);
      setReportEditForm(reportForm(created));
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
      return <Button size="sm" icon={<BookOpen className="h-3.5 w-3.5" />} onClick={() => {
        setPrepareSource(source);
        setPrepareForm({ openingCondition: '', operationalNotes: '' });
      }}>Siapkan</Button>;
    }
    if (!session) return <Badge tone="muted">Belum disiapkan</Badge>;
    if (session.status === 'prepared') {
      return (
        <div className="flex flex-wrap gap-1">
          {canStart && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => void start(session.id, session.version)}>Mulai</Button>}
          {canCancel && <Button size="sm" variant="ghost" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setCancelSession(sessions.find((item) => item.id === session.id) ?? null)}>Batal</Button>}
        </div>
      );
    }
    if (session.status === 'in_progress') {
      return <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => {
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
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()} loading={busy}>Muat Ulang</Button>
            {(canExportSessions || canExportReports) && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCanonical}>Export</Button>}
            {canBackfill && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => {
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
                {canEnd && <Button className="mt-4 w-full" variant="danger" icon={<Square className="h-4 w-4" />} onClick={() => {
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

      <FormDialog open={Boolean(editingReport && reportEditForm)} onClose={() => { setEditingReport(null); setReportEditForm(null); }} title={editingReport ? `Lengkapi ${editingReport.reportNumber}` : 'Lengkapi Laporan'} description={editingReport?.revisionReason ? `Catatan revisi: ${editingReport.revisionReason}` : 'Presensi individual tetap menjadi kewenangan sistem presensi; SmartLab hanya menyimpan agregat.'} onSubmit={() => void saveReport()} submitLabel="Simpan Draft" loading={busy} size="xl">
        {reportEditForm && (
          <div className="space-y-6">
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
            {editingReport && canSubmitReport && <div className="flex justify-end"><Button variant="success" icon={<Send className="h-4 w-4" />} onClick={() => void submitReport(editingReport)} disabled={busy}>Simpan lalu Ajukan</Button></div>}
          </div>
        )}
      </FormDialog>

      <FormDialog open={Boolean(revisionReport)} onClose={() => setRevisionReport(null)} title="Minta Perbaikan Laporan" onSubmit={() => void requestRevision()} submitLabel="Kirim untuk Perbaikan" loading={busy} submitDisabled={revisionReason.trim() === ''}>
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
