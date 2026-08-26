import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, ChevronLeft, ChevronRight, Cpu, Eye, Laptop, Pencil, Plus, Search, ServerOff } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { FormDialog } from '@/components/forms/FormDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { hasServerPermission } from '@/lib/authIdentity';
import {
  ACCESS_POINT_BANDS,
  DEVICE_LIFECYCLE_LABELS,
  DEVICE_PROFILE_FIELDS,
  DEVICE_TYPE_LABELS,
  changedDeviceFields,
  createDeviceInputFromForm,
  deviceFormFromDto,
  devicePresentationIssue,
  deviceTechnicalProfileRows,
  emptyDeviceForm,
  loadLatestDeviceAfterConflict,
  validateDeviceForm,
  type DeviceFormErrors,
  type DeviceFormValues,
  type DevicePresentationIssue,
  type DeviceProfileFieldDefinition,
} from '@/lib/devicePresentation';
import {
  deviceTransferPresentationIssue,
  normalizeTransferReason,
  reconcileDeviceTransfer,
  validateTransferForm,
  type DeviceTransferPresentationIssue,
  type TransferReconciliationResult,
  type TransferReconciliationSnapshot,
} from '@/lib/deviceTransferPresentation';
import {
  deviceFilterValuesFromSearchParams,
  deviceListSearchParams,
  loadDeviceCollectionForSearchParams,
  runDeviceListMutation,
  type DeviceFilterValues,
} from '@/lib/deviceCollection';
import {
  DEVICE_LIFECYCLE_STATUSES,
  DEVICE_TYPES,
  PRINTER_TECHNOLOGIES,
  deviceGateway,
  type DeviceDto,
  type DeviceLifecycleStatus,
  type DevicePage,
  type DeviceType,
} from '@/services/deviceApi';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  deviceTransferGateway,
  type DeviceTransferDto,
  type DeviceTransferPage,
} from '@/services/deviceTransferApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

export type DeviceListState =
  | { status: 'loading' }
  | { status: 'error'; issue: DevicePresentationIssue }
  | { status: 'ready'; page: DevicePage };

export type DeviceDetailState =
  | { status: 'loading' }
  | { status: 'error'; issue: DevicePresentationIssue }
  | { status: 'not_found' }
  | { status: 'ready'; device: DeviceDto };

type TransferHistoryState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; page: DeviceTransferPage }
  | { status: 'empty'; page: DeviceTransferPage }
  | { status: 'error'; issue: DeviceTransferPresentationIssue };

interface TransferFormValues {
  destinationLaboratoryId: string;
  reason: string;
}

function lifecycleTone(status: DeviceLifecycleStatus): 'success' | 'info' | 'muted' | 'danger' {
  if (status === 'in_service') return 'success';
  if (status === 'spare') return 'info';
  if (status === 'retired') return 'muted';
  return 'danger';
}

export function DeviceLifecycleBadge({ status }: { status: DeviceLifecycleStatus }) {
  return <Badge tone={lifecycleTone(status)}>{DEVICE_LIFECYCLE_LABELS[status]}</Badge>;
}

function laboratoryName(laboratories: readonly LaboratoryDto[], id: string | null): string {
  if (id === null) return 'Belum ditetapkan';
  const laboratory = laboratories.find((candidate) => candidate.id === id);
  return laboratory ? `${laboratory.code} · ${laboratory.name}` : id;
}

interface DeviceListViewProps {
  state: DeviceListState;
  laboratories: LaboratoryDto[];
  filters: DeviceFilterValues;
  canCreate: boolean;
  canUpdate: boolean;
  onFiltersChange: (filters: DeviceFilterValues) => void;
  onSearch: () => void;
  onRetry: () => void;
  onCreate: () => void;
  onDetail: (device: DeviceDto) => void;
  onEdit: (device: DeviceDto) => void;
  onPageChange: (page: number) => void;
}

