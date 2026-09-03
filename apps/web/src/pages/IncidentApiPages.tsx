import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, Plus, Search } from 'lucide-react';
import { FormDialog } from '@/components/forms/FormDialog';
import { PageHeader } from '@/components/common/PageHeader';
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
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  emptyIncidentCreateForm,
  incidentCreateOutcomeIsAmbiguous,
  incidentPresentationIssue,
  incidentPriorityTone,
  incidentStatusTone,
  validateIncidentCreateForm,
  type IncidentCreateFormValues,
  type IncidentFormErrors,
  type IncidentPresentationIssue,
} from '@/lib/incidentPresentation';
import {
  incidentGateway,
  type IncidentCategory,
  type IncidentDto,
  type IncidentListFilters,
  type IncidentListItem,
  type IncidentPage,
  type IncidentPriority,
  type IncidentReportingDeviceDto,
  type IncidentReportingLaboratoryDto,
  type IncidentStatus,
} from '@/services/incidentApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

export interface IncidentListFilterValues {
  status: '' | IncidentStatus;
  priority: '' | IncidentPriority;
  category: '' | IncidentCategory;
  search: string;
}

export type IncidentListState =
  | { status: 'loading' }
  | { status: 'error'; issue: IncidentPresentationIssue }
  | { status: 'ready'; page: IncidentPage };

const DEFAULT_FILTERS: IncidentListFilterValues = { status: '', priority: '', category: '', search: '' };

function dateLabel(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function newSubmissionId(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Browser tidak mendukung UUID aman untuk correlation Incident.');
  }
  return crypto.randomUUID().toLowerCase();
}

function toListFilters(filters: IncidentListFilterValues, page: number): IncidentListFilters {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    page,
    perPage: 25,
  };
}

interface IncidentListViewProps {
  state: IncidentListState;
  filters: IncidentListFilterValues;
  canCreate: boolean;
  onFiltersChange: (filters: IncidentListFilterValues) => void;
  onApplyFilters: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onDetail: (incident: IncidentListItem) => void;
  onPageChange: (page: number) => void;
}

