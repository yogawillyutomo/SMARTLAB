import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Pencil, Plus, RefreshCw } from 'lucide-react';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import {
  ACADEMIC_MASTER_STATUSES,
  ACADEMIC_UNIT_TYPES,
  LESSON_PERIOD_KINDS,
  academicMasterGateway,
  type AcademicClassDto,
  type AcademicMasterStatus,
  type AcademicUnitDto,
  type AcademicUnitType,
  type AcademicYearDto,
  type LessonPeriodDto,
  type LessonPeriodKind,
  type LessonPeriodSetDto,
  type SemesterDto,
  type SubjectDto,
  type TeacherDto,
} from '@/services/academicMasterApi';

type CategoryKey =
  | 'academic-years'
  | 'semesters'
  | 'lesson-period-sets'
  | 'lesson-periods'
  | 'academic-units'
  | 'teachers'
  | 'classes'
  | 'subjects';

type AcademicRow =
  | AcademicYearDto
  | SemesterDto
  | LessonPeriodSetDto
  | LessonPeriodDto
  | AcademicUnitDto
  | TeacherDto
  | AcademicClassDto
  | SubjectDto;

interface CategoryConfig {
  key: CategoryKey;
  label: string;
  description: string;
}

interface FormState {
  code: string;
  name: string;
  status: AcademicMasterStatus;
  startsOn: string;
  endsOn: string;
  academicYearId: string;
  lessonPeriodSetId: string;
  sequence: string;
  startsAt: string;
  endsAt: string;
  kind: LessonPeriodKind;
  type: AcademicUnitType;
  parentId: string;
  personnelNumber: string;
  email: string;
  phone: string;
  membershipId: string;
  academicUnitId: string;
  gradeLevel: string;
  homeroomTeacherId: string;
  studentCount: string;
  groupName: string;
}

const CATEGORIES: CategoryConfig[] = [
  { key: 'academic-years', label: 'Tahun Ajaran', description: 'Periode akademik induk dengan kode stabil dan rentang tanggal historis.' },
  { key: 'semesters', label: 'Semester', description: 'Subperiode yang wajib berada di dalam Tahun Ajaran.' },
  { key: 'lesson-period-sets', label: 'Set Jam Pelajaran', description: 'Bell schedule per Tahun Ajaran, misalnya Normal, Jumat, atau Ramadan.' },
  { key: 'lesson-periods', label: 'Jam Pelajaran', description: 'Urutan slot instruksi/istirahat di dalam satu Set Jam Pelajaran.' },
  { key: 'academic-units', label: 'Unit Akademik', description: 'Struktur generik sekolah: program, konsentrasi, departemen, atau unit lain.' },
  { key: 'teachers', label: 'Guru', description: 'Master guru sekolah; terpisah dari akun login dan dapat ditautkan secara opsional.' },
  { key: 'classes', label: 'Rombel / Kelas', description: 'Rombongan belajar dengan tingkat, unit akademik, dan wali kelas.' },
  { key: 'subjects', label: 'Mata Pelajaran', description: 'Master mata pelajaran dengan kode stabil untuk jadwal dan integrasi.' },
];

const emptyForm = (): FormState => ({
  code: '',
  name: '',
  status: 'active',
  startsOn: '',
  endsOn: '',
  academicYearId: '',
  lessonPeriodSetId: '',
  sequence: '1',
  startsAt: '07:00:00',
  endsAt: '07:45:00',
  kind: 'instruction',
  type: 'program',
  parentId: '',
  personnelNumber: '',
  email: '',
  phone: '',
  membershipId: '',
  academicUnitId: '',
  gradeLevel: '10',
  homeroomTeacherId: '',
  studentCount: '0',
  groupName: '',
});

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

function issueMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 412) return 'Data sudah berubah di server. Muat ulang sebelum menyimpan perubahan lagi.';
    if (error.status === 428) return 'Versi data tidak valid. Muat ulang data lalu coba kembali.';
    if (error.code === 'UNAUTHENTICATED') return 'Sesi berakhir. Silakan masuk kembali.';
    if (error.code === 'FORBIDDEN') return 'Anda tidak memiliki izin untuk tindakan ini.';
    if (error.kind === 'network') return 'API SmartLab tidak dapat dijangkau.';
    if (error.errors) return Object.values(error.errors).flat()[0] ?? error.message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Master Data akademik tidak dapat diproses.';
}

