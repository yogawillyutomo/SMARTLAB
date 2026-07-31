import { useMemo, useState } from 'react';
import { CalendarRange, Plus, Pencil, Trash2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV, cn } from '@/utils';
import type { CalendarEvent, CalendarCategory } from '@/types';

const CATEGORIES: { value: CalendarCategory; label: string; color: string }[] = [
  { value: 'hari efektif', label: 'Hari Efektif', color: 'bg-success' },
  { value: 'libur', label: 'Libur', color: 'bg-danger' },
  { value: 'ujian', label: 'Ujian', color: 'bg-warning' },
  { value: 'kegiatan sekolah', label: 'Kegiatan Sekolah', color: 'bg-info' },
  { value: 'maintenance', label: 'Maintenance', color: 'bg-orange' },
  { value: 'booking', label: 'Booking', color: 'bg-purple' },
  { value: 'workshop', label: 'Workshop', color: 'bg-status-cyan' },
  { value: 'LKS', label: 'LKS', color: 'bg-info' },
  { value: 'rapat', label: 'Rapat', color: 'bg-pink-500' },
  { value: 'lainnya', label: 'Lainnya', color: 'bg-base-600' },
];

const colorMap = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.color]));

export function CalendarPage() {
  const { db, mutate } = useAppData();
  const canCreate = usePermission('calendar', 'create');
  const canUpdate = usePermission('calendar', 'update');
  const canDelete = usePermission('calendar', 'delete');
  const canExport = usePermission('calendar', 'export');
  const [view, setView] = useState<'month' | 'week' | 'agenda'>('month');
  const [current, setCurrent] = useState(new Date());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [confirmDel, setConfirmDel] = useState<CalendarEvent | null>(null);
  const [filterCat, setFilterCat] = useState<string>('all');
  const [form, setForm] = useState<Partial<CalendarEvent>>({});

  const filtered = db.calendarEvents.filter((e) => filterCat === 'all' || e.category === filterCat);

  const monthData = useMemo(() => {
    const year = current.getFullYear();
    const month = current.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return { year, month, cells };
  }, [current]);

  function eventsOnDay(day: number) {
    const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return filtered.filter((e) => {
      if (e.date === dateStr) return true;
      if (e.endDate && e.date <= dateStr && e.endDate >= dateStr) return true;
      return false;
    });
  }

  function openCreate(date?: string) {
    if (!canCreate) return;
    setEditing(null);
    setForm({ date: date ?? new Date().toISOString().split('T')[0], category: 'kegiatan sekolah' });
    setOpen(true);
  }
  function openEdit(e: CalendarEvent) { if (!canUpdate) return; setEditing(e); setForm(e); setOpen(true); }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.title || !form.date) { toast('Judul dan tanggal wajib diisi', 'error'); return; }
    mutate((d) => {
      if (editing) {
        const idx = d.calendarEvents.findIndex((e) => e.id === editing.id);
        if (idx >= 0) d.calendarEvents[idx] = { ...d.calendarEvents[idx], ...form } as CalendarEvent;
      } else {
        d.calendarEvents.push({ ...form, id: `cal-${Date.now()}` } as CalendarEvent);
      }
    });
    toast(editing ? 'Event diperbarui' : 'Event ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.calendarEvents = d.calendarEvents.filter((e) => e.id !== confirmDel.id); });
    toast('Event dihapus', 'success');
    setConfirmDel(null);
    setDetail(null);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('kalender-akademik.csv', db.calendarEvents.map((e) => ({ Judul: e.title, Tanggal: e.date, Selesai: e.endDate ?? '', Kategori: e.category, Deskripsi: e.description ?? '' })));
  }

  const agendaEvents = [...filtered].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6">
      <PageHeader title="Kalender Akademik" description="Tahun Ajaran 2026/2027" icon={<CalendarRange className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openCreate()}>Tambah Event</Button>}
        </>}
      />
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[140px] text-center text-sm font-semibold text-ink-primary">{current.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</span>
            <Button variant="ghost" size="icon" onClick={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCurrent(new Date())}>Hari ini</Button>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-base-700 p-1">
            {(['month', 'week', 'agenda'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium', view === v ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted')}>{v === 'month' ? 'Bulan' : v === 'week' ? 'Minggu' : 'Agenda'}</button>
            ))}
          </div>
          <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} placeholder="Semua kategori" />
        </CardContent>
      </Card>

      {view === 'month' && (
        <Card>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted mb-2">
              {['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'].map((d) => <div key={d} className="py-2 font-medium">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthData.cells.map((day, i) => {
                const isToday = day === new Date().getDate() && current.getMonth() === new Date().getMonth() && current.getFullYear() === new Date().getFullYear();
                const dayEvents = day ? eventsOnDay(day) : [];
                return (
                  <div key={i} className={cn('min-h-[90px] rounded-lg border p-1.5', day ? 'border-base-700/60 bg-base-800/40' : 'border-transparent', isToday && 'border-accent-primary')}>
                    {day && (
                      <>
                        <p className={cn('text-xs', isToday ? 'font-bold text-accent-primary' : 'text-ink-muted')}>{day}</p>
                        <div className="mt-1 space-y-0.5">
                          {dayEvents.slice(0, 2).map((e) => (
                            <button key={e.id} onClick={() => setDetail(e)} className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-white', colorMap[e.category] ?? 'bg-base-600')}>
                              {e.title}
                            </button>
                          ))}
                          {dayEvents.length > 2 && <p className="text-[10px] text-ink-muted">+{dayEvents.length - 2} lainnya</p>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {view === 'week' && (
        <Card><CardContent>
          <div className="grid grid-cols-7 gap-2">
            {['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map((d, i) => {
              const dayEvents = filtered.filter((e) => new Date(e.date).getDay() === i).slice(0, 3);
              return (
                <div key={d} className="rounded-lg border border-base-700/60 bg-base-800/40 p-2 min-h-[120px]">
                  <p className="text-xs font-medium text-ink-secondary">{d}</p>
                  <div className="mt-1 space-y-1">
                    {dayEvents.map((e) => <button key={e.id} onClick={() => setDetail(e)} className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-white', colorMap[e.category])}>{e.title}</button>)}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent></Card>
      )}

      {view === 'agenda' && (
        <Card>
          {agendaEvents.length === 0 ? <EmptyState title="Belum ada event" /> : (
            <div className="divide-y divide-base-700/40">
              {agendaEvents.map((e) => (
                <button key={e.id} onClick={() => setDetail(e)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-base-700/30">
                  <div className={cn('h-2 w-2 rounded-full', colorMap[e.category])} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-primary">{e.title}</p>
                    <p className="text-xs text-ink-muted">{e.date}{e.endDate ? ` - ${e.endDate}` : ''}</p>
                  </div>
                  <Badge tone="neutral">{e.category}</Badge>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {CATEGORIES.map((c) => (
          <div key={c.value} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className={cn('h-2.5 w-2.5 rounded-full', c.color)} />
            {c.label}
          </div>
        ))}
      </div>

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Event' : 'Tambah Event'} onSubmit={save} size="md">
        <div className="space-y-4">
          <Input label="Judul" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <Input label="Tanggal Mulai" type="date" value={form.date ?? ''} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input label="Tanggal Selesai (opsional)" type="date" value={form.endDate ?? ''} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          <Select label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as CalendarCategory })} options={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
          <Textarea label="Deskripsi" value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
      </FormDialog>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.title} size="sm">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2"><span className={cn('h-3 w-3 rounded-full', colorMap[detail.category])} /><Badge tone="neutral">{detail.category}</Badge></div>
            <div><p className="text-xs text-ink-muted">Tanggal</p><p className="text-ink-primary">{detail.date}{detail.endDate ? ` - ${detail.endDate}` : ''}</p></div>
            {detail.description && <div><p className="text-xs text-ink-muted">Deskripsi</p><p className="text-ink-secondary">{detail.description}</p></div>}
                    {canUpdate && <div className="flex gap-2 pt-2 border-t border-base-700">
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => { openEdit(detail); setDetail(null); }}>Edit</Button>
                {canDelete && <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmDel(detail)}>Hapus</Button>}
              </div>}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus event "${confirmDel?.title}"?`} confirmLabel="Hapus" />
    </div>
  );
}
