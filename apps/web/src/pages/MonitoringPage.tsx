import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  Cpu,
  Eye,
  FlaskConical,
  HardDrive,
  LayoutGrid,
  List,
  MemoryStick,
  Monitor,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { Input, Select } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/utils';
import { useUIStore } from '@/stores/uiStore';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import {
  DEVICE_LIFECYCLE_STATUSES,
  DEVICE_TYPES,
  deviceGateway,
  type DeviceDto,
  type DeviceLifecycleStatus,
  type DeviceType,
} from '@/services/deviceApi';
import {
  DEVICE_LIFECYCLE_LABELS,
  DEVICE_PROFILE_FIELDS,
  DEVICE_TYPE_LABELS,
} from '@/lib/devicePresentation';

function lifecycleTone(status: DeviceLifecycleStatus): 'success' | 'info' | 'muted' | 'danger' {
  if (status === 'in_service') return 'success';
  if (status === 'spare') return 'info';
  if (status === 'retired') return 'muted';
  return 'danger';
}

function laboratoryLabel(laboratories: readonly LaboratoryDto[], id: string | null): string {
  if (id === null) return 'Belum ditetapkan';
  const laboratory = laboratories.find((item) => item.id === id);
  return laboratory ? `${laboratory.code} · ${laboratory.name}` : 'Laboratorium tidak tersedia';
}

function formatProfileValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (Array.isArray(value)) return value.join(', ');
  if (value === null || value === undefined || value === '') return 'Tidak tersedia';
  return String(value);
}

function deviceProfileRows(device: DeviceDto): Array<{ key: string; label: string; value: string }> {
  const profile = device.technicalProfile as Record<string, unknown>;
  if (device.deviceType === 'other') {
    return Object.entries(profile).map(([key, value]) => ({ key, label: key, value: formatProfileValue(value) }));
  }

  return DEVICE_PROFILE_FIELDS[device.deviceType]
    .filter((field) => profile[field.key] !== undefined)
    .map((field) => ({
      key: field.key,
      label: field.label,
      value: formatProfileValue(profile[field.key]),
    }));
}

function deviceHeadline(device: DeviceDto): string {
  return device.hostname ?? [device.brand, device.model].filter(Boolean).join(' ') || DEVICE_TYPE_LABELS[device.deviceType];
}

function desktopCapacity(device: DeviceDto): { ram: string; storage: string } {
  if (device.deviceType !== 'desktop_pc' && device.deviceType !== 'laptop' && device.deviceType !== 'server') {
    return { ram: '—', storage: '—' };
  }
  const profile = device.technicalProfile as Record<string, unknown>;
  return {
    ram: typeof profile.ramGB === 'number' ? `${profile.ramGB} GB` : '—',
    storage: typeof profile.storageGB === 'number' ? `${profile.storageGB} GB` : '—',
  };
}