function rowTitle(row: AcademicRow): string {
  if ('name' in row) return row.name;
  return `${row.sequence}. ${row.startsAt.slice(0, 5)}–${row.endsAt.slice(0, 5)}`;
}

function rowDetail(row: AcademicRow, references: ReferenceState): string {
  if ('startsOn' in row && 'endsOn' in row && !('academicYearId' in row)) return `${row.startsOn} — ${row.endsOn}`;
  if ('startsOn' in row && 'endsOn' in row && 'academicYearId' in row) {
    return `${references.years.find((item) => item.id === row.academicYearId)?.name ?? 'Tahun Ajaran'} · ${row.startsOn} — ${row.endsOn}`;
  }
  if ('lessonPeriodSetId' in row) {
    const set = references.periodSets.find((item) => item.id === row.lessonPeriodSetId);
    return `${set?.name ?? 'Set JP'} · ${row.kind === 'break' ? 'Istirahat' : 'Pembelajaran'}`;
  }
  if ('academicYearId' in row) return references.years.find((item) => item.id === row.academicYearId)?.name ?? 'Tahun Ajaran';
  if ('type' in row) {
    const parent = references.units.find((item) => item.id === row.parentId);
    return `${row.type}${parent ? ` · ${parent.name}` : ''}`;
  }
  if ('personnelNumber' in row) {
    const unit = references.units.find((item) => item.id === row.academicUnitId);
    return [row.personnelNumber, unit?.name].filter(Boolean).join(' · ') || 'Guru sekolah';
  }
  if ('gradeLevel' in row) {
    const unit = references.units.find((item) => item.id === row.academicUnitId);
    return `Tingkat ${row.gradeLevel}${unit ? ` · ${unit.name}` : ''} · ${row.studentCount} siswa`;
  }
  if ('groupName' in row) {
    const unit = references.units.find((item) => item.id === row.academicUnitId);
    return [row.groupName, unit?.name].filter(Boolean).join(' · ') || 'Mata pelajaran';
  }
  return 'Master Data akademik';
}

interface ReferenceState {
  years: AcademicYearDto[];
  units: AcademicUnitDto[];
  teachers: TeacherDto[];
  periodSets: LessonPeriodSetDto[];
}

const EMPTY_REFERENCES: ReferenceState = { years: [], units: [], teachers: [], periodSets: [] };

