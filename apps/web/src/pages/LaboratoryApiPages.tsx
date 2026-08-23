import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, FlaskConical, Laptop, Pencil, Plus, Power, ServerOff, Users } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/Badge';
import { hasServerPermission } from '@/lib/authIdentity';
import {
  SubmissionGate,
  changedLaboratoryFields,
  emptyLaboratoryForm,
  laboratoryFormFromDto,
  laboratoryPresentationIssue,
  sortLaboratories,
  validateLaboratoryForm,
  type LaboratoryFormErrors,
  type LaboratoryFormValues,
  type LaboratoryPresentationIssue,
} from '@/lib/laboratoryPresentation';
import { laboratoryGateway, type CreateLaboratoryInput, type LaboratoryDto } from '@/services/laboratoryApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

export type LaboratoryListState =
  | { status: 'loading' }
  | { status: 'error'; issue: LaboratoryPresentationIssue }
  | { status: 'ready'; laboratories: LaboratoryDto[] };

export type LaboratoryDetailState =
  | { status: 'loading' }
  | { status: 'error'; issue: LaboratoryPresentationIssue }
  | { status: 'not_found' }
  | { status: 'ready'; laboratory: LaboratoryDto };

interface LaboratoryListViewProps {
  state: LaboratoryListState;
  canCreate: boolean;
  canUpdate: boolean;
  canViewDevices: boolean;
  statusUpdatingId: string | null;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (laboratory: LaboratoryDto) => void;
  onToggleStatus: (laboratory: LaboratoryDto) => void;
  onDetail: (laboratory: LaboratoryDto) => void;
  onDevices: (laboratory: LaboratoryDto) => void;
}

export function LaboratoryListView({
  state,
  canCreate,
  canUpdate,
  canViewDevices,
  statusUpdatingId,
  onRetry,
  onCreate,
  onEdit,
  onToggleStatus,
  onDetail,
  onDevices,
}: LaboratoryListViewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Laboratorium"
        description="Kelola data canonical laboratorium untuk sekolah aktif"
        icon={<FlaskConical className="h-5 w-5" />}
        actions={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Tambah Lab</Button> : undefined}
      />

      {state.status === 'loading' && <Card><LoadingState label="Memuat laboratorium dari server..." /></Card>}
      {state.status === 'error' && (
        <Card>
          <ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} />
        </Card>
      )}
      {state.status === 'ready' && state.laboratories.length === 0 && (
        <Card>
          <EmptyState
            icon={<FlaskConical className="h-7 w-7" />}
            title="Belum ada laboratorium"
            description="Belum ada data Laboratory pada konteks sekolah aktif."
            action={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>Tambah Lab</Button> : undefined}
          />
        </Card>
      )}
      {state.status === 'ready' && state.laboratories.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.laboratories.map((laboratory) => (
            <Card key={laboratory.id} hover>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-content">
                      <FlaskConical className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-primary">{laboratory.name}</p>
                      <p className="truncate text-xs text-ink-muted">{laboratory.code}</p>
                    </div>
                  </div>
                  <StatusBadge status={laboratory.status} />
                </div>

                <dl className="space-y-2 rounded-lg bg-base-700/30 p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-ink-muted">Lokasi</dt>
                    <dd className="text-right text-ink-secondary">{laboratory.location}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-1.5 text-ink-muted"><Users className="h-3.5 w-3.5" />Kapasitas</dt>
                    <dd className="text-ink-secondary">{laboratory.capacity} orang</dd>
                  </div>
                </dl>

                <p className="rounded-lg border border-base-700 bg-base-900/30 px-3 py-2 text-xs text-ink-muted">
                  Denah dan domain lokal tetap terpisah. Inventaris Device canonical tersedia melalui filter laboratorium asal.
                </p>

                <div className="flex flex-wrap gap-2 border-t border-base-700/60 pt-3">
                  <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} className="flex-1" onClick={() => onDetail(laboratory)}>
                    Detail
                  </Button>
                  {canViewDevices && (
                    <Button variant="secondary" size="sm" icon={<Laptop className="h-3.5 w-3.5" />} onClick={() => onDevices(laboratory)}>
                      Perangkat
                    </Button>
                  )}
                  {canUpdate && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        aria-label={`Edit Laboratorium ${laboratory.name}`}
                        title="Edit Laboratorium"
                        onClick={() => onEdit(laboratory)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={statusUpdatingId === laboratory.id}
                        disabled={statusUpdatingId !== null}
                        icon={<Power className="h-3.5 w-3.5" />}
                        aria-label={`${laboratory.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} Laboratorium ${laboratory.name}`}
                        title={`${laboratory.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} Laboratorium`}
                        onClick={() => onToggleStatus(laboratory)}
                      />
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface LaboratoryFormFieldsProps {
  values: LaboratoryFormValues;
  errors: LaboratoryFormErrors;
  disabled?: boolean;
  onChange: (next: LaboratoryFormValues) => void;
}

export function LaboratoryFormFields({ values, errors, disabled, onChange }: LaboratoryFormFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {errors.request && <p className="sm:col-span-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errors.request}</p>}
      <Input label="Kode" name="code" value={values.code} error={errors.code} maxLength={50} disabled={disabled} onChange={(event) => onChange({ ...values, code: event.target.value })} required />
      <Input label="Nama Laboratorium" name="name" value={values.name} error={errors.name} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, name: event.target.value })} required />
      <Input label="Lokasi" name="location" value={values.location} error={errors.location} maxLength={255} disabled={disabled} onChange={(event) => onChange({ ...values, location: event.target.value })} required />
      <Input label="Kapasitas (orang)" name="capacity" type="number" min={1} step={1} value={values.capacity} error={errors.capacity} disabled={disabled} onChange={(event) => onChange({ ...values, capacity: event.target.value })} required />
      <Select
        label="Status"
        name="status"
        value={values.status}
        error={errors.status}
        disabled={disabled}
        onChange={(event) => onChange({ ...values, status: event.target.value as LaboratoryFormValues['status'] })}
        options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]}
      />
      <p className="self-end text-xs text-ink-muted">Kepemilikan sekolah ditentukan oleh sesi aktif dan tidak dikirim dari form.</p>
    </div>
  );
}

