import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  FlaskConical,
  HandHelping,
  Monitor,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, LoadingState } from '@/components/ui/States';
import { downloadCSV } from '@/utils';
import { hasServerPermission } from '@/lib/authIdentity';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import { deviceGateway } from '@/services/deviceApi';
import { incidentGateway, type IncidentListItem } from '@/services/incidentApi';
import { INCIDENT_PRIORITY_LABELS, INCIDENT_STATUS_LABELS, incidentPriorityTone, incidentStatusTone } from '@/lib/incidentPresentation';

interface DashboardCanonicalState {
  laboratories: LaboratoryDto[];
  deviceTotal: number;
  incidentTotal: number;
  recentIncidents: IncidentListItem[];
}

const EMPTY_STATE: DashboardCanonicalState = {
  laboratories: [],
  deviceTotal: 0,
  incidentTotal: 0,
  recentIncidents: [],
};

const PENDING_SERVER_DOMAINS = [
  'Jadwal Reguler & Ketersediaan',
  'Reservasi Lab',
  'Pelaksanaan Lab & Jurnal',
  'Monitoring Telemetri',
  'Aset Tetap',
  'Stok & Spare Part',
  'Tugas Perbaikan',
  'Pemeliharaan Berkala',
  'Peminjaman Barang',
  'Kalender Akademik',
  'Notifikasi',
  'Laporan & Analitik',
  'Pengguna / Hak Akses Admin',
  'Master Data',
  'Audit Log',
  'Pengaturan Tenant',
] as const;

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const activeLabId = useUIStore((state) => state.activeLabId);
  const [state, setState] = useState<DashboardCanonicalState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canCreateIncident = hasServerPermission(user, 'incidents.create');
  const canViewDevices = hasServerPermission(user, 'devices.view');
  const canViewIncidents = hasServerPermission(user, 'incidents.view');
  const canViewLaboratories = hasServerPermission(user, 'laboratories.view');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const laboratories = canViewLaboratories ? await laboratoryGateway.list() : [];
      const selectedLaboratoryId = laboratories.some((laboratory) => laboratory.id === activeLabId)
        ? activeLabId
        : undefined;

      const [devicePage, incidentPage] = await Promise.all([
        canViewDevices
          ? deviceGateway.list({
              page: 1,
              perPage: 1,
              ...(selectedLaboratoryId ? { homeLaboratoryId: selectedLaboratoryId } : {}),
            })
          : Promise.resolve(null),
        canViewIncidents
          ? incidentGateway.list({
              page: 1,
              perPage: 5,
              ...(selectedLaboratoryId ? { laboratoryId: selectedLaboratoryId } : {}),
            })
          : Promise.resolve(null),
      ]);

      setState({
        laboratories,
        deviceTotal: devicePage?.meta.total ?? 0,
        incidentTotal: incidentPage?.meta.total ?? 0,
        recentIncidents: incidentPage?.data ?? [],
      });
    } catch {
      setState(EMPTY_STATE);
      setError('Ringkasan server tidak dapat dimuat. Coba muat ulang setelah memastikan API aktif.');
    } finally {
      setLoading(false);
    }
  }, [activeLabId, canViewDevices, canViewIncidents, canViewLaboratories]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeLaboratories = useMemo(
    () => state.laboratories.filter((laboratory) => laboratory.status === 'active'),
    [state.laboratories],
  );

  const selectedLaboratory = state.laboratories.find((laboratory) => laboratory.id === activeLabId) ?? null;

  function handleExport() {
    downloadCSV('dashboard-canonical-stats.csv', [
      { metric: 'Laboratorium Aktif', value: activeLaboratories.length },
      { metric: selectedLaboratory ? `Perangkat Terkelola - ${selectedLaboratory.name}` : 'Perangkat Terkelola', value: state.deviceTotal },
      { metric: selectedLaboratory ? `Tiket Kerusakan - ${selectedLaboratory.name}` : 'Tiket Kerusakan', value: state.incidentTotal },
    ]);
  }

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam';
  const scopeLabel = selectedLaboratory?.name ?? 'Semua Laboratorium';

  if (loading && state === EMPTY_STATE) return <LoadingState />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting}, ${user?.name?.split(' ').slice(0, 2).join(' ') ?? ''}`}
        description={`${scopeLabel} · ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        icon={<FlaskConical className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} onClick={() => void load()} disabled={loading}>
              Muat Ulang
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={loading || Boolean(error)}>
              Export Ringkasan
            </Button>
            {canCreateIncident && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => (window.location.href = '/incidents')}>
                Buat Tiket
              </Button>
            )}
          </>
        }
      />

      {error && (
        <Card className="border-danger/40 bg-danger/5">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-danger">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Laboratorium Aktif"
          value={canViewLaboratories && !error ? activeLaboratories.length : '—'}
          icon={<FlaskConical className="h-5 w-5" />}
          tone="accent"
          to={canViewLaboratories ? '/laboratories' : undefined}
        />
        <StatCard
          label={selectedLaboratory ? 'Perangkat Terkelola (Lab ini)' : 'Perangkat Terkelola'}
          value={canViewDevices && !error ? state.deviceTotal : '—'}
          icon={<Boxes className="h-5 w-5" />}
          tone="success"
          to={canViewDevices ? '/devices' : undefined}
        />
        <StatCard
          label={selectedLaboratory ? 'Tiket Kerusakan (Lab ini)' : 'Tiket Kerusakan'}
          value={canViewIncidents && !error ? state.incidentTotal : '—'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="warning"
          to={canViewIncidents ? '/incidents' : undefined}
        />
        <StatCard label="Monitoring Realtime" value="—" icon={<Monitor className="h-5 w-5" />} tone="neutral" />
        <StatCard label="Jadwal Reguler Hari Ini" value="—" icon={<BookOpen className="h-5 w-5" />} tone="neutral" />
        <StatCard label="Pemeliharaan Jatuh Tempo" value="—" icon={<ShieldCheck className="h-5 w-5" />} tone="neutral" />
        <StatCard label="Barang Dipinjam" value="—" icon={<HandHelping className="h-5 w-5" />} tone="neutral" />
        <StatCard label="Stok Hampir Habis" value="—" icon={<Package className="h-5 w-5" />} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Status Laboratorium</CardTitle>
            {canViewLaboratories && <Link to="/laboratories" className="text-xs text-accent-content hover:underline">Lihat semua</Link>}
          </CardHeader>
          <CardContent>
            {!canViewLaboratories ? (
              <EmptyState title="Akses Laboratorium tidak tersedia" description="Ringkasan mengikuti permission server pada membership aktif." className="py-8" />
            ) : state.laboratories.length === 0 ? (
              <EmptyState title="Belum ada laboratorium" description="Dashboard dan halaman Laboratorium membaca sumber PostgreSQL yang sama." className="py-8" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {state.laboratories.map((laboratory) => (
                  <Link
                    key={laboratory.id}
                    to={`/laboratories/${laboratory.id}`}
                    className="rounded-xl border border-base-700/70 bg-base-800/60 p-4 transition-colors hover:border-base-600"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-primary">{laboratory.name}</p>
                        <p className="truncate text-xs text-ink-muted">{laboratory.code} · {laboratory.location}</p>
                      </div>
                      <Badge tone={laboratory.status === 'active' ? 'success' : 'muted'}>
                        {laboratory.status === 'active' ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </div>
                    <p className="mt-3 text-xs text-ink-muted">Kapasitas <span className="font-semibold text-ink-secondary">{laboratory.capacity}</span></p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Source of Truth</CardTitle>
            <Badge tone="success">Server</Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-ink-muted">
            <p>Laboratorium, perangkat, dan tiket pada Dashboard berasal dari API Laravel + PostgreSQL.</p>
            <p>Angka `—` berarti domain tersebut belum memiliki API canonical; Dashboard tidak lagi mengambil nilai seed/browser untuk mengisi kekosongan.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tiket Kerusakan Terbaru</CardTitle>
            {canViewIncidents && <Link to="/incidents" className="text-xs text-accent-content hover:underline">Lihat semua</Link>}
          </CardHeader>
          <CardContent className="space-y-3">
            {!canViewIncidents ? (
              <EmptyState title="Akses Incident tidak tersedia" className="py-8" />
            ) : state.recentIncidents.length === 0 ? (
              <EmptyState title="Belum ada tiket kerusakan" description="Tiket baru akan tampil dari Incident API." className="py-8" />
            ) : (
              state.recentIncidents.map((incident) => (
                <Link
                  key={incident.id}
                  to={`/incidents/${incident.id}`}
                  className="block rounded-lg border border-base-700/60 bg-base-800/40 p-3 transition-colors hover:border-base-600"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-primary">{incident.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">{incident.ticketNumber} · {incident.laboratory.name}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge tone={incidentPriorityTone(incident.priority)}>{INCIDENT_PRIORITY_LABELS[incident.priority]}</Badge>
                      <Badge tone={incidentStatusTone(incident.status)}>{INCIDENT_STATUS_LABELS[incident.status]}</Badge>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Domain Dalam Migrasi API</CardTitle>
            <Badge tone="warning">Bertahap</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {PENDING_SERVER_DOMAINS.map((domain) => (
                <div key={domain} className="flex items-center justify-between gap-2 rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-2">
                  <span className="text-xs text-ink-secondary">{domain}</span>
                  <Badge tone="muted">Belum API</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
