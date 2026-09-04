import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  RefreshCw,
  Server,
} from 'lucide-react';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import {
  activityLabel,
  dateKeyForDate,
  datesForWeek,
  formatScheduleWeekRange,
  moveWeek,
  occurrencesForDate,
  scheduleOccurrencePresentationIssue,
  weekStartForDate,
  type ScheduleOccurrencePresentationIssue,
} from '@/lib/scheduleOccurrenceView';
import {
  scheduleOccurrenceGateway,
  type ScheduleOccurrenceDto,
  type ScheduleOccurrenceResult,
} from '@/services/scheduleOccurrenceApi';
import { useAuthStore } from '@/stores/authStore';
import { downloadCSV, cn } from '@/utils';

type ScheduleViewMode = 'week' | 'day' | 'list';

type SchedulePageState =
  | { status: 'loading' }
  | { status: 'ready'; result: ScheduleOccurrenceResult }
  | { status: 'error'; issue: ScheduleOccurrencePresentationIssue };

interface ScheduleFilters {
  laboratoryId: string;
  academicClassId: string;
  teacherId: string;
  subjectId: string;
  activityType: string;
}

const EMPTY_FILTERS: ScheduleFilters = {
  laboratoryId: 'all',
  academicClassId: 'all',
  teacherId: 'all',
  subjectId: 'all',
  activityType: 'all',
};

function timeLabel(value: string): string {
  return value.slice(0, 5);
}

function occurrenceResourceOptions(
  occurrences: readonly ScheduleOccurrenceDto[],
  select: (occurrence: ScheduleOccurrenceDto) => { id: string; name: string } | null,
): Array<{ value: string; label: string }> {
  const values = new Map<string, string>();
  occurrences.forEach((occurrence) => {
    const resource = select(occurrence);
    if (resource) values.set(resource.id, resource.name);
  });
  return [...values.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]))
    .map(([value, label]) => ({ value, label }));
}

function occurrenceCard(occurrence: ScheduleOccurrenceDto) {
  return (
    <div
      key={occurrence.id}
      className="rounded-xl border border-base-700/60 bg-base-900/30 p-4 shadow-sm"
      data-occurrence-id={occurrence.id}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink-primary">
          {timeLabel(occurrence.startTime)} - {timeLabel(occurrence.endTime)}
        </span>
        <Badge tone="accent">{activityLabel(occurrence.activityType)}</Badge>
      </div>

      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-ink-primary">
        {occurrence.subject.name}
      </p>

      <div className="mt-3 space-y-1.5 border-t border-base-700/50 pt-2.5 text-xs leading-5 text-ink-secondary">
        <p><span className="text-ink-muted">Kelas:</span> {occurrence.academicClass.name}</p>
        <p><span className="text-ink-muted">Guru:</span> {occurrence.teacher.name}</p>
        <p>
          <span className="text-ink-muted">Lab:</span>{' '}
          {occurrence.plannedLaboratory?.name ?? 'Belum direncanakan'}
        </p>
        <p><span className="text-ink-muted">JP:</span> {occurrence.instructionPeriodCount}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-base-700/40 pt-2 text-[11px] text-ink-muted">
        <span>TESSELA v{occurrence.sourceVersion}</span>
        <span aria-hidden="true">•</span>
        <span className="break-all">{occurrence.sourceScheduleId}</span>
      </div>
    </div>
  );
}