export function MasterDataPage() {
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'master-data.create');
  const canUpdate = hasServerPermission(user, 'master-data.update');

  const [category, setCategory] = useState<CategoryKey>('academic-years');
  const [rows, setRows] = useState<AcademicRow[]>([]);
  const [references, setReferences] = useState<ReferenceState>(EMPTY_REFERENCES);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AcademicRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const active = CATEGORIES.find((item) => item.key === category) ?? CATEGORIES[0];

  const loadReferences = useCallback(async () => {
    const [years, units, teachers, periodSets] = await Promise.all([
      academicMasterGateway.academicYears.list({ perPage: 100 }),
      academicMasterGateway.academicUnits.list({ perPage: 100 }),
      academicMasterGateway.teachers.list({ perPage: 100 }),
      academicMasterGateway.lessonPeriodSets.list({ perPage: 100 }),
    ]);
    setReferences({ years: years.data, units: units.data, teachers: teachers.data, periodSets: periodSets.data });
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setIssue(null);
    try {
      const filters = { ...(search ? { search } : {}), page: 1, perPage: 100 };
      let result: { data: AcademicRow[]; meta: { total: number } };
      switch (category) {
        case 'academic-years': result = await academicMasterGateway.academicYears.list(filters); break;
        case 'semesters': result = await academicMasterGateway.semesters.list(filters); break;
        case 'lesson-period-sets': result = await academicMasterGateway.lessonPeriodSets.list(filters); break;
        case 'lesson-periods': result = await academicMasterGateway.lessonPeriods.list(filters); break;
        case 'academic-units': result = await academicMasterGateway.academicUnits.list(filters); break;
        case 'teachers': result = await academicMasterGateway.teachers.list(filters); break;
        case 'classes': result = await academicMasterGateway.classes.list(filters); break;
        case 'subjects': result = await academicMasterGateway.subjects.list(filters); break;
      }
      setRows(result.data);
      setTotal(result.meta.total);
      await loadReferences();
    } catch (error) {
      setIssue(issueMessage(error));
    } finally {
      setLoading(false);
    }
  }, [category, loadReferences, search]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  function selectCategory(next: CategoryKey) {
    setCategory(next);
    setSearch('');
    setSearchDraft('');
    setRows([]);
    setFormOpen(false);
    setEditing(null);
  }

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(row: AcademicRow) {
    if (!canUpdate) return;
    setEditing(row);
    const next = emptyForm();
    next.code = row.code;
    next.status = row.status;
    if ('name' in row) next.name = row.name;
    if ('startsOn' in row) next.startsOn = row.startsOn;
    if ('endsOn' in row) next.endsOn = row.endsOn;
    if ('academicYearId' in row) next.academicYearId = row.academicYearId;
    if ('lessonPeriodSetId' in row) next.lessonPeriodSetId = row.lessonPeriodSetId;
    if ('sequence' in row) next.sequence = String(row.sequence);
    if ('startsAt' in row) next.startsAt = row.startsAt;
    if ('endsAt' in row) next.endsAt = row.endsAt;
    if ('kind' in row) next.kind = row.kind;
    if ('type' in row) next.type = row.type;
    if ('parentId' in row) next.parentId = row.parentId ?? '';
    if ('personnelNumber' in row) next.personnelNumber = row.personnelNumber ?? '';
    if ('email' in row) next.email = row.email ?? '';
    if ('phone' in row) next.phone = row.phone ?? '';
    if ('membershipId' in row) next.membershipId = row.membershipId ?? '';
    if ('academicUnitId' in row) next.academicUnitId = row.academicUnitId ?? '';
    if ('gradeLevel' in row) next.gradeLevel = String(row.gradeLevel);
    if ('homeroomTeacherId' in row) next.homeroomTeacherId = row.homeroomTeacherId ?? '';
    if ('studentCount' in row) next.studentCount = String(row.studentCount);
    if ('groupName' in row) next.groupName = row.groupName ?? '';
    setForm(next);
    setFormOpen(true);
  }

  async function save() {
    if (saving || (editing ? !canUpdate : !canCreate)) return;
    if (!editing && !form.code.trim()) {
      toast('Kode stabil wajib diisi.', 'error');
      return;
    }
    if (category !== 'lesson-periods' && !form.name.trim()) {
      toast('Nama wajib diisi.', 'error');
      return;
    }

    setSaving(true);
    try {
      const version = editing?.version ?? 0;
      switch (category) {
        case 'academic-years':
          if (editing) await academicMasterGateway.academicYears.update(editing.id, version, { name: form.name.trim(), startsOn: form.startsOn, endsOn: form.endsOn, status: form.status });
          else await academicMasterGateway.academicYears.create({ code: form.code.trim(), name: form.name.trim(), startsOn: form.startsOn, endsOn: form.endsOn, status: form.status });
          break;
        case 'semesters':
          if (editing) await academicMasterGateway.semesters.update(editing.id, version, { name: form.name.trim(), startsOn: form.startsOn, endsOn: form.endsOn, status: form.status });
          else await academicMasterGateway.semesters.create({ academicYearId: form.academicYearId, code: form.code.trim(), name: form.name.trim(), startsOn: form.startsOn, endsOn: form.endsOn, status: form.status });
          break;
        case 'lesson-period-sets':
          if (editing) await academicMasterGateway.lessonPeriodSets.update(editing.id, version, { name: form.name.trim(), status: form.status });
          else await academicMasterGateway.lessonPeriodSets.create({ academicYearId: form.academicYearId, code: form.code.trim(), name: form.name.trim(), status: form.status });
          break;
        case 'lesson-periods': {
          const sequence = Number(form.sequence);
          if (editing) await academicMasterGateway.lessonPeriods.update(editing.id, version, { sequence, startsAt: form.startsAt, endsAt: form.endsAt, kind: form.kind, status: form.status });
          else await academicMasterGateway.lessonPeriods.create({ lessonPeriodSetId: form.lessonPeriodSetId, code: form.code.trim(), sequence, startsAt: form.startsAt, endsAt: form.endsAt, kind: form.kind, status: form.status });
          break;
        }
        case 'academic-units':
          if (editing) await academicMasterGateway.academicUnits.update(editing.id, version, { name: form.name.trim(), type: form.type, parentId: nullable(form.parentId), status: form.status });
          else await academicMasterGateway.academicUnits.create({ code: form.code.trim(), name: form.name.trim(), type: form.type, parentId: nullable(form.parentId), status: form.status });
          break;
        case 'teachers':
          if (editing) await academicMasterGateway.teachers.update(editing.id, version, { personnelNumber: nullable(form.personnelNumber), name: form.name.trim(), email: nullable(form.email), phone: nullable(form.phone), academicUnitId: nullable(form.academicUnitId), membershipId: nullable(form.membershipId), status: form.status });
          else await academicMasterGateway.teachers.create({ code: form.code.trim(), personnelNumber: nullable(form.personnelNumber), name: form.name.trim(), email: nullable(form.email), phone: nullable(form.phone), academicUnitId: nullable(form.academicUnitId), membershipId: nullable(form.membershipId), status: form.status });
          break;
        case 'classes': {
          const gradeLevel = Number(form.gradeLevel);
          const studentCount = Number(form.studentCount);
          if (editing) await academicMasterGateway.classes.update(editing.id, version, { name: form.name.trim(), gradeLevel, academicUnitId: nullable(form.academicUnitId), homeroomTeacherId: nullable(form.homeroomTeacherId), studentCount, status: form.status });
          else await academicMasterGateway.classes.create({ code: form.code.trim(), name: form.name.trim(), gradeLevel, academicUnitId: nullable(form.academicUnitId), homeroomTeacherId: nullable(form.homeroomTeacherId), studentCount, status: form.status });
          break;
        }
        case 'subjects':
          if (editing) await academicMasterGateway.subjects.update(editing.id, version, { name: form.name.trim(), groupName: nullable(form.groupName), academicUnitId: nullable(form.academicUnitId), status: form.status });
          else await academicMasterGateway.subjects.create({ code: form.code.trim(), name: form.name.trim(), groupName: nullable(form.groupName), academicUnitId: nullable(form.academicUnitId), status: form.status });
          break;
      }
      toast(editing ? 'Master Data diperbarui dari server.' : 'Master Data dibuat di server.', 'success');
      setFormOpen(false);
      setEditing(null);
      await loadRows();
    } catch (error) {
      toast(issueMessage(error), 'error');
      if (error instanceof ApiClientError && error.status === 412) await loadRows();
    } finally {
      setSaving(false);
    }
  }

  const columns = useMemo<Column<AcademicRow>[]>(() => [
    {
      key: 'name',
      header: 'Nama / Slot',
      sortable: true,
      sortValue: (row) => rowTitle(row).toLocaleLowerCase('id-ID'),
      render: (row) => (
        <div>
          <p className="font-medium text-ink-primary">{rowTitle(row)}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{rowDetail(row, references)}</p>
        </div>
      ),
    },
    { key: 'code', header: 'Kode Stabil', render: (row) => <span className="font-mono text-xs text-ink-secondary">{row.code}</span> },
    { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status === 'active' ? 'success' : 'muted'}>{row.status === 'active' ? 'Aktif' : 'Nonaktif'}</Badge> },
    { key: 'version', header: 'Versi', render: (row) => <span className="font-mono text-xs text-ink-muted">v{row.version}</span> },
    {
      key: 'actions',
      header: 'Aksi',
      className: 'w-20 text-right',
      printHidden: true,
      render: (row) => canUpdate ? (
        <div className="flex justify-end">
          <button type="button" onClick={() => openEdit(row)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-base-700 hover:text-ink-primary" aria-label={`Edit ${rowTitle(row)}`}>
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      ) : null,
    },
  ], [canUpdate, references]);

  const yearOptions = references.years.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));
  const unitOptions = [{ value: '', label: '— Tidak ditautkan —' }, ...references.units.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))];
  const teacherOptions = [{ value: '', label: '— Tidak ditautkan —' }, ...references.teachers.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }))];
  const setOptions = references.periodSets.map((item) => ({ value: item.id, label: `${item.code} · ${item.name}` }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data"
        description="Master akademik canonical dari Laravel + PostgreSQL. Data browser-local tidak lagi menjadi sumber kebenaran halaman ini."
        icon={<Database className="h-5 w-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void loadRows()} disabled={loading}>Muat ulang</Button>
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah</Button>}
          </div>
        }
      />

      <Card className="border-info/30 bg-info/5">
        <CardContent>
          <p className="text-sm font-semibold text-ink-primary">Server-authoritative · stable IDs</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Kode bisnis dibuat sekali dan tidak dapat diubah lewat PATCH. Tidak ada hard delete; data dinonaktifkan agar referensi jadwal dan histori tetap utuh. Master non-akademik lama yang belum memiliki API canonical tidak ditampilkan sebagai data operasional.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CATEGORIES.map((item) => (
          <button key={item.key} type="button" onClick={() => selectCategory(item.key)} className={`rounded-xl border p-4 text-left transition-colors ${category === item.key ? 'border-accent-content bg-accent-primary/10' : 'border-base-700 bg-base-800/50 hover:bg-base-700/40'}`}>
            <p className="text-sm font-semibold text-ink-primary">{item.label}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">{item.description}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardContent>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-ink-primary">{active.label}</h2>
                <Badge tone="neutral">{total} data</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{active.description}</p>
            </div>
            <form className="flex w-full max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
              <Input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Cari ${active.label.toLocaleLowerCase('id-ID')}...`} aria-label={`Cari ${active.label}`} />
              <Button type="submit" variant="secondary">Cari</Button>
            </form>
          </div>

          {loading && rows.length === 0 ? (
            <LoadingState label={`Memuat ${active.label.toLocaleLowerCase('id-ID')}...`} />
          ) : issue ? (
            <ErrorState message={issue} onRetry={() => void loadRows()} />
          ) : rows.length === 0 ? (
            <EmptyState title="Belum ada data" description={`Belum ada ${active.label.toLocaleLowerCase('id-ID')} pada PostgreSQL sekolah aktif.`} action={canCreate ? <Button size="sm" onClick={openCreate}>Tambah {active.label}</Button> : undefined} />
          ) : (
            <DataTable columns={columns} data={rows} rowKey={(row) => row.id} pageSize={25} compact initialSort={{ key: 'name', dir: 'asc' }} />
          )}
        </CardContent>
      </Card>

      <FormDialog open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} title={`${editing ? 'Edit' : 'Tambah'} ${active.label}`} onSubmit={() => { void save(); }} loading={saving} size="md">
        {!editing && <Input label="Kode stabil" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} required />}
        {editing && <div className="rounded-lg border border-base-700 bg-base-800/60 px-3 py-2 text-xs text-ink-muted">Kode stabil: <span className="font-mono text-ink-primary">{editing.code}</span></div>}

        {category !== 'lesson-periods' && <Input label="Nama" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required className="mt-4" />}

        {(category === 'academic-years' || category === 'semesters') && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Input type="date" label="Mulai" value={form.startsOn} onChange={(event) => setForm((current) => ({ ...current, startsOn: event.target.value }))} required />
            <Input type="date" label="Selesai" value={form.endsOn} onChange={(event) => setForm((current) => ({ ...current, endsOn: event.target.value }))} required />
          </div>
        )}

        {category === 'semesters' && !editing && <Select label="Tahun Ajaran" value={form.academicYearId} onChange={(event) => setForm((current) => ({ ...current, academicYearId: event.target.value }))} options={[{ value: '', label: 'Pilih Tahun Ajaran' }, ...yearOptions]} className="mt-4" />}
        {category === 'lesson-period-sets' && !editing && <Select label="Tahun Ajaran" value={form.academicYearId} onChange={(event) => setForm((current) => ({ ...current, academicYearId: event.target.value }))} options={[{ value: '', label: 'Pilih Tahun Ajaran' }, ...yearOptions]} className="mt-4" />}

        {category === 'lesson-periods' && (
          <>
            {!editing && <Select label="Set Jam Pelajaran" value={form.lessonPeriodSetId} onChange={(event) => setForm((current) => ({ ...current, lessonPeriodSetId: event.target.value }))} options={[{ value: '', label: 'Pilih Set Jam Pelajaran' }, ...setOptions]} className="mt-4" />}
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Input type="number" min="1" label="Urutan" value={form.sequence} onChange={(event) => setForm((current) => ({ ...current, sequence: event.target.value }))} required />
              <Input type="time" step="1" label="Mulai" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} required />
              <Input type="time" step="1" label="Selesai" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} required />
            </div>
            <Select label="Jenis" value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as LessonPeriodKind }))} options={LESSON_PERIOD_KINDS.map((value) => ({ value, label: value === 'instruction' ? 'Pembelajaran' : 'Istirahat' }))} className="mt-4" />
          </>
        )}

        {category === 'academic-units' && (
          <>
            <Select label="Tipe" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as AcademicUnitType }))} options={ACADEMIC_UNIT_TYPES.map((value) => ({ value, label: value }))} className="mt-4" />
            <Select label="Parent (opsional)" value={form.parentId} onChange={(event) => setForm((current) => ({ ...current, parentId: event.target.value }))} options={unitOptions.filter((item) => !editing || item.value !== editing.id)} className="mt-4" />
          </>
        )}

        {category === 'teachers' && (
          <>
            <Input label="Nomor personel / NIP (opsional)" value={form.personnelNumber} onChange={(event) => setForm((current) => ({ ...current, personnelNumber: event.target.value }))} className="mt-4" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input type="email" label="Email (opsional)" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              <Input label="Telepon (opsional)" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <Select label="Unit Akademik" value={form.academicUnitId} onChange={(event) => setForm((current) => ({ ...current, academicUnitId: event.target.value }))} options={unitOptions} className="mt-4" />
            <Input label="Membership ID akun (opsional)" value={form.membershipId} onChange={(event) => setForm((current) => ({ ...current, membershipId: event.target.value }))} className="mt-4" />
          </>
        )}

        {category === 'classes' && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Input type="number" min="1" label="Tingkat" value={form.gradeLevel} onChange={(event) => setForm((current) => ({ ...current, gradeLevel: event.target.value }))} required />
              <Input type="number" min="0" label="Jumlah siswa" value={form.studentCount} onChange={(event) => setForm((current) => ({ ...current, studentCount: event.target.value }))} required />
            </div>
            <Select label="Unit Akademik" value={form.academicUnitId} onChange={(event) => setForm((current) => ({ ...current, academicUnitId: event.target.value }))} options={unitOptions} className="mt-4" />
            <Select label="Wali Kelas" value={form.homeroomTeacherId} onChange={(event) => setForm((current) => ({ ...current, homeroomTeacherId: event.target.value }))} options={teacherOptions} className="mt-4" />
          </>
        )}

        {category === 'subjects' && (
          <>
            <Input label="Kelompok mapel (opsional)" value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} className="mt-4" />
            <Select label="Unit Akademik" value={form.academicUnitId} onChange={(event) => setForm((current) => ({ ...current, academicUnitId: event.target.value }))} options={unitOptions} className="mt-4" />
          </>
        )}

        <Select label="Status" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AcademicMasterStatus }))} options={ACADEMIC_MASTER_STATUSES.map((value) => ({ value, label: value === 'active' ? 'Aktif' : 'Nonaktif' }))} className="mt-4" />
      </FormDialog>
    </div>
  );
}
