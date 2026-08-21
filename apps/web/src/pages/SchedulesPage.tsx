import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Plus, Download, Printer, Copy, Pencil, Trash2 } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useUIStore } from '@/stores/uiStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV, cn } from '@/utils';
import {
  defaultRegularScheduleWeekday,
  REGULAR_SCHEDULE_WEEKDAYS,
  schedulesForWeekday,
  type RegularScheduleWeekday,
} from '@/lib/scheduleView';
import type { Schedule } from '@/types';

const DAYS = REGULAR_SCHEDULE_WEEKDAYS;

export function SchedulesPage() {
  const { db, mutate } = useAppData();
  const navigate = useNavigate();
  const { semester } = useUIStore();
  const canCreate = usePermission('schedules', 'create');
  const canUpdate = usePermission('schedules', 'update');
  const canDelete = usePermission('schedules', 'delete');
  const canExport = usePermission('schedules', 'export');
  const canViewBookings = usePermission('bookings', 'view');
  const [view, setView] = useState<'week' | 'day' | 'list'>('week');
  const [selectedDay, setSelectedDay] = useState<RegularScheduleWeekday>(defaultRegularScheduleWeekday);
  const [filters, setFilters] = useState({ lab: 'all', className: 'all', teacher: 'all', subject: 'all' });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [confirmDel, setConfirmDel] = useState<Schedule | null>(null);
  const [form, setForm] = useState<Partial<Schedule>>({});

  const filtered = useMemo(() => {
    return db.schedules.filter((s) => {
      if (filters.lab !== 'all' && s.laboratoryId !== filters.lab) return false;
      if (filters.className !== 'all' && s.className !== filters.className) return false;
      if (filters.teacher !== 'all' && s.teacherName !== filters.teacher) return false;
      if (filters.subject !== 'all' && s.subject !== filters.subject) return false;
      return true;
    });
  }, [db.schedules, filters]);

  const classes = [...new Set(db.schedules.map((s) => s.className))];
  const teachers = [...new Set(db.schedules.map((s) => s.teacherName))];
  const subjects = [...new Set(db.schedules.map((s) => s.subject))];
  const selectedDaySchedules = useMemo(() => schedulesForWeekday(filtered, selectedDay), [filtered, selectedDay]);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ day: 'Senin', startTime: '07:00', endTime: '09:30', lessonHours: 3, laboratoryId: db.labs[0]?.id, activityType: 'Praktikum', status: 'Tetap', semester });
    setOpen(true);
  }
  function openEdit(s: Schedule) {
    if (!canUpdate) return;
    setEditing(s);
    setForm(s);
    setOpen(true);
  }

  function detectConflict(input: Partial<Schedule>, excludeId?: string): string[] {
    const conflicts: string[] = [];
    db.schedules.forEach((s) => {
      if (s.id === excludeId) return;
      if (s.day !== input.day) return;
      if (s.startTime < input.endTime! && s.endTime > input.startTime!) {
        if (s.laboratoryId === input.laboratoryId) conflicts.push(`Bentrok lab dengan ${s.className} (${s.startTime}-${s.endTime})`);
        if (s.teacherName === input.teacherName) conflicts.push(`Guru ${s.teacherName} sudah mengajar ${s.className}`);
        if (s.className === input.className) conflicts.push(`Kelas ${s.className} sudah di jadwal lain`);
      }
    });
    return conflicts;
  }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.laboratoryId || !form.className || !form.teacherName || !form.subject) {
      toast('Lengkapi semua field wajib', 'error');
      return;
    }
    const conflicts = detectConflict(form, editing?.id);
    if (conflicts.length > 0) {
      toast(`Konflik terdeteksi: ${conflicts[0]}`, 'error');
      return;
    }
    const result = mutate((d) => {
      if (editing) {
        const idx = d.schedules.findIndex((s) => s.id === editing.id);
        if (idx >= 0) d.schedules[idx] = { ...d.schedules[idx], ...form } as Schedule;
      } else {
        d.schedules.push({ ...form, id: `sch-${Date.now()}`, date: form.date ?? new Date().toISOString().split('T')[0] } as Schedule);
      }
    });
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast(editing ? 'Jadwal diperbarui' : 'Jadwal ditambahkan', 'success');
    setOpen(false);
  }

  function duplicate(s: Schedule) {
    if (!canCreate) return;
    const result = mutate((d) => {
      d.schedules.push({ ...s, id: `sch-${Date.now()}`, day: s.day, status: 'Pengganti' });
    });
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast('Jadwal diduplikasi', 'success');
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    const result = mutate((d) => {
      d.schedules = d.schedules.filter((s) => s.id !== confirmDel.id);
    });
    if (!result.ok) {
      toast(result.error, 'error');
      return;
    }
    toast('Jadwal dihapus', 'success');
    setConfirmDel(null);
  }

  function scheduleCard(schedule: Schedule) {
    const content = (
      <>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <span className="whitespace-nowrap text-xs font-semibold text-ink-primary">{schedule.startTime} - {schedule.endTime}</span>
          <StatusBadge status={schedule.status} />
        </div>
        <p className="mt-1 break-words text-xs text-ink-secondary">{schedule.subject}</p>
        <p className="mt-0.5 break-words text-[10px] text-ink-muted">{schedule.className} · {db.labs.find((lab) => lab.id === schedule.laboratoryId)?.code ?? 'Lab tidak ditemukan'}</p>
      </>
    );
    const className = cn(
      'w-full rounded-lg border border-base-700/60 bg-base-800/40 p-3 text-left',
      canUpdate && 'transition-colors hover:border-accent-content/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'
    );
    if (!canUpdate) return <div key={schedule.id} className={className}>{content}</div>;
    return (
      <button
        key={schedule.id}
        type="button"
        onClick={() => openEdit(schedule)}
        aria-label={`Edit jadwal ${schedule.subject} untuk ${schedule.className}`}
        title="Edit jadwal"
        className={className}
      >
        {content}
      </button>
    );
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('jadwal-reguler.csv', filtered.map((s) => ({
      Hari: s.day, Tanggal: s.date, Jam: `${s.startTime}-${s.endTime}`, Lab: db.labs.find((l) => l.id === s.laboratoryId)?.name, Kelas: s.className, Guru: s.teacherName, Mapel: s.subject, Status: s.status,
    })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jadwal Reguler"
        description="Alokasi penggunaan laboratorium yang berulang berdasarkan tahun ajaran, semester, kelas, guru, mata pelajaran, hari, dan jam."
        icon={<CalendarDays className="h-5 w-5" />}
        actions={
          <>
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canExport && <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Jadwal Reguler</Button>}
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-secondary">Jadwal Reguler digunakan untuk alokasi pembelajaran berulang. Penggunaan insidental atau kegiatan pada tanggal tertentu diajukan melalui Reservasi Lab.</p>
          {canViewBookings && <Button variant="secondary" size="sm" onClick={() => navigate('/bookings')}>Buka Reservasi Lab</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select label="Laboratorium" value={filters.lab} onChange={(e) => setFilters({ ...filters, lab: e.target.value })} placeholder="Semua lab" options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
            <Select label="Kelas" value={filters.className} onChange={(e) => setFilters({ ...filters, className: e.target.value })} placeholder="Semua kelas" options={classes.map((c) => ({ value: c, label: c }))} />
            <Select label="Guru" value={filters.teacher} onChange={(e) => setFilters({ ...filters, teacher: e.target.value })} placeholder="Semua guru" options={teachers.map((t) => ({ value: t, label: t }))} />
            <Select label="Mapel" value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })} placeholder="Semua mapel" options={subjects.map((s) => ({ value: s, label: s }))} />
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-base-700 p-1" role="group" aria-label="Pilih tampilan jadwal">
              {(['week', 'day', 'list'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus', view === v ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted')}>
                  {v === 'week' ? 'Mingguan' : v === 'day' ? 'Harian' : 'Daftar'}
                </button>
              ))}
            </div>
          </div>

          {view === 'day' && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pilih hari jadwal">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selectedDay === day}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    selectedDay === day
                      ? 'border-accent-content/40 bg-accent-primary/15 text-accent-content'
                      : 'border-base-700 text-ink-muted hover:bg-base-700/40 hover:text-ink-primary'
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={<CalendarDays className="h-7 w-7" />} title="Belum ada Jadwal Reguler" description="Tambah jadwal reguler atau ubah filter." /></Card>
      ) : view === 'list' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-base-700 text-left text-ink-muted">
                <th className="px-4 py-3 font-medium">Hari</th><th className="px-4 py-3 font-medium">Jam</th><th className="px-4 py-3 font-medium">Lab</th><th className="px-4 py-3 font-medium">Kelas</th><th className="px-4 py-3 font-medium">Guru</th><th className="px-4 py-3 font-medium">Mapel</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Aksi</th>
              </tr></thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                    <td className="px-4 py-3 text-ink-primary">{s.day}</td>
                    <td className="px-4 py-3 text-ink-secondary">{s.startTime} - {s.endTime}</td>
                    <td className="px-4 py-3 text-ink-secondary">{db.labs.find((l) => l.id === s.laboratoryId)?.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{s.className}</td>
                    <td className="px-4 py-3 text-ink-secondary">{s.teacherName}</td>
                    <td className="px-4 py-3 text-ink-secondary">{s.subject}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      {canUpdate && <button type="button" aria-label={`Edit jadwal ${s.subject} untuk ${s.className}`} title="Edit jadwal" onClick={() => openEdit(s)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><Pencil className="h-3.5 w-3.5" /></button>}
                      {canCreate && <button type="button" aria-label={`Duplikasi jadwal ${s.subject} untuk ${s.className}`} title="Duplikasi jadwal" onClick={() => duplicate(s)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><Copy className="h-3.5 w-3.5" /></button>}
                      {canDelete && <button type="button" aria-label={`Hapus jadwal ${s.subject} untuk ${s.className}`} title="Hapus jadwal" onClick={() => setConfirmDel(s)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'day' ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="font-semibold text-ink-primary">{selectedDay}</p>
            {selectedDaySchedules.length === 0 ? (
              <EmptyState title={`Tidak ada jadwal ${selectedDay}`} description="Pilih hari lain atau ubah filter jadwal." className="py-8" />
            ) : selectedDaySchedules.map(scheduleCard)}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label="Papan jadwal mingguan Senin sampai Jumat">
          <div className="grid min-w-[1090px] grid-cols-5 gap-4">
            {DAYS.map((day) => {
              const daySchedules = schedulesForWeekday(filtered, day);
              return (
                <Card key={day} className="min-w-0">
                  <CardContent className="space-y-2">
                    <p className="font-semibold text-ink-primary">{day}</p>
                    {daySchedules.length === 0 ? (
                      <p className="py-4 text-center text-xs text-ink-muted">Tidak ada jadwal</p>
                    ) : daySchedules.map(scheduleCard)}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Jadwal Reguler' : 'Tambah Jadwal Reguler'} onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Hari" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} options={DAYS.map((d) => ({ value: d, label: d }))} />
          <Input label="Tanggal" type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Jam Mulai" type="time" value={form.startTime ?? ''} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
          <Input label="Jam Selesai" type="time" value={form.endTime ?? ''} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
          <Select label="Laboratorium" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Select label="Kelas" value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} options={classes.map((c) => ({ value: c, label: c }))} />
          <Select label="Guru" value={form.teacherName} onChange={(e) => setForm({ ...form, teacherName: e.target.value })} options={teachers.map((t) => ({ value: t, label: t }))} />
          <Select label="Mata Pelajaran" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} options={subjects.map((s) => ({ value: s, label: s }))} />
          <Select label="Jenis Kegiatan" value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value as Schedule['activityType'] })} options={['Praktikum', 'Teori', 'Ujian', 'Lainnya'].map((a) => ({ value: a, label: a }))} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Schedule['status'] })} options={['Tetap', 'Pengganti', 'Dibatalkan'].map((s) => ({ value: s, label: s }))} />
        </div>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus jadwal ${confirmDel?.subject} (${confirmDel?.className})?`} confirmLabel="Hapus" />
    </div>
  );
}