export function SchedulesPage() {
  const navigate = useNavigate();
  const bootstrapSession = useAuthStore((state) => state.bootstrapSession);
  const canViewBookings = usePermission('bookings', 'view');

  const todayKey = useMemo(() => dateKeyForDate(new Date()), []);
  const [weekStart, setWeekStart] = useState(() => weekStartForDate(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [view, setView] = useState<ScheduleViewMode>('week');
  const [filters, setFilters] = useState<ScheduleFilters>(EMPTY_FILTERS);
  const [state, setState] = useState<SchedulePageState>({ status: 'loading' });
  const weeklyBoardRef = useRef<HTMLDivElement>(null);
  const [weeklyScrollState, setWeeklyScrollState] = useState({ atStart: true, atEnd: false });
  const loadSequence = useRef(0);

  const weekDates = useMemo(() => datesForWeek(weekStart), [weekStart]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setState({ status: 'loading' });

    try {
      const result = await scheduleOccurrenceGateway.listAll({
        from: weekDates[0].key,
        to: weekDates[6].key,
      });

      if (sequence === loadSequence.current) {
        setState({ status: 'ready', result });
      }
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      const issue = scheduleOccurrencePresentationIssue(error);
      if (issue.authBoundary) {
        await bootstrapSession({ force: true });
        return;
      }
      setState({ status: 'error', issue });
    }
  }, [bootstrapSession, weekDates]);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  useEffect(() => {
    if (!weekDates.some((date) => date.key === selectedDate)) {
      setSelectedDate(weekDates[0].key);
    }
  }, [selectedDate, weekDates]);

  const occurrences = state.status === 'ready' ? state.result.data : [];

  const laboratoryOptions = useMemo(
    () => occurrenceResourceOptions(occurrences, (occurrence) => occurrence.plannedLaboratory),
    [occurrences],
  );
  const classOptions = useMemo(
    () => occurrenceResourceOptions(occurrences, (occurrence) => occurrence.academicClass),
    [occurrences],
  );
  const teacherOptions = useMemo(
    () => occurrenceResourceOptions(occurrences, (occurrence) => occurrence.teacher),
    [occurrences],
  );
  const subjectOptions = useMemo(
    () => occurrenceResourceOptions(occurrences, (occurrence) => occurrence.subject),
    [occurrences],
  );

  const hasUnplannedLaboratory = useMemo(
    () => occurrences.some((occurrence) => occurrence.plannedLaboratory === null),
    [occurrences],
  );

  const filtered = useMemo(() => occurrences.filter((occurrence) => {
    if (filters.laboratoryId === '__unplanned__' && occurrence.plannedLaboratory !== null) return false;
    if (filters.laboratoryId !== 'all'
      && filters.laboratoryId !== '__unplanned__'
      && occurrence.plannedLaboratory?.id !== filters.laboratoryId) return false;
    if (filters.academicClassId !== 'all' && occurrence.academicClass.id !== filters.academicClassId) return false;
    if (filters.teacherId !== 'all' && occurrence.teacher.id !== filters.teacherId) return false;
    if (filters.subjectId !== 'all' && occurrence.subject.id !== filters.subjectId) return false;
    if (filters.activityType !== 'all' && occurrence.activityType !== filters.activityType) return false;
    return true;
  }), [filters, occurrences]);

  const selectedDateOccurrences = useMemo(
    () => occurrencesForDate(filtered, selectedDate),
    [filtered, selectedDate],
  );

  const updateWeeklyScrollState = useCallback(() => {
    const board = weeklyBoardRef.current;
    if (!board) return;

    const maxScrollLeft = board.scrollWidth - board.clientWidth;
    setWeeklyScrollState({
      atStart: board.scrollLeft <= 1,
      atEnd: board.scrollLeft >= maxScrollLeft - 1,
    });
  }, []);

  useEffect(() => {
    updateWeeklyScrollState();
  }, [filtered.length, updateWeeklyScrollState, view, weekStart]);

  function changeWeek(delta: number) {
    const next = moveWeek(weekStart, delta);
    setWeekStart(next);
    setSelectedDate(next);
    setFilters(EMPTY_FILTERS);
  }

  function goToCurrentWeek() {
    const next = weekStartForDate(new Date());
    setWeekStart(next);
    setSelectedDate(dateKeyForDate(new Date()));
    setFilters(EMPTY_FILTERS);
  }

  function scrollWeeklyBoard(direction: 'left' | 'right') {
    const board = weeklyBoardRef.current;
    if (!board) return;

    const weekdayColumn = board.querySelector<HTMLElement>('[data-weekday-column]');
    const scrollAmount = (weekdayColumn?.offsetWidth ?? 256) + 20;
    board.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }

  function exportCSV() {
    downloadCSV('jadwal-reguler-canonical.csv', filtered.map((occurrence) => ({
      Tanggal: occurrence.occursOn,
      Jam: `${timeLabel(occurrence.startTime)}-${timeLabel(occurrence.endTime)}`,
      Lab: occurrence.plannedLaboratory?.name ?? 'Belum direncanakan',
      Kelas: occurrence.academicClass.name,
      Guru: occurrence.teacher.name,
      Mapel: occurrence.subject.name,
      Jenis: activityLabel(occurrence.activityType),
      JP: occurrence.instructionPeriodCount,
      Sumber: `${occurrence.sourcePublicationId} v${occurrence.sourceVersion}`,
      SourceScheduleId: occurrence.sourceScheduleId,
    })));
  }

  const activePublicationCount = state.status === 'ready' ? state.result.meta.activePublicationCount : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jadwal Reguler"
        description="Current plan dari publikasi TESSELA aktif. Jadwal struktural bersifat read-only di SmartLab."
        icon={<CalendarDays className="h-5 w-5" />}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void load()}
              disabled={state.status === 'loading'}
            >
              Muat ulang
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV} disabled={filtered.length === 0}>
              Export
            </Button>
            <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-content">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink-primary">Sumber jadwal canonical</p>
                <Badge tone={activePublicationCount > 0 ? 'success' : 'muted'}>
                  {activePublicationCount > 0
                    ? `${activePublicationCount} publikasi aktif`
                    : 'Belum ada publikasi aktif'}
                </Badge>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-ink-muted">
                Perubahan guru, kelas, mata pelajaran, hari, jam, dan planned Laboratory dilakukan di TESSELA lalu dipublikasikan sebagai versi baru.
                SmartLab tidak mengedit atau memecahkan ulang jadwal sumber. Perubahan satu tanggal akan memakai Schedule Exception pada fase berikutnya.
              </p>
            </div>
          </div>

          {canViewBookings && (
            <Button variant="secondary" size="sm" className="min-h-10 shrink-0 px-4" onClick={() => navigate('/bookings')}>
              Buka Reservasi Lab
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => changeWeek(-1)}>
              Minggu sebelumnya
            </Button>
            <Button variant="secondary" size="sm" onClick={goToCurrentWeek}>Minggu ini</Button>
            <Button variant="secondary" size="sm" icon={<ChevronRight className="h-4 w-4" />} onClick={() => changeWeek(1)}>
              Minggu berikutnya
            </Button>
            <p className="ml-auto text-sm font-semibold text-ink-primary">{formatScheduleWeekRange(weekStart)}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Select
              label="Laboratorium"
              value={filters.laboratoryId}
              onChange={(event) => setFilters({ ...filters, laboratoryId: event.target.value })}
              options={[
                { value: 'all', label: 'Semua laboratorium' },
                ...laboratoryOptions,
                ...(hasUnplannedLaboratory ? [{ value: '__unplanned__', label: 'Belum direncanakan' }] : []),
              ]}
            />
            <Select
              label="Kelas"
              value={filters.academicClassId}
              onChange={(event) => setFilters({ ...filters, academicClassId: event.target.value })}
              options={[{ value: 'all', label: 'Semua kelas' }, ...classOptions]}
            />
            <Select
              label="Guru"
              value={filters.teacherId}
              onChange={(event) => setFilters({ ...filters, teacherId: event.target.value })}
              options={[{ value: 'all', label: 'Semua guru' }, ...teacherOptions]}
            />
            <Select
              label="Mata Pelajaran"
              value={filters.subjectId}
              onChange={(event) => setFilters({ ...filters, subjectId: event.target.value })}
              options={[{ value: 'all', label: 'Semua mapel' }, ...subjectOptions]}
            />
            <Select
              label="Jenis Kegiatan"
              value={filters.activityType}
              onChange={(event) => setFilters({ ...filters, activityType: event.target.value })}
              options={[
                { value: 'all', label: 'Semua jenis' },
                { value: 'practical', label: 'Praktikum' },
                { value: 'theory', label: 'Teori' },
                { value: 'exam', label: 'Ujian' },
                { value: 'other', label: 'Lainnya' },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-700/50 pt-4">
            <p className="text-xs text-ink-muted">
              {state.status === 'ready'
                ? `${filtered.length} occurrence ditampilkan dari ${state.result.meta.total} occurrence current plan minggu ini.`
                : 'Occurrence akan dimuat dari Laravel API.'}
            </p>

            <div className="flex items-center gap-1 rounded-lg border border-base-700 p-1" role="group" aria-label="Pilih tampilan jadwal">
              {(['week', 'day', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    view === mode ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted',
                  )}
                >
                  {mode === 'week' ? 'Mingguan' : mode === 'day' ? 'Harian' : 'Daftar'}
                </button>
              ))}
            </div>
          </div>

          {view === 'day' && (
            <div className="flex flex-wrap gap-2 border-t border-base-700/50 pt-4" role="group" aria-label="Pilih tanggal jadwal">
              {weekDates.map((date) => (
                <button
                  key={date.key}
                  type="button"
                  aria-pressed={selectedDate === date.key}
                  onClick={() => setSelectedDate(date.key)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    selectedDate === date.key
                      ? 'border-accent-content/40 bg-accent-primary/15 text-accent-content'
                      : 'border-base-700 text-ink-muted hover:bg-base-700/40 hover:text-ink-primary',
                  )}
                >
                  <span className="block">{date.label}</span>
                  <span className="mt-0.5 block text-[11px] opacity-75">{date.shortLabel}</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {state.status === 'loading' ? (
        <Card><LoadingState label="Memuat current plan jadwal dari server..." /></Card>
      ) : state.status === 'error' ? (
        <Card><ErrorState message={state.issue.message} onRetry={state.issue.retryable ? () => void load() : undefined} /></Card>
      ) : activePublicationCount === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-7 w-7" />}
            title="Belum ada publikasi jadwal aktif"
            description="Aktifkan publikasi TESSELA yang sudah tervalidasi sebelum halaman ini dapat menampilkan current plan."
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-7 w-7" />}
            title="Tidak ada occurrence pada rentang ini"
            description="Current plan aktif tersedia, tetapi tidak ada jadwal yang cocok dengan minggu dan filter yang dipilih."
          />
        </Card>
      ) : view === 'list' ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Tanggal</th>
                  <th className="px-4 py-3 font-medium">Jam</th>
                  <th className="px-4 py-3 font-medium">Lab</th>
                  <th className="px-4 py-3 font-medium">Kelas</th>
                  <th className="px-4 py-3 font-medium">Guru</th>
                  <th className="px-4 py-3 font-medium">Mapel</th>
                  <th className="px-4 py-3 font-medium">Jenis</th>
                  <th className="px-4 py-3 font-medium">JP</th>
                  <th className="px-4 py-3 font-medium">Sumber</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((occurrence) => (
                  <tr key={occurrence.id} className="border-b border-base-700/40 hover:bg-base-700/30">
                    <td className="whitespace-nowrap px-4 py-3 text-ink-primary">{occurrence.occursOn}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-secondary">{timeLabel(occurrence.startTime)} - {timeLabel(occurrence.endTime)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{occurrence.plannedLaboratory?.name ?? 'Belum direncanakan'}</td>
                    <td className="px-4 py-3 text-ink-secondary">{occurrence.academicClass.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{occurrence.teacher.name}</td>
                    <td className="px-4 py-3 text-ink-secondary">{occurrence.subject.name}</td>
                    <td className="px-4 py-3"><Badge tone="accent">{activityLabel(occurrence.activityType)}</Badge></td>
                    <td className="px-4 py-3 text-ink-secondary">{occurrence.instructionPeriodCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-muted">TESSELA v{occurrence.sourceVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : view === 'day' ? (
        <Card>
          <CardContent className="space-y-3">
            <div>
              <p className="font-semibold text-ink-primary">
                {weekDates.find((date) => date.key === selectedDate)?.label ?? selectedDate}
              </p>
              <p className="text-xs text-ink-muted">{selectedDate}</p>
            </div>
            {selectedDateOccurrences.length === 0 ? (
              <EmptyState
                title="Tidak ada occurrence pada tanggal ini"
                description="Pilih tanggal lain atau ubah filter current plan."
                className="py-8"
              />
            ) : selectedDateOccurrences.map(occurrenceCard)}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<ChevronLeft className="h-4 w-4" />}
              aria-label="Geser jadwal ke kiri"
              disabled={weeklyScrollState.atStart}
              onClick={() => scrollWeeklyBoard('left')}
            >
              Geser kiri
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={<ChevronRight className="h-4 w-4" />}
              aria-label="Geser jadwal ke kanan"
              disabled={weeklyScrollState.atEnd}
              onClick={() => scrollWeeklyBoard('right')}
            >
              Geser kanan
            </Button>
          </div>

          <div
            ref={weeklyBoardRef}
            onScroll={updateWeeklyScrollState}
            className="overflow-x-auto pb-3"
            tabIndex={0}
            role="region"
            aria-label="Papan current plan jadwal Senin sampai Minggu"
          >
            <div className="grid min-w-[1792px] grid-cols-7 gap-5">
              {weekDates.map((date) => {
                const dayOccurrences = occurrencesForDate(filtered, date.key);
                return (
                  <Card key={date.key} data-weekday-column className="min-w-0">
                    <CardContent className="space-y-3 p-4">
                      <div className="border-b border-base-700/60 pb-3">
                        <p className="text-sm font-semibold text-ink-primary">{date.label}</p>
                        <p className="text-xs text-ink-muted">{date.shortLabel}</p>
                      </div>
                      {dayOccurrences.length === 0
                        ? <p className="py-4 text-center text-xs text-ink-muted">Tidak ada jadwal</p>
                        : dayOccurrences.map(occurrenceCard)}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