export function IncidentListView({
  state,
  filters,
  canCreate,
  onFiltersChange,
  onApplyFilters,
  onRetry,
  onCreate,
  onDetail,
  onPageChange,
}: IncidentListViewProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onApplyFilters();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tiket Kerusakan"
        description="Laporkan, triage, tugaskan, dan pantau Incident canonical pada sekolah aktif."
        icon={<AlertTriangle className="h-5 w-5" />}
        actions={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Buat Tiket</Button> : undefined}
      />

      <Card>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
            <div className="w-full sm:min-w-64 sm:flex-1">
              <Input
                label="Pencarian"
                icon={<Search className="h-4 w-4" />}
                value={filters.search}
                maxLength={100}
                placeholder="Nomor tiket, judul, kode lab, atau kode perangkat"
                onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                label="Status"
                value={filters.status}
                placeholder="Semua status"
                options={INCIDENT_STATUSES.map((value) => ({ value, label: INCIDENT_STATUS_LABELS[value] }))}
                onChange={(event) => onFiltersChange({ ...filters, status: event.target.value as IncidentListFilterValues['status'] })}
              />
            </div>
            <div className="w-full sm:w-44">
              <Select
                label="Prioritas"
                value={filters.priority}
                placeholder="Semua prioritas"
                options={INCIDENT_PRIORITIES.map((value) => ({ value, label: INCIDENT_PRIORITY_LABELS[value] }))}
                onChange={(event) => onFiltersChange({ ...filters, priority: event.target.value as IncidentListFilterValues['priority'] })}
              />
            </div>
            <div className="w-full sm:w-52">
              <Select
                label="Kategori"
                value={filters.category}
                placeholder="Semua kategori"
                options={INCIDENT_CATEGORIES.map((value) => ({ value, label: INCIDENT_CATEGORY_LABELS[value] }))}
                onChange={(event) => onFiltersChange({ ...filters, category: event.target.value as IncidentListFilterValues['category'] })}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" icon={<Search className="h-4 w-4" />}>Terapkan</Button>
          </form>
        </CardContent>
      </Card>

      {state.status === 'loading' && <Card><LoadingState label="Memuat tiket dari server..." /></Card>}
      {state.status === 'error' && <Card><ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} /></Card>}
      {state.status === 'ready' && state.page.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            title="Belum ada tiket"
            description="Tidak ada Incident yang terlihat pada konteks sekolah dan filter saat ini."
            action={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Buat Tiket</Button> : undefined}
          />
        </Card>
      )}

      {state.status === 'ready' && state.page.data.length > 0 && (
        <>
          <Card className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-base-700/70 bg-base-800/80 text-left text-xs uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3">Tiket</th>
                    <th className="px-4 py-3">Masalah</th>
                    <th className="px-4 py-3">Konteks</th>
                    <th className="px-4 py-3">Prioritas</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Dilaporkan</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {state.page.data.map((incident) => (
                    <tr key={incident.id} className="border-b border-base-700/40 last:border-0 hover:bg-base-700/20">
                      <td className="px-4 py-3 font-semibold text-accent-content">{incident.ticketNumber}</td>
                      <td className="max-w-sm px-4 py-3">
                        <p className="truncate font-medium text-ink-primary">{incident.title}</p>
                        <p className="mt-1 text-xs text-ink-muted">{INCIDENT_CATEGORY_LABELS[incident.category]}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">
                        <p>{incident.laboratory.code} · {incident.laboratory.name}</p>
                        <p className="mt-1 text-xs text-ink-muted">{incident.device?.deviceCode ?? 'Tanpa perangkat'}</p>
                      </td>
                      <td className="px-4 py-3"><Badge tone={incidentPriorityTone(incident.priority)}>{INCIDENT_PRIORITY_LABELS[incident.priority]}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={incidentStatusTone(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge></td>
                      <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{dateLabel(incident.reportedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => onDetail(incident)}>Detail</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-3 md:hidden">
            {state.page.data.map((incident) => (
              <Card key={incident.id} hover>
                <CardContent className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-accent-content">{incident.ticketNumber}</p>
                      <h3 className="mt-1 font-semibold text-ink-primary">{incident.title}</h3>
                    </div>
                    <Badge tone={incidentStatusTone(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={incidentPriorityTone(incident.priority)}>{INCIDENT_PRIORITY_LABELS[incident.priority]}</Badge>
                    <Badge tone="neutral">{INCIDENT_CATEGORY_LABELS[incident.category]}</Badge>
                    {incident.blocksLaboratoryOperation && <Badge tone="danger">Menghambat operasional</Badge>}
                  </div>
                  <dl className="grid grid-cols-2 gap-2 rounded-lg bg-base-700/30 p-3 text-xs">
                    <div><dt className="text-ink-muted">Lab</dt><dd className="mt-0.5 text-ink-primary">{incident.laboratory.code}</dd></div>
                    <div><dt className="text-ink-muted">Perangkat</dt><dd className="mt-0.5 text-ink-primary">{incident.device?.deviceCode ?? '—'}</dd></div>
                    <div className="col-span-2"><dt className="text-ink-muted">Dilaporkan</dt><dd className="mt-0.5 text-ink-primary">{dateLabel(incident.reportedAt)}</dd></div>
                  </dl>
                  <Button className="w-full" variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => onDetail(incident)}>Buka Detail</Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-700/70 bg-base-800/80 px-4 py-3 text-sm">
            <p className="text-ink-muted">Halaman {state.page.meta.page} dari {state.page.meta.lastPage} · {state.page.meta.total} tiket</p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={<ChevronLeft className="h-4 w-4" />}
                disabled={state.page.meta.page <= 1}
                onClick={() => onPageChange(state.page.meta.page - 1)}
              >Sebelumnya</Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={state.page.meta.page >= state.page.meta.lastPage}
                onClick={() => onPageChange(state.page.meta.page + 1)}
              >Berikutnya<ChevronRight className="ml-1 h-4 w-4" /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface IncidentCreateFormFieldsProps {
  values: IncidentCreateFormValues;
  errors: IncidentFormErrors;
  laboratories: IncidentReportingLaboratoryDto[];
  devices: IncidentReportingDeviceDto[];
  deviceSearch: string;
  deviceSearchBusy: boolean;
  deviceHasMore: boolean;
  onChange: (values: IncidentCreateFormValues) => void;
  onDeviceSearchChange: (value: string) => void;
  onSearchDevices: () => void;
}

export function IncidentCreateFormFields({
  values,
  errors,
  laboratories,
  devices,
  deviceSearch,
  deviceSearchBusy,
  deviceHasMore,
  onChange,
  onDeviceSearchChange,
  onSearchDevices,
}: IncidentCreateFormFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select
        label="Laboratorium"
        required
        value={values.laboratoryId}
        error={errors.laboratoryId}
        placeholder="Pilih laboratorium aktif"
        options={laboratories.map((laboratory) => ({ value: laboratory.id, label: `${laboratory.code} · ${laboratory.name}` }))}
        onChange={(event) => onChange({ ...values, laboratoryId: event.target.value, deviceId: '' })}
      />
      <Input
        label="Waktu Kejadian"
        required
        type="datetime-local"
        value={values.occurredAt}
        error={errors.occurredAt}
        onChange={(event) => onChange({ ...values, occurredAt: event.target.value })}
      />
      <Select
        label="Kategori"
        required
        value={values.category}
        error={errors.category}
        options={INCIDENT_CATEGORIES.map((value) => ({ value, label: INCIDENT_CATEGORY_LABELS[value] }))}
        onChange={(event) => onChange({ ...values, category: event.target.value as IncidentCategory })}
      />
      <Select
        label="Prioritas"
        value={values.priority}
        error={errors.priority}
        options={INCIDENT_PRIORITIES.map((value) => ({ value, label: INCIDENT_PRIORITY_LABELS[value] }))}
        onChange={(event) => onChange({ ...values, priority: event.target.value as IncidentPriority })}
      />

      <div className="space-y-2 sm:col-span-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="Cari Perangkat (opsional)"
              value={deviceSearch}
              maxLength={100}
              disabled={!values.laboratoryId}
              placeholder={values.laboratoryId ? 'Minimal 2 karakter kode perangkat' : 'Pilih laboratorium terlebih dahulu'}
              onChange={(event) => onDeviceSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onSearchDevices();
                }
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" loading={deviceSearchBusy} disabled={!values.laboratoryId || deviceSearch.trim().length < 2} onClick={onSearchDevices}>Cari</Button>
        </div>
        <Select
          label="Perangkat Terkait"
          value={values.deviceId}
          error={errors.deviceId}
          placeholder="Tanpa perangkat"
          options={devices.map((device) => ({ value: device.id, label: `${device.deviceCode} · ${device.deviceType}` }))}
          onChange={(event) => onChange({ ...values, deviceId: event.target.value })}
        />
        {deviceHasMore && <p className="text-xs text-warning">Hasil masih banyak. Persempit pencarian kode perangkat.</p>}
      </div>

      <div className="sm:col-span-2">
        <Input
          label="Judul"
          required
          maxLength={200}
          value={values.title}
          error={errors.title}
          onChange={(event) => onChange({ ...values, title: event.target.value })}
        />
      </div>
      <div className="sm:col-span-2">
        <Textarea
          label="Deskripsi"
          required
          maxLength={4000}
          value={values.description}
          error={errors.description}
          onChange={(event) => onChange({ ...values, description: event.target.value })}
        />
      </div>
      <Textarea
        label="Dampak"
        maxLength={2000}
        value={values.impact}
        error={errors.impact}
        onChange={(event) => onChange({ ...values, impact: event.target.value })}
      />
      <Textarea
        label="Langkah yang Sudah Dilakukan"
        maxLength={2000}
        value={values.stepsTaken}
        error={errors.stepsTaken}
        onChange={(event) => onChange({ ...values, stepsTaken: event.target.value })}
      />
      <label className="flex items-center gap-2 text-sm text-ink-secondary sm:col-span-2">
        <input
          type="checkbox"
          checked={values.blocksLaboratoryOperation}
          onChange={(event) => onChange({ ...values, blocksLaboratoryOperation: event.target.checked })}
          className="rounded border-base-600 text-accent-content"
        />
        Menghambat operasional laboratorium
      </label>
      {errors.request && <p className="text-sm text-danger sm:col-span-2">{errors.request}</p>}
    </div>
  );
}

async function loadAllReportingLaboratories(): Promise<IncidentReportingLaboratoryDto[]> {
  const first = await incidentGateway.reportingLaboratories({ page: 1, perPage: 100 });
  if (first.meta.lastPage === 1) return first.data;
  const pages = await Promise.all(
    Array.from({ length: first.meta.lastPage - 1 }, (_, index) => incidentGateway.reportingLaboratories({ page: index + 2, perPage: 100 })),
  );
  return [first, ...pages].flatMap((page) => page.data);
}

export function IncidentsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'incidents.create');
  const [filters, setFilters] = useState<IncidentListFilterValues>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<IncidentListFilterValues>(DEFAULT_FILTERS);
  const [state, setState] = useState<IncidentListState>({ status: 'loading' });
  const [createOpen, setCreateOpen] = useState(false);
  const [createValues, setCreateValues] = useState<IncidentCreateFormValues>(() => emptyIncidentCreateForm());
  const [createErrors, setCreateErrors] = useState<IncidentFormErrors>({});
  const [submissionId, setSubmissionId] = useState('');
  const [laboratories, setLaboratories] = useState<IncidentReportingLaboratoryDto[]>([]);
  const [devices, setDevices] = useState<IncidentReportingDeviceDto[]>([]);
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceHasMore, setDeviceHasMore] = useState(false);
  const [deviceSearchBusy, setDeviceSearchBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createRecoveryPending, setCreateRecoveryPending] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [createIssue, setCreateIssue] = useState<string | null>(null);

  const load = useCallback(async (nextFilters: IncidentListFilterValues, page: number) => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', page: await incidentGateway.list(toListFilters(nextFilters, page)) });
    } catch (error) {
      setState({ status: 'error', issue: incidentPresentationIssue(error) });
    }
  }, []);

  useEffect(() => {
    void load(DEFAULT_FILTERS, 1);
  }, [load]);

  const currentPage = state.status === 'ready' ? state.page.meta.page : 1;

  function applyFilters() {
    setAppliedFilters(filters);
    void load(filters, 1);
  }

  async function openCreate() {
    if (!canCreate) return;
    setCreateIssue(null);
    setCreateErrors({});
    setCreateValues(emptyIncidentCreateForm());
    setCreateRecoveryPending(false);
    setDevices([]);
    setDeviceSearch('');
    setDeviceHasMore(false);
    try {
      setSubmissionId(newSubmissionId());
      setLaboratories(await loadAllReportingLaboratories());
      setCreateOpen(true);
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      toast(issue.message, 'error');
    }
  }

  function closeCreate() {
    if (createBusy || recoveryBusy || createRecoveryPending) return;
    setCreateOpen(false);
    setCreateIssue(null);
    setCreateRecoveryPending(false);
  }

  async function searchDevices() {
    if (!createValues.laboratoryId || deviceSearch.trim().length < 2) return;
    setDeviceSearchBusy(true);
    try {
      const result = await incidentGateway.reportingDevices(createValues.laboratoryId, deviceSearch);
      setDevices(result.data);
      setDeviceHasMore(result.meta.hasMore);
      if (createValues.deviceId && !result.data.some((device) => device.id === createValues.deviceId)) {
        setCreateValues((current) => ({ ...current, deviceId: '' }));
      }
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      toast(issue.message, 'error');
    } finally {
      setDeviceSearchBusy(false);
    }
  }

  function changeCreateValues(next: IncidentCreateFormValues) {
    if (next.laboratoryId !== createValues.laboratoryId) {
      setDevices([]);
      setDeviceSearch('');
      setDeviceHasMore(false);
    }
    setCreateValues(next);
    setCreateErrors({});
    if (!createRecoveryPending) setCreateIssue(null);
  }

  async function finishCreatedIncident(created: IncidentDto, recovered: boolean) {
    toast(
      recovered
        ? `Tiket ${created.ticketNumber} ditemukan dari correlation pembuatan.`
        : `Tiket ${created.ticketNumber} berhasil dibuat.`,
      'success',
    );
    setCreateOpen(false);
    setCreateRecoveryPending(false);
    setCreateIssue(null);
    setAppliedFilters(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    await load(DEFAULT_FILTERS, 1);
    navigate(`/incidents/${created.id}`);
  }

  async function submitCreate() {
    if (createRecoveryPending) return;
    const validation = validateIncidentCreateForm(createValues, submissionId);
    if (!validation.ok) {
      setCreateErrors(validation.errors);
      return;
    }
    setCreateBusy(true);
    setCreateIssue(null);
    try {
      const created = await incidentGateway.create(validation.value);
      await finishCreatedIncident(created, false);
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      setCreateErrors(issue.fieldErrors);
      if (incidentCreateOutcomeIsAmbiguous(error)) {
        setCreateRecoveryPending(true);
        setCreateIssue('Hasil pembuatan tiket belum dapat dipastikan. Jangan kirim ulang. Periksa hasil pembuatan dengan correlation ID yang sama terlebih dahulu.');
      } else {
        setCreateIssue(issue.message);
      }
    } finally {
      setCreateBusy(false);
    }
  }

  async function recoverCreate() {
    if (!createRecoveryPending || submissionId === '') return;
    setRecoveryBusy(true);
    try {
      const recovered = await incidentGateway.recoverSubmission(submissionId);
      await finishCreatedIncident(recovered, true);
    } catch (error) {
      const issue = incidentPresentationIssue(error);
      if (issue.notFound) {
        setSubmissionId(newSubmissionId());
        setCreateRecoveryPending(false);
        setCreateIssue('Correlation sebelumnya tidak ditemukan di server. Tidak ada Incident yang dapat dipulihkan; correlation ID baru sudah disiapkan jika Anda memilih mencoba membuat tiket lagi.');
      } else {
        setCreateIssue(`Hasil pembuatan masih belum dapat dipastikan. ${issue.message}`);
      }
    } finally {
      setRecoveryBusy(false);
    }
  }

  const createDescription = useMemo(() => (
    'Identitas sekolah dan pelapor diambil dari sesi aktif. Perangkat bersifat opsional dan hanya dapat dicari di laboratorium yang dipilih.'
  ), []);

  return (
    <>
      <IncidentListView
        state={state}
        filters={filters}
        canCreate={canCreate}
        onFiltersChange={setFilters}
        onApplyFilters={applyFilters}
        onRetry={() => void load(appliedFilters, currentPage)}
        onCreate={() => void openCreate()}
        onDetail={(incident) => navigate(`/incidents/${incident.id}`)}
        onPageChange={(page) => void load(appliedFilters, page)}
      />
      <FormDialog
        open={createOpen}
        onClose={closeCreate}
        title="Buat Tiket Kerusakan"
        description={createDescription}
        onSubmit={() => void submitCreate()}
        submitLabel="Buat Tiket"
        loading={createBusy}
        submitDisabled={createRecoveryPending || recoveryBusy}
        size="xl"
      >
        {createIssue && <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{createIssue}</div>}
        {createRecoveryPending && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
            <p className="text-sm text-warning-foreground">POST create tidak akan diulang otomatis. Recovery hanya membaca hasil berdasarkan submissionId yang sama.</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              loading={recoveryBusy}
              disabled={createBusy}
              onClick={() => void recoverCreate()}
            >
              Periksa hasil pembuatan
            </Button>
          </div>
        )}
        <IncidentCreateFormFields
          values={createValues}
          errors={createErrors}
          laboratories={laboratories}
          devices={devices}
          deviceSearch={deviceSearch}
          deviceSearchBusy={deviceSearchBusy}
          deviceHasMore={deviceHasMore}
          onChange={changeCreateValues}
          onDeviceSearchChange={setDeviceSearch}
          onSearchDevices={() => void searchDevices()}
        />
      </FormDialog>
    </>
  );
}
