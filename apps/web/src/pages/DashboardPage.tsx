import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import {
  FlaskConical,
  Monitor,
  MonitorX,
  BookOpen,
  AlertTriangle,
  ShieldCheck,
  HandHelping,
  Package,
  RefreshCw,
  Download,
  Plus,
  TrendingUp,
  Clock,
  Wrench,
  AlertCircle,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatusBadge, Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LoadingState, EmptyState } from '@/components/ui/States';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { relativeTime, cn, downloadCSV } from '@/utils';
import type { DeviceStatus } from '@/types';

const STATUS_COLORS: Record<DeviceStatus, string> = {
  Online: '#10B981',
  Offline: '#64748B',
  Warning: '#F59E0B',
  Critical: '#EF4444',
  Maintenance: '#F97316',
  Reserved: '#3B82F6',
};

export function DashboardPage() {
  const { db, ready } = useAppData();
  const user = useAuthStore((s) => s.user);
  const { activeLabId } = useUIStore();

  const stats = useMemo(() => {
    const activeLabs = db.labs.filter((l) => l.status === 'active').length;
    const labDevices = db.devices.filter((d) => d.laboratoryId === activeLabId);
    const onlinePCs = labDevices.filter((d) => d.status === 'Online').length;
    const problemPCs = labDevices.filter((d) => ['Critical', 'Warning', 'Offline'].includes(d.status)).length;
    const today = new Date().toISOString().split('T')[0];
    const todaySchedules = db.schedules.filter((s) => s.date === today || s.day === new Date().toLocaleDateString('id-ID', { weekday: 'long' }));
    const openIncidents = db.incidents.filter((i) => !['Ditutup', 'Selesai', 'Ditolak'].includes(i.status)).length;
    const overdueMaintenance = db.maintenance.plans.filter((p) => p.status === 'active' && new Date(p.nextSchedule) < new Date()).length;
    const activeLoans = db.loans.filter((l) => ['Dipinjam', 'Diserahkan', 'Terlambat'].includes(l.status)).length;
    const lowStock = db.stock.items.filter((s) => s.quantity <= s.minStock).length;
    return { activeLabs, onlinePCs, problemPCs, todaySchedules: todaySchedules.length, openIncidents, overdueMaintenance, activeLoans, lowStock, totalPCs: labDevices.length };
  }, [db, activeLabId]);

  const usageData = useMemo(() => {
    const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    return days.map((d, i) => ({
      day: d,
      penggunaan: 60 + ((i * 37) % 35),
      jadwal: 40 + ((i * 23) % 30),
    }));
  }, []);

  const assetConditionData = useMemo(() => {
    const conds = ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'];
    return conds
      .map((c) => ({
        name: c,
        value: db.assets.filter((a) => a.condition === c).length,
        color: c === 'Baik' ? '#10B981' : c === 'Rusak Ringan' ? '#F59E0B' : c === 'Rusak Sedang' ? '#F97316' : c === 'Rusak Berat' ? '#EF4444' : '#64748B',
      }))
      .filter((x) => x.value > 0);
  }, [db.assets]);

  const labStatuses = db.labs.map((lab) => {
    const devices = db.devices.filter((d) => d.laboratoryId === lab.id);
    const online = devices.filter((d) => d.status === 'Online').length;
    const problem = devices.filter((d) => ['Critical', 'Warning', 'Offline'].includes(d.status)).length;
    const todaySchedule = db.schedules.find((s) => s.laboratoryId === lab.id);
    const inUse = db.sessions.some((s) => s.laboratoryId === lab.id && s.status === 'Berlangsung');
    return { lab, online, problem, total: devices.length, inUse, todaySchedule };
  });

  const recentActivity = db.auditLogs.slice(0, 8).map((log) => ({
    label: `${log.action} · ${log.module}`,
    by: log.userName,
    at: relativeTime(log.at),
    tone: (log.action === 'create' ? 'success' : log.action === 'delete' ? 'danger' : log.action === 'update' ? 'warning' : 'neutral') as 'success' | 'danger' | 'warning' | 'neutral',
  }));

  const upcomingMaintenance = db.maintenance.plans.filter((p) => p.status === 'active').slice(0, 4);
  const criticalNotifications = db.notifications.filter((n) => !n.read).slice(0, 4);
  const pendingJournals = db.journals.filter((j) => j.status === 'Draft' || j.status === 'Perlu Perbaikan');

  function handleExport() {
    downloadCSV('dashboard-stats.csv', [
      { metric: 'Laboratorium Aktif', value: stats.activeLabs },
      { metric: 'PC Online', value: stats.onlinePCs },
      { metric: 'PC Bermasalah', value: stats.problemPCs },
      { metric: 'Praktikum Hari Ini', value: stats.todaySchedules },
      { metric: 'Tiket Kerusakan Terbuka', value: stats.openIncidents },
      { metric: 'Maintenance Jatuh Tempo', value: stats.overdueMaintenance },
      { metric: 'Barang Dipinjam', value: stats.activeLoans },
      { metric: 'Stok Hampir Habis', value: stats.lowStock },
    ]);
  }

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const activeLab = db.labs.find((l) => l.id === activeLabId);

  if (!ready) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ').slice(0, 2).join(' ') ?? ''}`}
        description={`${activeLab?.name ?? 'Semua Lab'} · ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        icon={<FlaskConical className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => window.location.reload()}>
              Refresh
            </Button>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleExport}>
              Export
            </Button>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => (window.location.href = '/incidents')}>
              Lapor Kerusakan
            </Button>
          </>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Laboratorium Aktif" value={stats.activeLabs} icon={<FlaskConical className="h-5 w-5" />} tone="accent" delta={0} deltaLabel="vs bulan lalu" to="/laboratories" />
        <StatCard label="PC Aktif (Lab ini)" value={`${stats.onlinePCs}/${stats.totalPCs}`} icon={<Monitor className="h-5 w-5" />} tone="success" delta={2} deltaLabel="vs minggu lalu" to="/monitoring" />
        <StatCard label="PC Bermasalah" value={stats.problemPCs} icon={<MonitorX className="h-5 w-5" />} tone="danger" delta={-1} deltaLabel="vs minggu lalu" to="/monitoring" />
        <StatCard label="Praktikum Hari Ini" value={stats.todaySchedules} icon={<BookOpen className="h-5 w-5" />} tone="info" delta={0} deltaLabel="vs kemarin" to="/schedules" />
        <StatCard label="Tiket Kerusakan" value={stats.openIncidents} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" delta={3} deltaLabel="vs minggu lalu" to="/incidents" />
        <StatCard label="Maintenance Jatuh Tempo" value={stats.overdueMaintenance} icon={<ShieldCheck className="h-5 w-5" />} tone="orange" delta={-1} deltaLabel="vs minggu lalu" to="/maintenance" />
        <StatCard label="Barang Dipinjam" value={stats.activeLoans} icon={<HandHelping className="h-5 w-5" />} tone="accent" delta={1} deltaLabel="vs minggu lalu" to="/loans" />
        <StatCard label="Stok Hampir Habis" value={stats.lowStock} icon={<Package className="h-5 w-5" />} tone="danger" delta={2} deltaLabel="vs minggu lalu" to="/stock" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Lab statuses */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status Laboratorium</CardTitle>
              <Link to="/laboratories" className="text-xs text-accent-blue hover:underline">Lihat semua</Link>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {labStatuses.map(({ lab, online, problem, total, inUse, todaySchedule }) => (
                <Link
                  key={lab.id}
                  to={`/laboratories/${lab.id}`}
                  className="rounded-xl border border-base-700/70 bg-base-800/60 p-4 transition-all hover:border-base-600 hover:shadow-soft"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-ink-primary">{lab.name}</p>
                      <p className="text-xs text-ink-muted">{lab.location}</p>
                    </div>
                    {inUse ? (
                      <Badge tone="success" withIcon> Dipakai</Badge>
                    ) : (
                      <Badge tone="muted">Idle</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-ink-muted">PC Online</span>
                    <span className="font-semibold text-ink-primary">{online}/{total}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-base-700">
                    <div className={cn('h-full rounded-full', problem > 0 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${total ? (online / total) * 100 : 0}%` }} />
                  </div>
                  {todaySchedule ? (
                    <p className="mt-2 truncate text-[10px] text-ink-muted">{todaySchedule.startTime} · {todaySchedule.className}</p>
                  ) : (
                    <p className="mt-2 text-[10px] text-ink-muted">Tidak ada jadwal</p>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Usage chart */}
          <Card>
            <CardHeader>
              <CardTitle>Grafik Penggunaan Laboratorium</CardTitle>
              <Badge tone="accent">7 hari terakhir</Badge>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={usageData}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} />
                  <YAxis stroke="#94A3B8" fontSize={11} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area type="monotone" dataKey="penggunaan" stroke="#3B82F6" strokeWidth={2} fill="url(#g1)" name="Penggunaan (%)" />
                  <Area type="monotone" dataKey="jadwal" stroke="#06B6D4" strokeWidth={2} fill="url(#g2)" name="Jadwal (%)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Today sessions & work orders */}
          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sesi Berlangsung</CardTitle>
                <Link to="/sessions" className="text-xs text-accent-blue hover:underline">Lihat</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {db.sessions.filter((s) => s.status === 'Berlangsung' || s.status === 'Belum Dimulai').slice(0, 3).map((s) => {
                  const lab = db.labs.find((l) => l.id === s.laboratoryId);
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-base-700/60 bg-base-800/40 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-primary">{s.subject}</p>
                        <p className="truncate text-xs text-ink-muted">{lab?.name} · {s.className} · {s.teacherName}</p>
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                  );
                })}
                {db.sessions.filter((s) => s.status === 'Berlangsung' || s.status === 'Belum Dimulai').length === 0 && (
                  <EmptyState title="Tidak ada sesi aktif" className="py-6" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Work Order Teknisi</CardTitle>
                <Link to="/work-orders" className="text-xs text-accent-blue hover:underline">Lihat</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {db.workOrders.filter((w) => w.status === 'In Progress' || w.status === 'Assigned' || w.status === 'Waiting Part').slice(0, 3).map((w) => {
                  const lab = db.labs.find((l) => l.id === w.laboratoryId);
                  return (
                    <Link key={w.id} to="/work-orders" className="flex items-center justify-between gap-2 rounded-lg border border-base-700/60 bg-base-800/40 p-3 transition-colors hover:border-base-600">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-primary">{w.woNumber}</p>
                        <p className="truncate text-xs text-ink-muted">{lab?.name} · {w.technician}</p>
                      </div>
                      <StatusBadge status={w.status} />
                    </Link>
                  );
                })}
                {db.workOrders.filter((w) => w.status === 'In Progress' || w.status === 'Assigned').length === 0 && (
                  <EmptyState title="Tidak ada work order aktif" className="py-6" />
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Asset condition distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Distribusi Kondisi Aset</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={assetConditionData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {assetConditionData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Incident summary */}
          <Card>
            <CardHeader>
              <CardTitle>Ringkasan Tiket Kerusakan</CardTitle>
              <Link to="/incidents" className="text-xs text-accent-blue hover:underline">Lihat</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {db.incidents.slice(0, 4).map((inc) => (
                <Link key={inc.id} to="/incidents" className="flex items-center justify-between gap-2 rounded-lg p-2 transition-colors hover:bg-base-700/40">
                  <div className="min-w-0 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-primary">{inc.title}</p>
                      <p className="truncate text-[10px] text-ink-muted">{inc.ticketNumber}</p>
                    </div>
                  </div>
                  <StatusBadge status={inc.status} />
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Upcoming maintenance */}
          <Card>
            <CardHeader>
              <CardTitle>Maintenance Mendatang</CardTitle>
              <Link to="/maintenance" className="text-xs text-accent-blue hover:underline">Lihat</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcomingMaintenance.map((m) => {
                const lab = db.labs.find((l) => l.id === m.laboratoryId);
                const overdue = new Date(m.nextSchedule) < new Date();
                return (
                  <Link key={m.id} to="/maintenance" className="flex items-center justify-between gap-2 rounded-lg p-2 transition-colors hover:bg-base-700/40">
                    <div className="min-w-0 flex items-center gap-2">
                      <Wrench className={cn('h-4 w-4 shrink-0', overdue ? 'text-danger' : 'text-ink-muted')} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink-primary">{m.name}</p>
                        <p className="truncate text-[10px] text-ink-muted">{lab?.name} · {m.nextSchedule}</p>
                      </div>
                    </div>
                    {overdue && <Badge tone="danger">Overdue</Badge>}
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {/* Critical stock */}
          <Card>
            <CardHeader>
              <CardTitle>Stok Kritis</CardTitle>
              <Link to="/stock" className="text-xs text-accent-blue hover:underline">Lihat</Link>
            </CardHeader>
            <CardContent className="space-y-2">
              {db.stock.items.filter((s) => s.quantity <= s.minStock).slice(0, 3).map((s) => (
                <Link key={s.id} to="/stock" className="flex items-center justify-between gap-2 rounded-lg p-2 transition-colors hover:bg-base-700/40">
                  <div className="min-w-0 flex items-center gap-2">
                    <Package className="h-4 w-4 shrink-0 text-danger" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-primary">{s.name}</p>
                      <p className="truncate text-[10px] text-ink-muted">Min: {s.minStock} {s.unit}</p>
                    </div>
                  </div>
                  <Badge tone="danger">{s.quantity} {s.unit}</Badge>
                </Link>
              ))}
              {db.stock.items.filter((s) => s.quantity <= s.minStock).length === 0 && (
                <EmptyState title="Stok aman" className="py-6" />
              )}
            </CardContent>
          </Card>

          {/* Recent activity */}
          <Card>
            <CardHeader>
              <CardTitle>Aktivitas Terbaru</CardTitle>
              <Link to="/audit-logs" className="text-xs text-accent-blue hover:underline">Lihat</Link>
            </CardHeader>
            <CardContent>
              <ActivityTimeline items={recentActivity} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom row: mini calendar + pending journals + notifications */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Kalender Mini</CardTitle>
            <Link to="/calendar" className="text-xs text-accent-blue hover:underline">Lihat</Link>
          </CardHeader>
          <CardContent>
            <MiniCalendar events={db.calendarEvents} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jurnal Belum Dilengkapi</CardTitle>
            <Link to="/journals" className="text-xs text-accent-blue hover:underline">Lihat</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingJournals.slice(0, 4).map((j) => (
              <Link key={j.id} to="/journals" className="flex items-center justify-between gap-2 rounded-lg p-2 transition-colors hover:bg-base-700/40">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-primary">{j.material}</p>
                  <p className="truncate text-[10px] text-ink-muted">{j.journalNumber} · {j.date}</p>
                </div>
                <StatusBadge status={j.status} />
              </Link>
            ))}
            {pendingJournals.length === 0 && <EmptyState title="Semua jurnal lengkap" className="py-6" />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifikasi Penting</CardTitle>
            <Link to="/notifications" className="text-xs text-accent-blue hover:underline">Lihat</Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalNotifications.map((n) => (
              <Link key={n.id} to={n.link ?? '/notifications'} className="flex gap-2 rounded-lg p-2 transition-colors hover:bg-base-700/40">
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-blue" />}
                <div className={cn('min-w-0', n.read && 'pl-4')}>
                  <p className="truncate text-xs font-medium text-ink-primary">{n.title}</p>
                  <p className="truncate text-[10px] text-ink-muted">{n.message}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniCalendar({ events }: { events: { id: string; title: string; date: string; category: string }[] }) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayDate = today.getDate();

  const eventDates = new Set(
    events
      .filter((e) => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() === month;
      })
      .map((e) => new Date(e.date).getDate())
  );

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-ink-primary">
        {today.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-muted">
        {['M', 'S', 'S', 'R', 'K', 'J', 'S'].map((d, i) => (
          <div key={i} className="py-1">{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => (
          <div
            key={i}
            className={cn(
              'flex h-7 items-center justify-center rounded-md text-[10px]',
              d === null ? '' : d === todayDate ? 'bg-accent-blue font-bold text-white' : eventDates.has(d) ? 'bg-accent-blue/20 text-accent-blue' : 'text-ink-secondary hover:bg-base-700'
            )}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] text-ink-muted">
        <span className="h-2 w-2 rounded-full bg-accent-blue/40" /> Hari dengan event
      </div>
    </div>
  );
}
