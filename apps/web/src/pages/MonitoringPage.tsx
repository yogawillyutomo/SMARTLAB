import { useMemo, useState } from 'react';
import {
  Monitor,
  Search,
  RefreshCw,
  LayoutGrid,
  List,
  Cpu,
  MemoryStick,
  HardDrive,
  Thermometer,
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle,
  Wrench,
  Activity,
  Map,
  Server,
  Tag,
  XCircle,
} from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useUIStore } from '@/stores/uiStore';
import { deviceRepository } from '@/services/repositories';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge, StatusBadge, ConditionBadge } from '@/components/ui/Badge';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/States';
import { PCIconCard, PCStatusLegend } from '@/components/common/PCIconCard';
import { Tabs } from '@/components/ui/Tabs';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { toast } from '@/stores/toastStore';
import { cn, relativeTime } from '@/utils';
import type { Asset, Device, DeviceStatus, Incident, MaintenanceExecution } from '@/types';

const STATUS_FILTERS: (DeviceStatus | 'all')[] = ['all', 'Online', 'Offline', 'Warning', 'Critical', 'Maintenance', 'Reserved'];

export function MonitoringPage() {
  const { db, mutate, refresh } = useAppData();
  const { activeLabId, setActiveLab } = useUIStore();
  const user = useAuthStore((s) => s.user);
  const canUpdateMonitoring = usePermission('monitoring', 'update');
  const canCreateIncident = usePermission('incidents', 'create');
  const canScheduleMaintenance = usePermission('maintenance', 'create');
  const [selectedLab, setSelectedLab] = useState(activeLabId);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeviceStatus | 'all'>('all');
  const [conditionFilter, setConditionFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<Device | null>(null);
  const [simulating, setSimulating] = useState(false);

  const labDevices = useMemo(
    () => db.devices.filter((d) => d.laboratoryId === selectedLab),
    [db.devices, selectedLab]
  );

  const filtered = useMemo(() => {
    return labDevices.filter((d) => {
      if (search) {
        const q = search.toLowerCase();
        if (!d.hostname.toLowerCase().includes(q) && !d.positionCode.toLowerCase().includes(q) && !d.assetCode.toLowerCase().includes(q)) return false;
      }
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (conditionFilter !== 'all') {
        const asset = db.assets.find((a) => a.assetCode === d.assetCode);
        if (asset?.condition !== conditionFilter) return false;
      }
      return true;
    });
  }, [labDevices, search, statusFilter, conditionFilter, db.assets]);

  const summary = useMemo(() => {
    const total = labDevices.length;
    return {
      total,
      online: labDevices.filter((d) => d.status === 'Online').length,
      offline: labDevices.filter((d) => d.status === 'Offline').length,
      warning: labDevices.filter((d) => d.status === 'Warning').length,
      critical: labDevices.filter((d) => d.status === 'Critical').length,
      maintenance: labDevices.filter((d) => d.status === 'Maintenance').length,
    };
  }, [labDevices]);

  async function handleSimulate() {
    if (!canUpdateMonitoring) return;
    setSimulating(true);
    await deviceRepository.simulateHeartbeat(selectedLab);
    refresh();
    setSimulating(false);
    toast('Heartbeat disimulasikan. Metrik PC online diperbarui.', 'success');
  }

  function handleStatusChange(device: Device, newStatus: DeviceStatus) {
    if (!canUpdateMonitoring) return;
    mutate((d) => {
      const idx = d.devices.findIndex((x) => x.id === device.id);
      if (idx >= 0) {
        d.devices[idx].status = newStatus;
        d.devices[idx].lastHeartbeat = new Date().toISOString();
        d.devices[idx].network = newStatus === 'Offline' ? 'Disconnected' : newStatus === 'Warning' ? 'Limited' : 'Connected';
        d.devices[idx].cpuUsage = newStatus === 'Online' ? Math.max(5, d.devices[idx].cpuUsage) : 0;
        d.devices[idx].ramUsage = newStatus === 'Online' ? Math.max(15, d.devices[idx].ramUsage) : 0;
        // sync asset condition
        const aIdx = d.assets.findIndex((a) => a.assetCode === device.assetCode);
        if (aIdx >= 0) {
          d.assets[aIdx].condition = newStatus === 'Critical' ? 'Rusak Berat' : newStatus === 'Warning' ? 'Rusak Ringan' : newStatus === 'Maintenance' ? 'Rusak Sedang' : 'Baik';
          d.assets[aIdx].status = newStatus === 'Maintenance' ? 'Maintenance' : newStatus === 'Offline' ? 'Rusak' : 'Aktif';
        }
      }
    });
    setSelected((s) => (s && s.id === device.id ? { ...s, status: newStatus } : s));
    toast(`Status ${device.hostname} diubah menjadi ${newStatus}`, 'success');
  }

  function createIncidentFromDevice(device: Device) {
    if (!canCreateIncident) return;
    mutate((d) => {
      const num = `INC-2026-${String(d.incidents.length + 1).padStart(4, '0')}`;
      d.incidents.unshift({
        id: `inc-${Date.now()}`,
        ticketNumber: num,
        reporterName: user?.name ?? 'User',
        laboratoryId: device.laboratoryId,
        assetCode: device.assetCode,
        date: new Date().toISOString(),
        category: 'hardware',
        title: `Kerusakan ${device.hostname}`,
        description: `Dilaporkan dari halaman monitoring. Status PC: ${device.status}`,
        impact: 'Menghambat praktikum',
        priority: device.status === 'Critical' ? 'Kritis' : 'Tinggi',
        blocksPracticum: device.status === 'Critical',
        stepsTaken: 'Dicek dari dashboard monitoring',
        status: 'Dilaporkan',
        comments: [],
        timeline: [{ status: 'Dilaporkan', at: new Date().toISOString(), by: user?.name ?? 'User' }],
      });
    });
    toast(`Tiket kerusakan dibuat untuk ${device.hostname}`, 'success');
    setSelected(null);
  }

  function scheduleMaintenance(device: Device) {
    if (!canScheduleMaintenance) return;
    mutate((d) => {
      d.maintenance.plans.push({
        id: `mp-${Date.now()}`,
        name: `Maintenance ${device.hostname}`,
        assetCategory: 'Komputer',
        laboratoryId: device.laboratoryId,
        frequency: 'bulanan',
        checklist: ['Cek kondisi umum', 'Test koneksi', 'Bersihkan unit'],
        technician: 'Andi Wijaya',
        nextSchedule: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        status: 'active',
      });
    });
    toast(`Pemeliharaan terjadwal untuk ${device.hostname}`, 'success');
  }

  const selectedAsset = selected ? db.assets.find((a) => a.assetCode === selected.assetCode) : null;
  const selectedIncidents = selected ? db.incidents.filter((i) => i.assetCode === selected.assetCode).slice(0, 5) : [];
  const selectedMaint = selected ? db.maintenance.executions.filter((m) => m.assetCode === selected.assetCode).slice(0, 5) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring Perangkat"
        description="Pantau status operasional, konektivitas, dan kondisi teknis perangkat laboratorium."
        icon={<Monitor className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Map className="h-4 w-4" />} onClick={() => (window.location.href = `/laboratories/${selectedLab}/layout`)}>
              Denah
            </Button>
            {canUpdateMonitoring && <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} loading={simulating} onClick={handleSimulate}>
              Simulasi Heartbeat
            </Button>}
          </>
        }
      />

      {/* Lab selector + summary */}
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardContent className="space-y-4">
            <Select
              label="Laboratorium"
              value={selectedLab}
              onChange={(e) => {
                setSelectedLab(e.target.value);
                setActiveLab(e.target.value);
              }}
              options={db.labs.map((l) => ({ value: l.id, label: `${l.name} · ${l.location}` }))}
            />
            <div className="grid grid-cols-3 gap-2">
              <SummaryStat label="Total" value={summary.total} tone="neutral" />
              <SummaryStat label="Online" value={summary.online} tone="success" />
              <SummaryStat label="Offline" value={summary.offline} tone="muted" />
              <SummaryStat label="Warning" value={summary.warning} tone="warning" />
              <SummaryStat label="Critical" value={summary.critical} tone="danger" />
              <SummaryStat label="Maint." value={summary.maintenance} tone="orange" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PCStatusLegend />
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-56">
            <Input icon={<Search className="h-4 w-4" />} placeholder="Cari PC, hostname, aset..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="w-full sm:w-44">
            <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DeviceStatus | 'all')} options={STATUS_FILTERS.slice(1).map((s) => ({ value: s, label: s }))} placeholder="Semua status" />
          </div>
          <div className="w-full sm:w-44">
            <Select label="Kondisi" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} options={['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'].map((c) => ({ value: c, label: c }))} placeholder="Semua kondisi" />
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-base-700 p-1">
          <button onClick={() => setView('grid')} className={cn('rounded-md p-1.5', view === 'grid' ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted hover:text-ink-primary')} aria-label="Tampilan grid">
              <LayoutGrid className="h-4 w-4" />
            </button>
          <button onClick={() => setView('list')} className={cn('rounded-md p-1.5', view === 'list' ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted hover:text-ink-primary')} aria-label="Tampilan list">
              <List className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Devices */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Monitor className="h-7 w-7" />} title="Tidak ada PC ditemukan" description="Coba ubah filter atau pilih laboratorium lain." />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          {filtered.map((d) => (
            <PCIconCard key={d.id} device={d} onClick={setSelected} selected={selected?.id === d.id} />
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-2 font-medium">Posisi</th>
                  <th className="px-4 py-2 font-medium">Hostname</th>
                  <th className="px-4 py-2 font-medium">IP</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">CPU</th>
                  <th className="px-4 py-2 font-medium">RAM</th>
                  <th className="px-4 py-2 font-medium">Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} onClick={() => setSelected(d)} className="cursor-pointer border-b border-base-700/40 hover:bg-base-700/30">
                    <td className="px-4 py-2 font-medium text-ink-primary">{d.positionCode}</td>
                    <td className="px-4 py-2 text-ink-secondary">{d.hostname}</td>
                    <td className="px-4 py-2 text-ink-muted">{d.ipAddress}</td>
                    <td className="px-4 py-2"><StatusBadge status={d.status} /></td>
                    <td className="px-4 py-2 text-ink-secondary">{Math.round(d.cpuUsage)}%</td>
                    <td className="px-4 py-2 text-ink-secondary">{Math.round(d.ramUsage)}%</td>
                    <td className="px-4 py-2 text-ink-muted">{relativeTime(d.lastHeartbeat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Detail drawer */}
      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.hostname} · ${selected.positionCode}` : ''}
        description={selected ? `Aset ${selected.assetCode} · ${selected.brand} ${selected.model}` : ''}
        width="max-w-2xl"
      >
        {selected && (
          <DeviceDetail
            device={selected}
            asset={selectedAsset ?? undefined}
            incidents={selectedIncidents}
            maintenance={selectedMaint}
            onStatusChange={(s) => handleStatusChange(selected, s)}
            onCreateIncident={() => createIncidentFromDevice(selected)}
            onScheduleMaintenance={() => scheduleMaintenance(selected)}
            canUpdateStatus={canUpdateMonitoring}
            canCreateIncident={canCreateIncident}
            canScheduleMaintenance={canScheduleMaintenance}
          />
        )}
      </Drawer>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'success' | 'muted' | 'warning' | 'danger' | 'orange' }) {
  const toneClass: Record<typeof tone, string> = {
    neutral: 'text-ink-primary',
    success: 'text-success-foreground',
    muted: 'text-ink-muted',
    warning: 'text-warning-foreground',
    danger: 'text-danger',
    orange: 'text-orange-foreground',
  };
  return (
    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-2 text-center">
      <p className={cn('text-lg font-bold', toneClass[tone])}>{value}</p>
      <p className="text-[10px] text-ink-muted">{label}</p>
    </div>
  );
}

function DeviceDetail({ device, asset, incidents, maintenance, onStatusChange, onCreateIncident, onScheduleMaintenance, canUpdateStatus, canCreateIncident, canScheduleMaintenance }: {
  device: Device;
  asset?: Asset;
  incidents: Incident[];
  maintenance: MaintenanceExecution[];
  onStatusChange: (s: DeviceStatus) => void;
  onCreateIncident: () => void;
  onScheduleMaintenance: () => void;
  canUpdateStatus: boolean;
  canCreateIncident: boolean;
  canScheduleMaintenance: boolean;
}) {
  const [tab, setTab] = useState('overview');
  const statuses: DeviceStatus[] = ['Online', 'Offline', 'Warning', 'Critical', 'Maintenance', 'Reserved'];

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'spec', label: 'Spesifikasi' },
    { key: 'realtime', label: 'Realtime' },
    { key: 'peripherals', label: 'Periferal' },
    { key: 'history', label: 'Riwayat' },
    { key: 'actions', label: 'Quick Actions' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-base-700 bg-base-800/60 p-4">
        <div className={cn('flex h-14 w-14 items-center justify-center rounded-xl', device.status === 'Online' ? 'bg-success/15 text-success-foreground' : device.status === 'Critical' ? 'bg-danger/15 text-danger' : device.status === 'Maintenance' ? 'bg-orange/15 text-orange-foreground' : 'bg-base-700 text-ink-muted')}>
          <Monitor className="h-7 w-7" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-ink-primary">{device.hostname}</p>
          <p className="text-xs text-ink-muted">{device.brand} {device.model} · {device.os}</p>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="space-y-3">
          <DetailRow icon={<Tag className="h-4 w-4" />} label="Kode Aset" value={device.assetCode} />
          <DetailRow icon={<Map className="h-4 w-4" />} label="Posisi" value={device.positionCode} />
          <DetailRow icon={<Server className="h-4 w-4" />} label="Hostname" value={device.hostname} />
          <DetailRow icon={<Tag className="h-4 w-4" />} label="IP Address" value={device.ipAddress} />
          <DetailRow icon={<Tag className="h-4 w-4" />} label="MAC Address" value={device.macAddress} />
          <DetailRow icon={<Tag className="h-4 w-4" />} label="Serial Number" value={device.serialNumber} />
          <DetailRow icon={<Tag className="h-4 w-4" />} label="Merek / Model" value={`${device.brand} ${device.model}`} />
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Tahun Perolehan" value={String(device.yearAcquired)} />
          {asset && (
            <>
              <DetailRow icon={<Activity className="h-4 w-4" />} label="Kondisi" value={<ConditionBadge condition={asset.condition} />} />
              <DetailRow icon={<Tag className="h-4 w-4" />} label="Harga" value={new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(asset.price)} />
            </>
          )}
        </div>
      )}

      {tab === 'spec' && (
        <div className="space-y-3">
          <DetailRow icon={<Cpu className="h-4 w-4" />} label="Processor" value={device.processor} />
          <DetailRow icon={<MemoryStick className="h-4 w-4" />} label="RAM" value={`${device.ramGB} GB`} />
          <DetailRow icon={<HardDrive className="h-4 w-4" />} label="Storage" value={`${device.storageGB} GB`} />
          <DetailRow icon={<Activity className="h-4 w-4" />} label="GPU" value={device.gpu} />
          <DetailRow icon={<Monitor className="h-4 w-4" />} label="Monitor" value={device.monitor} />
          <DetailRow icon={<Server className="h-4 w-4" />} label="OS" value={device.os} />
        </div>
      )}

      {tab === 'realtime' && (
        <div className="space-y-3">
          <MetricBar icon={<Cpu className="h-4 w-4" />} label="CPU Usage" value={device.cpuUsage} max={100} unit="%" tone={device.cpuUsage > 80 ? 'danger' : device.cpuUsage > 60 ? 'warning' : 'success'} />
          <MetricBar icon={<MemoryStick className="h-4 w-4" />} label="RAM Usage" value={device.ramUsage} max={100} unit="%" tone={device.ramUsage > 80 ? 'danger' : device.ramUsage > 60 ? 'warning' : 'success'} />
          <MetricBar icon={<HardDrive className="h-4 w-4" />} label="Disk Usage" value={device.diskUsage} max={100} unit="%" tone={device.diskUsage > 85 ? 'danger' : device.diskUsage > 70 ? 'warning' : 'success'} />
          <MetricBar icon={<Thermometer className="h-4 w-4" />} label="Suhu" value={device.temperature} max={100} unit="°C" tone={device.temperature > 80 ? 'danger' : device.temperature > 65 ? 'warning' : 'success'} />
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Uptime" value={`${device.uptimeHours} jam`} />
          <DetailRow icon={device.network === 'Connected' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />} label="Network" value={device.network} />
          <DetailRow icon={<Clock className="h-4 w-4" />} label="Last Heartbeat" value={relativeTime(device.lastHeartbeat)} />
        </div>
      )}

      {tab === 'peripherals' && (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(device.peripherals).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-base-700/60 bg-base-800/40 p-3">
              <span className="text-sm capitalize text-ink-secondary">{key}</span>
              <Badge tone={val ? 'success' : 'danger'}>{val ? 'Tersedia' : 'Tidak'}</Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Incident</p>
            {incidents.length === 0 ? <EmptyState title="Belum ada incident" className="py-4" /> : (
              <div className="space-y-2">
                {incidents.map((i) => (
                  <div key={i.id} className="rounded-lg border border-base-700/60 bg-base-800/40 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink-primary">{i.ticketNumber}</p>
                      <StatusBadge status={i.status} />
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{i.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Maintenance</p>
            {maintenance.length === 0 ? <EmptyState title="Belum ada maintenance" className="py-4" /> : (
              <div className="space-y-2">
                {maintenance.map((m) => (
                  <div key={m.id} className="rounded-lg border border-base-700/60 bg-base-800/40 p-3">
                    <p className="text-sm font-medium text-ink-primary">{m.date}</p>
                    <p className="mt-1 text-xs text-ink-muted">{m.findings || 'Tidak ada temuan'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div className="space-y-3">
          {canUpdateStatus && <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Ubah Status</p>
            <div className="grid grid-cols-3 gap-2">
              {statuses.map((s) => (
                <button
                  key={s}
                  onClick={() => onStatusChange(s)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    device.status === s ? 'border-accent-primary bg-accent-primary/15 text-accent-primary' : 'border-base-700 text-ink-secondary hover:bg-base-700/40'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>}
          <div className="grid gap-2 pt-2">
            {canCreateIncident && <Button variant="danger" size="sm" icon={<AlertTriangle className="h-4 w-4" />} onClick={onCreateIncident} className="w-full justify-start">
              Buat Tiket Kerusakan
            </Button>}
            {canScheduleMaintenance && <Button variant="warning" size="sm" icon={<Wrench className="h-4 w-4" />} onClick={onScheduleMaintenance} className="w-full justify-start">
              Jadwalkan Pemeliharaan
            </Button>}
            {canUpdateStatus && <Button variant="secondary" size="sm" icon={<XCircle className="h-4 w-4" />} onClick={() => onStatusChange('Offline')} className="w-full justify-start">
              Tandai Offline
            </Button>}
            {canUpdateStatus && <Button variant="secondary" size="sm" icon={<Wrench className="h-4 w-4" />} onClick={() => onStatusChange('Maintenance')} className="w-full justify-start">
              Mode Maintenance
            </Button>}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-ink-muted">
        {icon}
        {label}
      </span>
      <span className="text-sm font-medium text-ink-primary text-right">{value}</span>
    </div>
  );
}

function MetricBar({ icon, label, value, max, unit, tone }: { icon: React.ReactNode; label: string; value: number; max: number; unit: string; tone: 'success' | 'warning' | 'danger' }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-danger';
  return (
    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-2 text-ink-muted">{icon}{label}</span>
        <span className="font-semibold text-ink-primary">{Math.round(value)}{unit}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-base-700">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