export function LaboratoriesPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const canCreate = hasServerPermission(user, 'laboratories.create');
  const canUpdate = hasServerPermission(user, 'laboratories.update');
  const canViewDevices = hasServerPermission(user, 'devices.view');
  const [state, setState] = useState<LaboratoryListState>({ status: 'loading' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LaboratoryDto | null>(null);
  const [form, setForm] = useState<LaboratoryFormValues>(emptyLaboratoryForm);
  const [formErrors, setFormErrors] = useState<LaboratoryFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const submissionGate = useRef(new SubmissionGate());
  const statusGate = useRef(new SubmissionGate());

  const recoverAuthBoundary = useCallback(async () => {
    await bootstrapSession({ force: true });
  }, [bootstrapSession]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setState({ status: 'loading' });
    try {
      const laboratories = sortLaboratories(await laboratoryGateway.list());
      if (sequence === loadSequence.current) setState({ status: 'ready', laboratories });
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const issue = laboratoryPresentationIssue(error);
      if (issue.authBoundary) {
        await recoverAuthBoundary();
        return;
      }
      setState({ status: 'error', issue });
    }
  }, [recoverAuthBoundary]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(emptyLaboratoryForm());
    setFormErrors({});
    setDialogOpen(true);
  }

  function openEdit(laboratory: LaboratoryDto) {
    setEditing(laboratory);
    setForm(laboratoryFormFromDto(laboratory));
    setFormErrors({});
    setDialogOpen(true);
  }

  function closeDialog() {
    if (submitting) return;
    setDialogOpen(false);
  }

  function mergeLaboratory(laboratory: LaboratoryDto) {
    setState((current) => current.status === 'ready'
      ? { status: 'ready', laboratories: sortLaboratories([...current.laboratories.filter(({ id }) => id !== laboratory.id), laboratory]) }
      : current);
  }

  async function saveLaboratory() {
    if (!submissionGate.current.begin()) return;
    const validated = validateLaboratoryForm(form);
    if (!validated.ok) {
      setFormErrors(validated.errors);
      submissionGate.current.end();
      return;
    }

    let updateInput: CreateLaboratoryInput | ReturnType<typeof changedLaboratoryFields> = validated.input;
    if (editing) {
      updateInput = changedLaboratoryFields(editing, validated.input);
      if (Object.keys(updateInput).length === 0) {
        setFormErrors({ request: 'Tidak ada perubahan yang perlu disimpan.' });
        submissionGate.current.end();
        return;
      }
    }

    setSubmitting(true);
    setFormErrors({});
    try {
      const saved = editing
        ? await laboratoryGateway.update(editing.id, updateInput)
        : await laboratoryGateway.create(validated.input);
      mergeLaboratory(saved);
      setDialogOpen(false);
      toast(editing ? 'Laboratorium diperbarui' : 'Laboratorium ditambahkan', 'success');
    } catch (error) {
      const issue = laboratoryPresentationIssue(error);
      if (issue.authBoundary) await recoverAuthBoundary();
      else setFormErrors({ ...issue.fieldErrors, request: issue.fieldErrors.request ?? issue.message });
    } finally {
      setSubmitting(false);
      submissionGate.current.end();
    }
  }

  async function toggleStatus(laboratory: LaboratoryDto) {
    if (!statusGate.current.begin()) return;
    setStatusUpdatingId(laboratory.id);
    const status = laboratory.status === 'active' ? 'inactive' : 'active';
    try {
      const saved = await laboratoryGateway.update(laboratory.id, { status });
      mergeLaboratory(saved);
      toast(`Laboratorium ${status === 'active' ? 'diaktifkan' : 'dinonaktifkan'}`, 'success');
    } catch (error) {
      const issue = laboratoryPresentationIssue(error);
      if (issue.authBoundary) await recoverAuthBoundary();
      else toast(issue.message, 'error');
    } finally {
      setStatusUpdatingId(null);
      statusGate.current.end();
    }
  }

  return (
    <>
      <LaboratoryListView
        state={state}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canViewDevices={canViewDevices}
        statusUpdatingId={statusUpdatingId}
        onRetry={() => void load()}
        onCreate={openCreate}
        onEdit={openEdit}
        onToggleStatus={(laboratory) => void toggleStatus(laboratory)}
        onDetail={(laboratory) => navigate(`/laboratories/${encodeURIComponent(laboratory.id)}`)}
        onDevices={(laboratory) => navigate(`/devices?homeLaboratoryId=${encodeURIComponent(laboratory.id)}`)}
      />
      <FormDialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? 'Edit Laboratorium' : 'Tambah Laboratorium'}
        description="Hanya field canonical Laboratory yang akan dikirim ke server."
        onSubmit={() => void saveLaboratory()}
        submitLabel={editing ? 'Perbarui' : 'Simpan'}
        loading={submitting}
        submitDisabled={submitting}
        size="lg"
      >
        <LaboratoryFormFields values={form} errors={formErrors} disabled={submitting} onChange={(next) => { setForm(next); setFormErrors({}); }} />
      </FormDialog>
    </>
  );
}