export function MonitoringPage() {
  const navigate = useNavigate();
  const { deviceId } = useParams();
  const activeLabId = useUIStore((state) => state.activeLabId);
  const [laboratories, setLaboratories] = useState<LaboratoryDto[]>([]);
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [lifecycleStatus, setLifecycleStatus] = useState<DeviceLifecycleStatus | ''>('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<DeviceDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextLaboratories, firstPage] = await Promise.all([
        laboratoryGateway.list(),
        deviceGateway.list({
          page: 1,
          perPage: 100,
          ...(activeLabId ? { homeLaboratoryId: activeLabId } : {}),
        }),
      ]);
      const remaining = firstPage.meta.lastPage > 1
        ? await Promise.all(Array.from({ length: firstPage.meta.lastPage - 1 }, (_, index) =>
            deviceGateway.list({
              page: index + 2,
              perPage: 100,
              ...(activeLabId ? { homeLaboratoryId: activeLabId } : {}),
            })))
        : [];

      setLaboratories(nextLaboratories);
      setDevices([...firstPage.data, ...remaining.flatMap((page) => page.data)]);
    } catch (loadError) {
      setLaboratories([]);
      setDevices([]);
      setError(loadError instanceof Error ? loadError.message : 'Monitoring perangkat tidak dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [activeLabId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!deviceId) {
      setSelected(null);
      return;
    }
    const match = devices.find((device) => device.id === deviceId) ?? null;
    setSelected(match);
  }, [deviceId, devices]);

  const activeLaboratory = laboratories.find((laboratory) => laboratory.id === activeLabId) ?? null;
  const scopeLabel = activeLaboratory ? `${activeLaboratory.code} · ${activeLaboratory.name}` : 'Semua Laboratorium';

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return devices.filter((device) => {
      if (deviceType && device.deviceType !== deviceType) return false;
      if (lifecycleStatus && device.lifecycleStatus !== lifecycleStatus) return false;
      if (!normalizedSearch) return true;
      return [
        device.deviceCode,
        device.hostname,
        device.serialNumber,
        device.brand,
        device.model,
      ].some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [deviceType, devices, lifecycleStatus, search]);

  const summary = useMemo(() => ({
    total: devices.length,
    inService: devices.filter((device) => device.lifecycleStatus === 'in_service').length,
    spare: devices.filter((device) => device.lifecycleStatus === 'spare').length,
  }), [devices]);

  function openDevice(device: DeviceDto) {
    setSelected(device);
    navigate(`/monitoring/${device.id}`);
  }

  function closeDevice() {
    setSelected(null);
    navigate('/monitoring');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring Perangkat"
        description={`${scopeLabel} · inventaris Device canonical. Telemetri realtime tetap ditahan sampai S6.`}
        icon={<Monitor className="h-5 w-5" />}
        actions={
          <>
            {activeLabId && (
              <Button
                variant="secondary"
                size="sm"
                icon={<FlaskConical className="h-4 w-4" />}
                onClick={() => navigate(`/laboratories/${activeLabId}/layout`)}
              >
                Denah Lab
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />} onClick={() => void load()} disabled={loading}>
              Muat Ulang
            </Button>
          </>
        }
      />

      <div className="rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
        <p className="font-medium">Monitoring realtime belum aktif.</p>
        <p className="mt-1 text-xs opacity-90">
          Halaman ini hanya membaca Device canonical dari API Laravel + PostgreSQL. Heartbeat, CPU/RAM usage, suhu, network status, dan alert realtime akan masuk pada S6 Monitoring; tidak ada simulasi atau mutation browser-local.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={activeLaboratory ? 'Perangkat Lab ini' : 'Perangkat Terkelola'} value={summary.total} icon={<Monitor className="h-5 w-5" />} tone="accent" to="/devices" />
        <StatCard label="Dalam Layanan" value={summary.inService} icon={<Server className="h-5 w-5" />} tone="success" />
        <StatCard label="Cadangan" value={summary.spare} icon={<Cpu className="h-5 w-5" />} tone="info" />
        <StatCard label="Telemetri Realtime" value="—" icon={<Activity className="h-5 w-5" />} tone="neutral" />
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Perangkat dalam Konteks Aktif</CardTitle>
            <p className="mt-1 text-xs text-ink-muted">Filter Lab mengikuti selector global di topbar. Filter di bawah hanya mempersempit Device dalam konteks tersebut.</p>
          </div>
          <Badge tone="success">Server</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:min-w-64 sm:flex-1">
            <Input
              label="Pencarian"
              icon={<Search className="h-4 w-4" />}
              value={search}
              placeholder="Kode, hostname, serial, merek, atau model"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              label="Jenis"
              value={deviceType}
              placeholder="Semua jenis"
              options={DEVICE_TYPES.map((value) => ({ value, label: DEVICE_TYPE_LABELS[value] }))}
              onChange={(event) => setDeviceType(event.target.value as DeviceType | '')}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              label="Lifecycle"
              value={lifecycleStatus}
              placeholder="Semua lifecycle"
              options={DEVICE_LIFECYCLE_STATUSES.map((value) => ({ value, label: DEVICE_LIFECYCLE_LABELS[value] }))}
              onChange={(event) => setLifecycleStatus(event.target.value as DeviceLifecycleStatus | '')}
            />
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-base-700 p-1">
            <button type="button" onClick={() => setView('grid')} className={cn('rounded-md p-1.5', view === 'grid' ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted hover:text-ink-primary')} aria-label="Tampilan grid">
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setView('list')} className={cn('rounded-md p-1.5', view === 'list' ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted hover:text-ink-primary')} aria-label="Tampilan list">
              <List className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <Card><LoadingState label="Memuat Device canonical..." /></Card>
      ) : error ? (
        <Card><ErrorState message={error} onRetry={() => void load()} /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Monitor className="h-7 w-7" />}
            title="Tidak ada perangkat pada konteks ini"
            description={activeLaboratory
              ? `Tidak ada Device canonical yang cocok di ${activeLaboratory.name}.`
              : 'Tidak ada Device canonical yang cocok dengan filter saat ini.'}
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((device) => {
            const capacity = desktopCapacity(device);
            return (
              <Card key={device.id} hover>
                <CardContent className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button type="button" className="truncate text-left text-sm font-semibold text-accent-content hover:underline" onClick={() => openDevice(device)}>
                        {device.deviceCode}
                      </button>
                      <p className="mt-1 truncate text-xs text-ink-secondary">{deviceHeadline(device)}</p>
                    </div>
                    <Badge tone={lifecycleTone(device.lifecycleStatus)}>{DEVICE_LIFECYCLE_LABELS[device.lifecycleStatus]}</Badge>
                  </div>

                  <dl className="space-y-2 rounded-lg bg-base-700/30 p-3 text-xs">
                    <DeviceRow label="Jenis" value={DEVICE_TYPE_LABELS[device.deviceType]} />
                    <DeviceRow label="Laboratorium" value={laboratoryLabel(laboratories, device.homeLaboratoryId)} />
                    <DeviceRow label="RAM" value={capacity.ram} />
                    <DeviceRow label="Penyimpanan" value={capacity.storage} />
                  </dl>

                  <div className="flex items-center justify-between border-t border-base-700/60 pt-3">
                    <span className="text-[11px] text-ink-muted">Realtime: belum S6</span>
                    <Button variant="secondary" size="sm" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => openDevice(device)}>Detail</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-xs text-ink-muted">
                  <th className="px-4 py-3 font-medium">Kode</th>
                  <th className="px-4 py-3 font-medium">Hostname / Identitas</th>
                  <th className="px-4 py-3 font-medium">Jenis</th>
                  <th className="px-4 py-3 font-medium">Laboratorium</th>
                  <th className="px-4 py-3 font-medium">Lifecycle</th>
                  <th className="px-4 py-3 font-medium">Realtime</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => (
                  <tr key={device.id} className="border-b border-base-700/40 hover:bg-base-700/20">
                    <td className="px-4 py-3">
                      <button type="button" className="font-medium text-accent-content hover:underline" onClick={() => openDevice(device)}>{device.deviceCode}</button>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{deviceHeadline(device)}</td>
                    <td className="px-4 py-3 text-ink-secondary">{DEVICE_TYPE_LABELS[device.deviceType]}</td>
                    <td className="px-4 py-3 text-ink-muted">{laboratoryLabel(laboratories, device.homeLaboratoryId)}</td>
                    <td className="px-4 py-3"><Badge tone={lifecycleTone(device.lifecycleStatus)}>{DEVICE_LIFECYCLE_LABELS[device.lifecycleStatus]}</Badge></td>
                    <td className="px-4 py-3 text-ink-muted">Belum S6</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && !error && (
        <p className="text-xs text-ink-muted">
          Menampilkan {filtered.length} dari {devices.length} Device pada konteks {scopeLabel}.
        </p>
      )}

      <Drawer
        open={Boolean(selected)}
        onClose={closeDevice}
        title={selected ? selected.deviceCode : ''}
        description={selected ? `${DEVICE_TYPE_LABELS[selected.deviceType]} · ${laboratoryLabel(laboratories, selected.homeLaboratoryId)}` : ''}
        width="max-w-2xl"
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-base-700 bg-base-800/60 p-4">
              <div>
                <p className="font-semibold text-ink-primary">{deviceHeadline(selected)}</p>
                <p className="mt-1 text-xs text-ink-muted">Device canonical · versi {selected.version}</p>
              </div>
              <Badge tone={lifecycleTone(selected.lifecycleStatus)}>{DEVICE_LIFECYCLE_LABELS[selected.lifecycleStatus]}</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <DetailRow icon={<Server className="h-4 w-4" />} label="Hostname" value={selected.hostname ?? 'Tidak tersedia'} />
              <DetailRow icon={<Cpu className="h-4 w-4" />} label="Serial" value={selected.serialNumber ?? 'Tidak tersedia'} />
              <DetailRow icon={<FlaskConical className="h-4 w-4" />} label="Laboratorium" value={laboratoryLabel(laboratories, selected.homeLaboratoryId)} />
              <DetailRow icon={<Monitor className="h-4 w-4" />} label="Merek / Model" value={[selected.brand, selected.model].filter(Boolean).join(' ') || 'Tidak tersedia'} />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Profil Teknis</p>
              {deviceProfileRows(selected).length === 0 ? (
                <EmptyState title="Profil teknis belum tersedia" className="py-5" />
              ) : (
                <div className="space-y-2">
                  {deviceProfileRows(selected).map((row) => (
                    <DetailRow
                      key={row.key}
                      icon={row.key === 'ramGB' ? <MemoryStick className="h-4 w-4" /> : row.key === 'storageGB' ? <HardDrive className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                      label={row.label}
                      value={row.value}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-base-700 bg-base-800/40 p-4">
              <p className="text-sm font-semibold text-ink-primary">Telemetri Realtime</p>
              <p className="mt-1 text-xs text-ink-muted">
                CPU usage, RAM usage, disk usage, suhu, network state, uptime, heartbeat, dan alert belum memiliki authority canonical. S6 akan menambahkan telemetry tanpa mengubah Device/Asset authority.
              </p>
            </div>

            <Button variant="secondary" size="sm" className="w-full" onClick={() => navigate(`/devices/${selected.id}`)}>
              Buka Detail Perangkat Canonical
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="break-words text-right text-ink-secondary">{value}</dd>
    </div>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-ink-muted">{icon}{label}</span>
      <span className="text-right text-sm font-medium text-ink-primary">{value}</span>
    </div>
  );
}