export function DeviceListView({
  state,
  laboratories,
  filters,
  canCreate,
  canUpdate,
  onFiltersChange,
  onSearch,
  onRetry,
  onCreate,
  onDetail,
  onEdit,
  onPageChange,
}: DeviceListViewProps) {
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    onSearch();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perangkat"
        description="Kelola inventaris perangkat canonical pada sekolah aktif."
        icon={<Laptop className="h-5 w-5" />}
        actions={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Tambah Perangkat</Button> : undefined}
      />

      <Card>
        <CardContent>
          <form className="flex flex-wrap items-end gap-3" onSubmit={submitSearch}>
            <div className="w-full sm:min-w-64 sm:flex-1">
              <Input
                label="Pencarian"
                icon={<Search className="h-4 w-4" />}
                value={filters.search}
                maxLength={100}
                placeholder="Kode, hostname, serial, merek, atau model"
                onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                label="Jenis"
                value={filters.deviceType}
                placeholder="Semua jenis"
                options={DEVICE_TYPES.map((value) => ({ value, label: DEVICE_TYPE_LABELS[value] }))}
                onChange={(event) => onFiltersChange({ ...filters, deviceType: event.target.value as DeviceFilterValues['deviceType'] })}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select
                label="Lifecycle"
                value={filters.lifecycleStatus}
                placeholder="Semua lifecycle"
                options={DEVICE_LIFECYCLE_STATUSES.map((value) => ({ value, label: DEVICE_LIFECYCLE_LABELS[value] }))}
                onChange={(event) => onFiltersChange({ ...filters, lifecycleStatus: event.target.value as DeviceFilterValues['lifecycleStatus'] })}
              />
            </div>
            <div className="w-full sm:w-64">
              <Select
                label="Laboratorium asal"
                value={filters.homeLaboratoryId}
                placeholder="Semua laboratorium"
                options={laboratories.map((laboratory) => ({ value: laboratory.id, label: `${laboratory.code} · ${laboratory.name}` }))}
                onChange={(event) => onFiltersChange({ ...filters, homeLaboratoryId: event.target.value })}
              />
            </div>
            <Button type="submit" variant="secondary" size="sm" icon={<Search className="h-4 w-4" />}>Terapkan</Button>
          </form>
        </CardContent>
      </Card>

      {state.status === 'loading' && <Card><LoadingState label="Memuat perangkat dari server..." /></Card>}
      {state.status === 'error' && <Card><ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} /></Card>}
      {state.status === 'ready' && state.page.data.length === 0 && (
        <Card>
          <EmptyState
            icon={<Laptop className="h-7 w-7" />}
            title="Belum ada perangkat"
            description="Tidak ada Device canonical yang sesuai dengan filter pada konteks sekolah aktif."
            action={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Tambah Perangkat</Button> : undefined}
          />
        </Card>
      )}
      {state.status === 'ready' && state.page.data.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {state.page.data.map((device) => (
              <Card key={device.id} hover>
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-content">
                        <Cpu className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink-primary">{device.deviceCode}</p>
                        <p className="truncate text-xs text-ink-muted">{DEVICE_TYPE_LABELS[device.deviceType]}</p>
                      </div>
                    </div>
                    <DeviceLifecycleBadge status={device.lifecycleStatus} />
                  </div>

                  <dl className="space-y-2 rounded-lg bg-base-700/30 p-3 text-xs">
                    <DeviceListRow label="Hostname" value={device.hostname ?? 'Tidak tersedia'} />
                    <DeviceListRow label="Merek / Model" value={[device.brand, device.model].filter(Boolean).join(' ') || 'Tidak tersedia'} />
                    <DeviceListRow label="Laboratorium asal" value={laboratoryName(laboratories, device.homeLaboratoryId)} />
                    <DeviceListRow label="Versi" value={String(device.version)} />
                  </dl>

                  <div className="flex flex-wrap gap-2 border-t border-base-700/60 pt-3">
                    <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} className="flex-1" onClick={() => onDetail(device)}>Detail</Button>
                    {canUpdate && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        aria-label={`Edit perangkat ${device.deviceCode}`}
                        title="Edit perangkat"
                        onClick={() => onEdit(device)}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-700/70 bg-base-800/80 px-4 py-3 text-sm">
            <p className="text-ink-muted">
              Halaman {state.page.meta.page} dari {state.page.meta.lastPage} · {state.page.meta.total} perangkat
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={state.page.meta.page <= 1} onClick={() => onPageChange(state.page.meta.page - 1)}>Sebelumnya</Button>
              <Button variant="secondary" size="sm" disabled={state.page.meta.page >= state.page.meta.lastPage} onClick={() => onPageChange(state.page.meta.page + 1)}>Berikutnya</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DeviceListRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-muted">{label}</dt>
      <dd className="break-words text-right text-ink-secondary">{value}</dd>
    </div>
  );
}

interface DeviceFormFieldsProps {
  values: DeviceFormValues;
  errors: DeviceFormErrors;
  laboratories: LaboratoryDto[];
  editing?: DeviceDto | null;
  disabled?: boolean;
  onChange: (values: DeviceFormValues) => void;
}

export function DeviceFormFields({ values, errors, laboratories, editing, disabled, onChange }: DeviceFormFieldsProps) {
  const establishedHome = Boolean(editing?.homeLaboratoryId);
  const terminalLifecycle = editing?.lifecycleStatus === 'retired' || editing?.lifecycleStatus === 'decommissioned';
  const activeLaboratories = laboratories.filter((laboratory) => laboratory.status === 'active');

  function setProfileValue(key: string, value: unknown, remove = false) {
    const technicalProfile = { ...values.technicalProfile };
    if (remove) delete technicalProfile[key];
    else technicalProfile[key] = value;
    onChange({ ...values, technicalProfile });
  }

  return (
    <div className="space-y-5">
      {errors.request && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errors.request}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Kode perangkat"
          name="deviceCode"
          value={values.deviceCode}
          error={errors.deviceCode}
          maxLength={32}
          disabled={disabled || Boolean(editing)}
          onChange={(event) => onChange({ ...values, deviceCode: event.target.value.toUpperCase() })}
          required
        />
        <Select
          label="Jenis perangkat"
          name="deviceType"
          value={values.deviceType}
          error={errors.deviceType}
          disabled={disabled || Boolean(editing)}
          options={DEVICE_TYPES.map((value) => ({ value, label: DEVICE_TYPE_LABELS[value] }))}
          onChange={(event) => {
            const deviceType = event.target.value as DeviceType;
            onChange({ ...values, deviceType, technicalProfile: {}, otherProfileJson: '{}' });
          }}
          required
        />
        <Input label="Serial number" value={values.serialNumber} error={errors.serialNumber} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, serialNumber: event.target.value })} />
        <Input label="Hostname" value={values.hostname} error={errors.hostname} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, hostname: event.target.value })} />
        <Input label="Merek" value={values.brand} error={errors.brand} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, brand: event.target.value })} />
        <Input label="Model" value={values.model} error={errors.model} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, model: event.target.value })} />

        {establishedHome ? (
          <Input
            label="Laboratorium asal"
            value={laboratoryName(laboratories, editing?.homeLaboratoryId ?? null)}
            disabled
            hint="Perubahan laboratorium asal memerlukan alur Transfer."
          />
        ) : (
          <Select
            label="Laboratorium asal"
            value={values.homeLaboratoryId}
            error={errors.homeLaboratoryId}
            disabled={disabled}
            placeholder="Belum ditetapkan"
            options={activeLaboratories.map((laboratory) => ({ value: laboratory.id, label: `${laboratory.code} · ${laboratory.name}` }))}
            onChange={(event) => onChange({ ...values, homeLaboratoryId: event.target.value })}
          />
        )}

        {terminalLifecycle ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink-secondary">Lifecycle</p>
            <DeviceLifecycleBadge status={editing.lifecycleStatus} />
            <p className="text-xs text-ink-muted">Lifecycle terminal tidak dapat diaktifkan kembali melalui edit biasa.</p>
          </div>
        ) : (
          <Select
            label="Lifecycle"
            value={values.lifecycleStatus}
            error={errors.lifecycleStatus}
            disabled={disabled}
            options={(['in_service', 'spare'] as const).map((value) => ({ value, label: DEVICE_LIFECYCLE_LABELS[value] }))}
            onChange={(event) => onChange({ ...values, lifecycleStatus: event.target.value as DeviceFormValues['lifecycleStatus'] })}
          />
        )}
      </div>

      <div className="border-t border-base-700 pt-5">
        <h3 className="text-sm font-semibold text-ink-primary">Profil teknis · {DEVICE_TYPE_LABELS[values.deviceType]}</h3>
        <p className="mt-1 text-xs text-ink-muted">Profil menggantikan objek teknis secara utuh ketika berubah.</p>
        <div className="mt-4">
          {values.deviceType === 'other' ? (
            <Textarea
              label="Objek JSON"
              value={values.otherProfileJson}
              error={errors.technicalProfile}
              disabled={disabled}
              rows={8}
              spellCheck={false}
              onChange={(event) => onChange({ ...values, otherProfileJson: event.target.value })}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {DEVICE_PROFILE_FIELDS[values.deviceType].map((field) => (
                <DeviceProfileField
                  key={field.key}
                  definition={field}
                  value={values.technicalProfile[field.key]}
                  disabled={disabled}
                  onChange={(value, remove) => setProfileValue(field.key, value, remove)}
                />
              ))}
              {errors.technicalProfile && <p className="sm:col-span-2 text-xs text-danger">{errors.technicalProfile}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeviceProfileField({ definition, value, disabled, onChange }: {
  definition: DeviceProfileFieldDefinition;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown, remove?: boolean) => void;
}) {
  if (definition.kind === 'boolean') {
    return (
      <label className="flex h-10 items-center gap-3 self-end rounded-lg border border-base-600 bg-base-800 px-3 text-sm text-ink-secondary">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {definition.label}
      </label>
    );
  }
  if (definition.kind === 'bands') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2 rounded-lg border border-base-600 p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium text-ink-secondary">{definition.label}</legend>
        <div className="flex flex-wrap gap-4">
          {ACCESS_POINT_BANDS.map((band) => (
            <label key={band} className="flex items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(band)}
                onChange={(event) => {
                  const next = event.target.checked ? [...selected, band] : selected.filter((item) => item !== band);
                  onChange(next, next.length === 0);
                }}
              />
              {band}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (definition.kind === 'printer_technology') {
    return (
      <Select
        label={definition.label}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        placeholder="Belum diisi"
        options={PRINTER_TECHNOLOGIES.map((technology) => ({ value: technology, label: technology.replace('_', ' ') }))}
        onChange={(event) => onChange(event.target.value, event.target.value === '')}
      />
    );
  }
  if (definition.kind === 'number' || definition.kind === 'integer') {
    return (
      <Input
        label={definition.label}
        type="number"
        min={definition.minimum}
        step={definition.kind === 'integer' ? 1 : 'any'}
        value={typeof value === 'number' ? String(value) : ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value), event.target.value === '')}
      />
    );
  }
  return (
    <Input
      label={definition.label}
      value={typeof value === 'string' ? value : ''}
      maxLength={255}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value, event.target.value === '')}
    />
  );
}

export function DevicesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const canCreate = hasServerPermission(user, 'devices.create');
  const canUpdate = hasServerPermission(user, 'devices.update');
  const canViewLaboratories = hasServerPermission(user, 'laboratories.view');
  const [state, setState] = useState<DeviceListState>({ status: 'loading' });
  const [laboratories, setLaboratories] = useState<LaboratoryDto[]>([]);
  const [filters, setFilters] = useState<DeviceFilterValues>(() => deviceFilterValuesFromSearchParams(searchParams));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceDto | null>(null);
  const [form, setForm] = useState<DeviceFormValues>(emptyDeviceForm);
  const [formErrors, setFormErrors] = useState<DeviceFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const submissionActive = useRef(false);
  const loadSequence = useRef(0);

  const recoverAuthBoundary = useCallback(async () => {
    await bootstrapSession({ force: true });
  }, [bootstrapSession]);

  const load = useCallback(async (showLoading = true) => {
    const sequence = ++loadSequence.current;
    if (showLoading) setState({ status: 'loading' });
    try {
      const result = await loadDeviceCollectionForSearchParams(deviceGateway, searchParams);
      if (sequence !== loadSequence.current) return;
      if (result.status === 'redirect') {
        setSearchParams(result.searchParams, { replace: true });
        return;
      }
      setState({ status: 'ready', page: result.page });
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const issue = devicePresentationIssue(error);
      if (issue.authBoundary) await recoverAuthBoundary();
      else setState({ status: 'error', issue });
    }
  }, [recoverAuthBoundary, searchParams, setSearchParams]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    setFilters(deviceFilterValuesFromSearchParams(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (!canViewLaboratories) {
      setLaboratories([]);
      return;
    }
    let active = true;
    void laboratoryGateway.list()
      .then((items) => { if (active) setLaboratories(items); })
      .catch(() => { if (active) setLaboratories([]); });
    return () => { active = false; };
  }, [canViewLaboratories]);

  function applyFilters(next: DeviceFilterValues, page = 1) {
    setSearchParams(deviceListSearchParams(next, page));
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyDeviceForm());
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(device: DeviceDto) {
    setEditing(device);
    setForm(deviceFormFromDto(device));
    setFormErrors({});
    setDialogOpen(true);
  }

  function closeDialog() {
    if (!submissionActive.current) setDialogOpen(false);
  }

  async function saveDevice() {
    if (submissionActive.current) return;
    submissionActive.current = true;
    const validated = validateDeviceForm(form);
    if (!validated.ok) {
      setFormErrors(validated.errors);
      submissionActive.current = false;
      return;
    }

    const changes = editing ? changedDeviceFields(editing, validated.value) : null;
    if (editing && Object.keys(changes ?? {}).length === 0) {
      setFormErrors({ request: 'Tidak ada perubahan yang perlu disimpan.' });
      submissionActive.current = false;
      return;
    }

    setSubmitting(true);
    setFormErrors({});
    try {
      await runDeviceListMutation(
        editing
          ? () => deviceGateway.update(editing.id, editing.version, changes ?? {})
          : () => deviceGateway.create(createDeviceInputFromForm(validated.value)),
        () => load(false),
      );
      setDialogOpen(false);
      toast(editing ? 'Perangkat diperbarui' : 'Perangkat ditambahkan', 'success');
    } catch (error) {
      const issue = devicePresentationIssue(error);
      if (issue.authBoundary) {
        await recoverAuthBoundary();
      } else if (issue.versionConflict && editing) {
        try {
          const { result: latest } = await runDeviceListMutation(
            () => loadLatestDeviceAfterConflict(deviceGateway, editing.id),
            () => load(false),
          );
          setEditing(latest);
          setForm(deviceFormFromDto(latest));
          setFormErrors({ request: issue.message });
        } catch (reloadError) {
          const reloadIssue = devicePresentationIssue(reloadError);
          if (reloadIssue.authBoundary) await recoverAuthBoundary();
          else setFormErrors({ request: reloadIssue.message });
        }
      } else {
        setFormErrors({ ...issue.fieldErrors, request: issue.fieldErrors.request ?? issue.message });
      }
    } finally {
      setSubmitting(false);
      submissionActive.current = false;
    }
  }

  return (
    <>
      <DeviceListView
        state={state}
        laboratories={laboratories}
        filters={filters}
        canCreate={canCreate}
        canUpdate={canUpdate}
        onFiltersChange={setFilters}
        onSearch={() => applyFilters(filters)}
        onRetry={() => void load()}
        onCreate={openCreate}
        onDetail={(device) => navigate(`/devices/${encodeURIComponent(device.id)}`)}
        onEdit={openEdit}
        onPageChange={(page) => applyFilters(deviceFilterValuesFromSearchParams(searchParams), page)}
      />
      <FormDialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? `Edit ${editing.deviceCode}` : 'Tambah Perangkat'}
        description="Hanya field canonical Device yang akan dikirim ke server."
        onSubmit={() => void saveDevice()}
        submitLabel={editing ? 'Perbarui' : 'Simpan'}
        loading={submitting}
        submitDisabled={submitting}
        size="xl"
      >
        <DeviceFormFields
          values={form}
          errors={formErrors}
          laboratories={laboratories}
          editing={editing}
          disabled={submitting}
          onChange={(next) => { setForm(next); setFormErrors({}); }}
        />
      </FormDialog>
    </>
  );
}