interface LaboratoryDetailViewProps {
  state: LaboratoryDetailState;
  canViewDevices: boolean;
  canViewLayouts: boolean;
  onRetry: () => void;
  onBack: () => void;
  onDevices: (laboratory: LaboratoryDto) => void;
  onLayout: (laboratory: LaboratoryDto) => void;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function LaboratoryDetailView({ state, canViewDevices, canViewLayouts, onRetry, onBack, onDevices, onLayout }: LaboratoryDetailViewProps) {
  if (state.status === 'loading') return <Card><LoadingState label="Memuat detail laboratorium..." /></Card>;
  if (state.status === 'not_found') {
    return <EmptyState title="Laboratorium tidak ditemukan" description="Data tidak tersedia pada konteks sekolah aktif." action={<Button onClick={onBack}>Kembali</Button>} />;
  }
  if (state.status === 'error') {
    return <Card><ErrorState message={state.issue.message} onRetry={state.issue.retryable ? onRetry : undefined} /></Card>;
  }

  const laboratory = state.laboratory;
  return (
    <div className="space-y-6">
      <PageHeader
        title={laboratory.name}
        description={`${laboratory.code} · ${laboratory.location}`}
        icon={<FlaskConical className="h-5 w-5" />}
        actions={<Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack}>Kembali</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><CardContent><p className="text-xs text-ink-muted">Kode</p><p className="mt-1 font-semibold text-ink-primary">{laboratory.code}</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-ink-muted">Kapasitas</p><p className="mt-1 font-semibold text-ink-primary">{laboratory.capacity} orang</p></CardContent></Card>
        <Card><CardContent><p className="text-xs text-ink-muted">Status</p><div className="mt-1"><StatusBadge status={laboratory.status} /></div></CardContent></Card>
      </div>

      <Card>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-ink-muted">ID Laboratory</dt><dd className="mt-1 break-all text-ink-primary">{laboratory.id}</dd></div>
            <div><dt className="text-xs text-ink-muted">ID Sekolah</dt><dd className="mt-1 break-all text-ink-primary">{laboratory.schoolId}</dd></div>
            <div><dt className="text-xs text-ink-muted">Lokasi</dt><dd className="mt-1 text-ink-primary">{laboratory.location}</dd></div>
            <div><dt className="text-xs text-ink-muted">Dibuat</dt><dd className="mt-1 text-ink-primary">{formatDateTime(laboratory.createdAt)}</dd></div>
            <div><dt className="text-xs text-ink-muted">Diperbarui</dt><dd className="mt-1 text-ink-primary">{formatDateTime(laboratory.updatedAt)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <EmptyState
          icon={<ServerOff className="h-7 w-7" />}
          title="Domain legacy tetap terpisah"
          description="Denah dan Device canonical tersedia dari server. Aset, jadwal, jurnal, maintenance, dan aktivitas lokal lama tidak digabungkan berdasarkan ID Laboratory API."
          action={(canViewLayouts || canViewDevices) ? <div className="flex flex-wrap justify-center gap-2">{canViewLayouts && <Button size="sm" onClick={() => onLayout(laboratory)}>Buka Denah</Button>}{canViewDevices && <Button variant="secondary" size="sm" onClick={() => onDevices(laboratory)}>Lihat Perangkat</Button>}</div> : undefined}
        />
      </Card>
    </div>
  );
}

export function LaboratoryDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const canViewDevices = hasServerPermission(user, 'devices.view');
  const canViewLayouts = hasServerPermission(user, 'layouts.view');
  const [state, setState] = useState<LaboratoryDetailState>({ status: 'loading' });
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setState({ status: 'not_found' });
      return;
    }
    const sequence = ++loadSequence.current;
    setState({ status: 'loading' });
    try {
      const laboratory = await laboratoryGateway.show(id);
      if (sequence === loadSequence.current) setState({ status: 'ready', laboratory });
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const issue = laboratoryPresentationIssue(error);
      if (issue.authBoundary) {
        await bootstrapSession({ force: true });
        return;
      }
      setState(issue.notFound ? { status: 'not_found' } : { status: 'error', issue });
    }
  }, [bootstrapSession, id]);

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);

  return (
    <LaboratoryDetailView
      state={state}
      canViewDevices={canViewDevices}
      canViewLayouts={canViewLayouts}
      onRetry={() => void load()}
      onBack={() => navigate('/laboratories')}
      onDevices={(laboratory) => navigate(`/devices?homeLaboratoryId=${encodeURIComponent(laboratory.id)}`)}
      onLayout={(laboratory) => navigate(`/laboratories/${encodeURIComponent(laboratory.id)}/layout`)}
    />
  );
}