interface DeviceDetailViewProps {
  state: DeviceDetailState;
  laboratoryLabel?: string;
  canUpdate: boolean;
  canViewLaboratories?: boolean;
  canCreateTransfer?: boolean;
  canViewTransferHistory?: boolean;
  transferHistory?: TransferHistoryState;
  transferRecoveryMessage?: string;
  onOpenTransfer?: (device: DeviceDto) => void;
  onRetryTransferHistory?: () => void;
  onTransferPageChange?: (page: number) => void;
  onRetryReconciliation?: () => void;
  onRetry: () => void;
  onBack: () => void;
  onEdit: (device: DeviceDto) => void;
}

export function DeviceDetailView({
  state,
  laboratoryLabel,
  canUpdate,
  canViewLaboratories = false,
  canCreateTransfer = false,
  canViewTransferHistory = false,
  transferHistory = { status: 'idle' },
  transferRecoveryMessage,
  onOpenTransfer,
  onRetryTransferHistory,
  onTransferPageChange,
  onRetryReconciliation,
  onRetry,
  onBack,
  onEdit,
}: DeviceDetailViewProps) {
  if (state.status === 'loading') return <Card><LoadingState label="Memuat detail perangkat..." /></Card>;
  if (state.status === 'not_found') {
    return <EmptyState title="Perangkat tidak ditemukan" description="Data tidak tersedia pada konteks sekolah aktif." action={<Button onClick={onBack}>Kembali</Button>} />;
  }
  if (state.status === 'error') return <Card><ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} /></Card>;

  const device = state.device;
  const profileRows = deviceTechnicalProfileRows(device);
  return (
    <div className="space-y-6">
      <PageHeader
        title={device.deviceCode}
        description={`${DEVICE_TYPE_LABELS[device.deviceType]} · inventaris Device canonical`}
        icon={<Laptop className="h-5 w-5" />}
        actions={(
          <div className="flex flex-wrap gap-2">
            {canUpdate && <Button size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(device)}>Edit</Button>}
            <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Kembali</Button>
          </div>
        )}
      />

      <DetailSection title="Identitas">
        <DetailValue label="Kode perangkat" value={device.deviceCode} />
        <DetailValue label="QR public ID" value={device.qrPublicId} breakAll />
        <DetailValue label="Jenis perangkat" value={DEVICE_TYPE_LABELS[device.deviceType]} />
        <DetailValue label="ID Device" value={device.id} breakAll />
      </DetailSection>
      <DetailSection title="Kustodi">
        <DetailValue label="Laboratorium asal" value={laboratoryLabel ?? device.homeLaboratoryId ?? 'Belum ditetapkan'} breakAll />
        <p className="sm:col-span-2 text-xs text-ink-muted">Laboratorium asal adalah kustodi normal, bukan lokasi fisik saat ini.</p>
        {device.homeLaboratoryId === null ? (
          <p className="sm:col-span-2 text-xs text-ink-muted">Penetapan awal laboratorium dilakukan melalui edit Device biasa.</p>
        ) : device.lifecycleStatus === 'decommissioned' ? (
          <p className="sm:col-span-2 text-xs text-ink-muted">Device dinonaktifkan permanen sehingga tidak dapat dipindahkan.</p>
        ) : canCreateTransfer && !canViewLaboratories ? (
          <p className="sm:col-span-2 text-xs text-ink-muted">Laboratorium tujuan belum dapat ditemukan karena izin laboratories.view diperlukan.</p>
        ) : canCreateTransfer && onOpenTransfer ? (
          <div className="sm:col-span-2">
            <Button size="sm" variant="outline" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => onOpenTransfer(device)}>
              Pindahkan Laboratorium
            </Button>
          </div>
        ) : null}
      </DetailSection>
      <DetailSection title="Metadata">
        <DetailValue label="Serial number" value={device.serialNumber ?? 'Tidak tersedia'} />
        <DetailValue label="Hostname" value={device.hostname ?? 'Tidak tersedia'} />
        <DetailValue label="Merek" value={device.brand ?? 'Tidak tersedia'} />
        <DetailValue label="Model" value={device.model ?? 'Tidak tersedia'} />
      </DetailSection>
      <DetailSection title="Lifecycle">
        <div><p className="text-xs text-ink-muted">Status</p><div className="mt-1"><DeviceLifecycleBadge status={device.lifecycleStatus} /></div></div>
      </DetailSection>
      <DetailSection title={`Profil teknis · schema v${device.technicalProfileVersion}`}>
        {profileRows.length === 0
          ? <p className="sm:col-span-2 text-sm text-ink-muted">Profil teknis belum diisi.</p>
          : profileRows.map((row) => <DetailValue key={row.key} label={row.label} value={row.value} />)}
      </DetailSection>
      <DetailSection title="Revisi">
        <DetailValue label="Versi Device" value={String(device.version)} />
        <DetailValue label="Dibuat" value={formatDateTime(device.createdAt)} />
        <DetailValue label="Diperbarui" value={formatDateTime(device.updatedAt)} />
      </DetailSection>
      {canViewTransferHistory && (
        <TransferHistorySection
          state={transferHistory}
          onRetry={onRetryTransferHistory}
          onPageChange={onTransferPageChange}
        />
      )}
      {transferRecoveryMessage && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-secondary">{transferRecoveryMessage}</p>
            {onRetryReconciliation && <Button size="sm" variant="outline" onClick={onRetryReconciliation}>Muat ulang data</Button>}
          </CardContent>
        </Card>
      )}
      <Card>
        <EmptyState
          icon={<ServerOff className="h-7 w-7" />}
          title="Domain terkait tetap terpisah"
          description="Aset, Layout, Monitoring, telemetry, QR scan/print, dan Loan tetap berada pada domain terpisah."
        />
      </Card>
    </div>
  );
}

function TransferHistorySection({
  state,
  onRetry,
  onPageChange,
}: {
  state: TransferHistoryState;
  onRetry?: () => void;
  onPageChange?: (page: number) => void;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-primary">Riwayat Transfer</h2>
          {state.status === 'ready' || state.status === 'empty' ? (
            <span className="text-xs text-ink-muted">{state.page.meta.total} catatan</span>
          ) : null}
        </div>
        {state.status === 'loading' || state.status === 'idle' ? <LoadingState label="Memuat riwayat Transfer..." /> : null}
        {state.status === 'error' ? <ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} /> : null}
        {state.status === 'empty' ? <EmptyState title="Belum ada riwayat Transfer" description="Perubahan laboratorium asal akan tercatat di sini." /> : null}
        {state.status === 'ready' && (
          <div className="space-y-3">
            {state.page.data.map((transfer) => <TransferHistoryCard key={transfer.id} transfer={transfer} />)}
            <TransferPagination meta={state.page.meta} onPageChange={onPageChange} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TransferHistoryCard({ transfer }: { transfer: DeviceTransferDto }) {
  return (
    <div className="rounded-xl border border-base-700 bg-base-800/50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-ink-primary">{transfer.sourceLaboratory.code} · {transfer.sourceLaboratory.name} <span className="text-ink-muted">→</span> {transfer.destinationLaboratory.code} · {transfer.destinationLaboratory.name}</p>
        <span className="text-xs text-ink-muted">{formatDateTime(transfer.createdAt)}</span>
      </div>
      <div className="mt-2 grid gap-1 text-xs text-ink-muted sm:grid-cols-3">
        <span>Versi {transfer.deviceVersionBefore} → {transfer.deviceVersionAfter}</span>
        <span>Aktor: {transfer.actor.name}</span>
        <span>Alasan: {transfer.reason ?? 'Tidak ada alasan'}</span>
      </div>
    </div>
  );
}

function TransferPagination({ meta, onPageChange }: { meta: DeviceTransferPage['meta']; onPageChange?: (page: number) => void }) {
  if (meta.lastPage <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-2">
      <Button size="sm" variant="ghost" disabled={meta.page <= 1} aria-label="Halaman Transfer sebelumnya" onClick={() => onPageChange?.(meta.page - 1)} icon={<ChevronLeft className="h-4 w-4" />} />
      <span className="text-xs text-ink-muted">Halaman {meta.page} dari {meta.lastPage}</span>
      <Button size="sm" variant="ghost" disabled={meta.page >= meta.lastPage} aria-label="Halaman Transfer berikutnya" onClick={() => onPageChange?.(meta.page + 1)} icon={<ChevronRight className="h-4 w-4" />} />
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-sm font-semibold text-ink-primary">{title}</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2">{children}</dl>
      </CardContent>
    </Card>
  );
}

function DetailValue({ label, value, breakAll }: { label: string; value: string; breakAll?: boolean }) {
  return <div><dt className="text-xs text-ink-muted">{label}</dt><dd className={`mt-1 text-ink-primary ${breakAll ? 'break-all' : 'break-words'}`}>{value}</dd></div>;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function DeviceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const canUpdate = hasServerPermission(user, 'devices.update');
  const canViewLaboratories = hasServerPermission(user, 'laboratories.view');
  const canCreateTransfer = hasServerPermission(user, 'device-transfers.create');
  const canViewTransferHistory = hasServerPermission(user, 'device-transfers.view');
  const [state, setState] = useState<DeviceDetailState>({ status: 'loading' });
  const [laboratories, setLaboratories] = useState<LaboratoryDto[]>([]);
  const [transferHistory, setTransferHistory] = useState<TransferHistoryState>({ status: 'idle' });
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferForm, setTransferForm] = useState<TransferFormValues>({ destinationLaboratoryId: '', reason: '' });
  const [transferErrors, setTransferErrors] = useState<Partial<Record<'destinationLaboratoryId' | 'reason' | 'request', string>>>({});
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferRecoveryMessage, setTransferRecoveryMessage] = useState<string | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DeviceFormValues>(emptyDeviceForm);
  const [formErrors, setFormErrors] = useState<DeviceFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const submissionActive = useRef(false);
  const transferSubmissionActive = useRef(false);
  const loadSequence = useRef(0);
  const historySequence = useRef(0);
  const transferRouteSequence = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setState({ status: 'not_found' });
      return;
    }
    const sequence = ++loadSequence.current;
    setState({ status: 'loading' });
    try {
      const device = await deviceGateway.show(id);
      if (sequence === loadSequence.current) setState({ status: 'ready', device });
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const issue = devicePresentationIssue(error);
      if (issue.authBoundary) await bootstrapSession({ force: true });
      else setState(issue.notFound ? { status: 'not_found' } : { status: 'error', issue });
    }
  }, [bootstrapSession, id]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  useEffect(() => {
    transferRouteSequence.current += 1;
    setTransferDialogOpen(false);
    setTransferSubmitting(false);
    setTransferErrors({});
    setTransferRecoveryMessage(undefined);
    transferSubmissionActive.current = false;
  }, [id]);

  useEffect(() => {
    if (!canViewLaboratories) return;
    let active = true;
    void laboratoryGateway.list().then((items) => { if (active) setLaboratories(items); }).catch(() => undefined);
    return () => { active = false; };
  }, [canViewLaboratories]);

  const loadTransferHistory = useCallback(async (page = 1) => {
    if (!id || !canViewTransferHistory) return;
    const sequence = ++historySequence.current;
    setTransferHistory({ status: 'loading' });
    try {
      const result = await deviceTransferGateway.history(id, { page, perPage: 10 });
      if (sequence !== historySequence.current) return;
      setTransferHistory(result.data.length === 0 ? { status: 'empty', page: result } : { status: 'ready', page: result });
    } catch (error) {
      if (sequence !== historySequence.current) return;
      const issue = deviceTransferPresentationIssue(error, 'history');
      if (issue.authBoundary) await bootstrapSession({ force: true });
      else setTransferHistory({ status: 'error', issue });
    }
  }, [bootstrapSession, canViewTransferHistory, id]);

  useEffect(() => {
    if (!canViewTransferHistory) {
      setTransferHistory({ status: 'idle' });
      return;
    }
    void loadTransferHistory(1);
    return () => { historySequence.current += 1; };
  }, [canViewTransferHistory, id, loadTransferHistory]);

  const currentDevice = state.status === 'ready' ? state.device : null;
  const currentLaboratory = useMemo(
    () => currentDevice?.homeLaboratoryId ? laboratoryName(laboratories, currentDevice.homeLaboratoryId) : undefined,
    [currentDevice, laboratories],
  );

  function openEdit(device: DeviceDto) {
    setForm(deviceFormFromDto(device));
    setFormErrors({});
    setDialogOpen(true);
  }

  const destinationOptions = useMemo(
    () => laboratories.filter((laboratory) => laboratory.status === 'active' && laboratory.id !== currentDevice?.homeLaboratoryId),
    [currentDevice?.homeLaboratoryId, laboratories],
  );

  function openTransfer(device: DeviceDto) {
    if (!canCreateTransfer || !device.homeLaboratoryId || device.lifecycleStatus === 'decommissioned') return;
    setTransferForm({ destinationLaboratoryId: '', reason: '' });
    setTransferErrors({});
    setTransferRecoveryMessage(undefined);
    setTransferDialogOpen(true);
  }

  async function reconcileTransfer(snapshot?: TransferReconciliationSnapshot, knownSuccess = false): Promise<TransferReconciliationResult> {
    if (!id) return { status: 'stale_route' };
    const scope = { id, sequence: transferRouteSequence.current };
    const isCurrent = () => scope.id === id && scope.sequence === transferRouteSequence.current;
    const result = await reconcileDeviceTransfer({
      deviceId: scope.id,
      snapshot,
      knownSuccess,
      canViewHistory: canViewTransferHistory,
      deviceGateway,
      transferGateway: deviceTransferGateway,
      isCurrent,
    });
    if (result.status === 'stale_route' || !isCurrent()) return { status: 'stale_route' };
    if (result.status === 'unavailable') return result;
    if (isCurrent()) setState({ status: 'ready', device: result.device });
    if (result.history?.status === 'available' && isCurrent()) {
      const page = result.history.page;
      setTransferHistory(page.data.length === 0 ? { status: 'empty', page } : { status: 'ready', page });
    } else if (result.history?.status === 'unavailable') {
      if (result.history.issue.authBoundary) {
        await bootstrapSession({ force: true });
        if (!isCurrent()) return { status: 'stale_route' };
      } else if (isCurrent()) {
        setTransferHistory({ status: 'error', issue: result.history.issue });
      }
    }
    return isCurrent() ? result : { status: 'stale_route' };
  }

  async function saveTransfer() {
    if (!currentDevice || !currentDevice.homeLaboratoryId || transferSubmissionActive.current) return;
    transferSubmissionActive.current = true;
    const scope = { id: currentDevice.id, sequence: transferRouteSequence.current };
    const isCurrent = () => scope.id === id && scope.sequence === transferRouteSequence.current;
    const fieldErrors = validateTransferForm(transferForm.destinationLaboratoryId, transferForm.reason);
    if (transferForm.destinationLaboratoryId === currentDevice.homeLaboratoryId) fieldErrors.destinationLaboratoryId = 'Laboratorium tujuan harus berbeda dari laboratorium asal.';
    if (Object.keys(fieldErrors).length > 0) {
      setTransferErrors(fieldErrors);
      transferSubmissionActive.current = false;
      return;
    }
    const snapshot: TransferReconciliationSnapshot = {
      deviceId: currentDevice.id,
      submittedVersion: currentDevice.version,
      sourceLaboratoryId: currentDevice.homeLaboratoryId,
      destinationLaboratoryId: transferForm.destinationLaboratoryId,
      reason: normalizeTransferReason(transferForm.reason),
    };
    setTransferSubmitting(true);
    setTransferErrors({});
    setTransferRecoveryMessage(undefined);
    try {
      await deviceTransferGateway.create(currentDevice.id, currentDevice.version, {
        destinationLaboratoryId: snapshot.destinationLaboratoryId,
        reason: snapshot.reason,
      });
      if (!isCurrent()) return;
      const reconciliation = await reconcileTransfer(undefined, true);
      if (!isCurrent() || reconciliation.status === 'stale_route') return;
      if (reconciliation.status === 'unavailable') {
        setTransferRecoveryMessage('Pemindahan berhasil, tetapi data terbaru belum dapat dimuat.');
      } else {
        setTransferDialogOpen(false);
        toast('Laboratorium asal perangkat diperbarui', 'success');
      }
    } catch (error) {
      if (!isCurrent()) return;
      const issue = deviceTransferPresentationIssue(error, 'mutation');
      if (issue.authBoundary) {
        await bootstrapSession({ force: true });
      } else if (issue.ambiguous) {
        const reconciliation = await reconcileTransfer(snapshot);
        if (!isCurrent() || reconciliation.status === 'stale_route') return;
        if (reconciliation.status === 'confirmed') {
          setTransferDialogOpen(false);
          toast('Laboratorium asal perangkat diperbarui', 'success');
        } else if (reconciliation.status === 'unavailable') {
          setTransferErrors({ request: 'Hasil pemindahan belum dapat dipastikan. Muat ulang data kanonik sebelum mencoba lagi.' });
        } else if (reconciliation.status === 'unconfirmed') {
          setTransferErrors({ request: 'Pemindahan tidak terkonfirmasi. Periksa data terbaru sebelum mengirim perintah baru.' });
        } else {
          setTransferErrors({ request: 'Data perangkat telah berubah di server. Periksa kembali laboratorium asal dan tujuan.' });
        }
      } else if (issue.versionConflict) {
        const reconciliation = await reconcileTransfer();
        if (!isCurrent() || reconciliation.status === 'stale_route') return;
        setTransferErrors({ request: issue.message });
      } else {
        if (!isCurrent()) return;
        setTransferErrors({ ...issue.fieldErrors, request: issue.fieldErrors.request ?? issue.message });
      }
    } finally {
      if (isCurrent()) setTransferSubmitting(false);
      transferSubmissionActive.current = false;
    }
  }

  async function retryTransferReconciliation() {
    const scope = { id, sequence: transferRouteSequence.current };
    if (!scope.id) return;
    setTransferRecoveryMessage(undefined);
    const result = await reconcileTransfer(undefined, true);
    if (scope.id !== id || scope.sequence !== transferRouteSequence.current || result.status === 'stale_route') return;
    if (result.status === 'unavailable') setTransferRecoveryMessage('Pemindahan berhasil, tetapi data terbaru belum dapat dimuat.');
  }

  async function saveDevice() {
    if (!currentDevice || submissionActive.current) return;
    submissionActive.current = true;
    const validated = validateDeviceForm(form);
    if (!validated.ok) {
      setFormErrors(validated.errors);
      submissionActive.current = false;
      return;
    }
    const changes = changedDeviceFields(currentDevice, validated.value);
    if (Object.keys(changes).length === 0) {
      setFormErrors({ request: 'Tidak ada perubahan yang perlu disimpan.' });
      submissionActive.current = false;
      return;
    }
    setSubmitting(true);
    setFormErrors({});
    try {
      const saved = await deviceGateway.update(currentDevice.id, currentDevice.version, changes);
      setState({ status: 'ready', device: saved });
      setDialogOpen(false);
      toast('Perangkat diperbarui', 'success');
    } catch (error) {
      const issue = devicePresentationIssue(error);
      if (issue.authBoundary) {
        await bootstrapSession({ force: true });
      } else if (issue.versionConflict) {
        try {
          const latest = await loadLatestDeviceAfterConflict(deviceGateway, currentDevice.id);
          setState({ status: 'ready', device: latest });
          setForm(deviceFormFromDto(latest));
          setFormErrors({ request: issue.message });
        } catch (reloadError) {
          const reloadIssue = devicePresentationIssue(reloadError);
          if (reloadIssue.authBoundary) await bootstrapSession({ force: true });
          else setFormErrors({ request: reloadIssue.message });
        }
      } else {
        setFormErrors({ ...issue.fieldErrors, request: issue.fieldErrors.request ?? issue.message });
      }
    } finally {
      setSubmitting(false);
      submissionActive.current = false;
    }
  }

  return (
    <>
      <DeviceDetailView
        state={state}
        laboratoryLabel={currentLaboratory}
        canUpdate={canUpdate}
        canCreateTransfer={canCreateTransfer}
        canViewLaboratories={canViewLaboratories}
        canViewTransferHistory={canViewTransferHistory}
        transferHistory={transferHistory}
        transferRecoveryMessage={transferRecoveryMessage}
        onOpenTransfer={openTransfer}
        onRetryTransferHistory={() => void loadTransferHistory(transferHistory.status === 'ready' || transferHistory.status === 'empty' ? transferHistory.page.meta.page : 1)}
        onTransferPageChange={(page) => void loadTransferHistory(page)}
        onRetryReconciliation={() => { void retryTransferReconciliation(); }}
        onRetry={() => void load()}
        onBack={() => navigate('/devices')}
        onEdit={openEdit}
      />
      <FormDialog
        open={dialogOpen}
        onClose={() => { if (!submissionActive.current) setDialogOpen(false); }}
        title={currentDevice ? `Edit ${currentDevice.deviceCode}` : 'Edit perangkat'}
        description="PATCH menggunakan versi Device terbaru sebagai precondition."
        onSubmit={() => void saveDevice()}
        submitLabel="Perbarui"
        loading={submitting}
        submitDisabled={submitting}
        size="xl"
      >
        <DeviceFormFields
          values={form}
          errors={formErrors}
          laboratories={laboratories}
          editing={currentDevice}
          disabled={submitting}
          onChange={(next) => { setForm(next); setFormErrors({}); }}
        />
      </FormDialog>
      <FormDialog
        open={transferDialogOpen}
        onClose={() => { if (!transferSubmissionActive.current) setTransferDialogOpen(false); }}
        title={currentDevice ? `Pindahkan ${currentDevice.deviceCode}` : 'Pindahkan Laboratorium'}
        description="Laboratorium asal adalah sumber read-only; hanya laboratorium tujuan dan alasan yang dapat dikirim."
        onSubmit={() => void saveTransfer()}
        submitLabel="Pindahkan"
        loading={transferSubmitting}
        submitDisabled={transferSubmitting || destinationOptions.length === 0}
        size="md"
      >
        <div className="space-y-4">
          <Input label="Laboratorium asal" value={currentLaboratory ?? currentDevice?.homeLaboratoryId ?? 'Belum ditetapkan'} disabled />
          <Select
            label="Laboratorium tujuan"
            required
            value={transferForm.destinationLaboratoryId}
            error={transferErrors.destinationLaboratoryId}
            placeholder={canViewLaboratories ? 'Pilih laboratorium aktif' : 'Izin laboratories.view diperlukan'}
            options={destinationOptions.map((laboratory) => ({ value: laboratory.id, label: `${laboratory.code} · ${laboratory.name}` }))}
            disabled={transferSubmitting || !canViewLaboratories}
            onChange={(event) => { setTransferForm({ ...transferForm, destinationLaboratoryId: event.target.value }); setTransferErrors({}); }}
          />
          {!canViewLaboratories && <p className="text-xs text-ink-muted">Daftar tujuan tidak tersedia karena Anda tidak memiliki izin melihat Laboratory.</p>}
          {canViewLaboratories && destinationOptions.length === 0 && <p className="text-xs text-ink-muted">Tidak ada laboratorium aktif lain yang tersedia sebagai tujuan.</p>}
          <Textarea
            label="Alasan (opsional)"
            name="transferReason"
            maxLength={500}
            value={transferForm.reason}
            error={transferErrors.reason}
            onChange={(event) => { setTransferForm({ ...transferForm, reason: event.target.value }); setTransferErrors({}); }}
          />
          {transferErrors.request && <p className="text-sm text-danger">{transferErrors.request}</p>}
        </div>
      </FormDialog>
    </>
  );
}
