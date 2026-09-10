import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  FlaskConical,
  Plus,
  RefreshCw,
  Wrench,
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
import { workOrderGateway, type WorkOrderDto, type WorkOrderPriority, type WorkOrderStatus } from '@/services/workOrderApi';

interface DashboardCanonicalState {
  laboratories: LaboratoryDto[];
  deviceTotal: number;
  incidentTotal: number;
  recentIncidents: IncidentListItem[];
  activeWorkOrders: WorkOrderDto[];
}

const EMPTY_STATE: DashboardCanonicalState = {
  laboratories: [],
  deviceTotal: 0,
  incidentTotal: 0,
  recentIncidents: [],
  activeWorkOrders: [],
};

const ACTIVE_WORK_ORDER_STATUSES = ['draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part', 'completed'] as const;

const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  draft: 'Draft',
  assigned: 'Ditugaskan',
  in_progress: 'Berlangsung',
  on_hold: 'Ditahan',
  waiting_part: 'Menunggu Part',
  completed: 'Selesai Teknis',
  verified: 'Terverifikasi',
  cancelled: 'Dibatalkan',
};

const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: 'Rendah',
  normal: 'Normal',
  high: 'Tinggi',
  critical: 'Kritis',
};

const WORK_ORDER_PRIORITY_WEIGHT: Record<WorkOrderPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  critical: 4,
};

const WORK_ORDER_STATUS_WEIGHT: Record<WorkOrderStatus, number> = {
  draft: 1,
  assigned: 3,
  in_progress: 6,
  on_hold: 4,
  waiting_part: 5,
  completed: 2,
  verified: 0,
  cancelled: 0,
};

function workOrderStatusTone(status: WorkOrderStatus): 'muted' | 'info' | 'warning' | 'success' | 'danger' {
  if (status === 'verified') return 'success';
  if (status === 'completed' || status === 'assigned') return 'info';
  if (status === 'in_progress' || status === 'waiting_part' || status === 'on_hold') return 'warning';
  if (status === 'cancelled') return 'danger';
  return 'muted';
}

function workOrderPriorityTone(priority: WorkOrderPriority): 'muted' | 'info' | 'warning' | 'danger' {
  if (priority === 'critical') return 'danger';
  if (priority === 'high') return 'warning';
  if (priority === 'normal') return 'info';
  return 'muted';
}

const PENDING_SERVER_DOMAINS = [
  'Monitoring Telemetri',
  'Notifikasi',
  'Laporan & Analitik',
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
  const canViewWorkOrders = hasServerPermission(user, 'work-orders.view');
  const canUpdateWorkOrders = hasServerPermission(user, 'work-orders.update');
  const canAssignWorkOrders = hasServerPermission(user, 'work-orders.assign');
  const canApproveWorkOrders = hasServerPermission(user, 'work-orders.approve');
  const personalWorkOrderScope = canViewWorkOrders && canUpdateWorkOrders && !canAssignWorkOrders && !canApproveWorkOrders;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const laboratories = canViewLaboratories ? await laboratoryGateway.list() : [];
      const selectedLaboratoryId = laboratories.some((laboratory) => laboratory.id === activeLabId)
        ? activeLabId
        : undefined;

      const [devicePage, incidentPage, workOrders] = await Promise.all([
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
        canViewWorkOrders ? workOrderGateway.listAll() : Promise.resolve([]),
      ]);

      const activeWorkOrders = workOrders
        .filter((workOrder) => (ACTIVE_WORK_ORDER_STATUSES as readonly WorkOrderStatus[]).includes(workOrder.status))
        .filter((workOrder) => !selectedLaboratoryId || workOrder.laboratoryId === selectedLaboratoryId)
        .filter((workOrder) => !personalWorkOrderScope || workOrder.assigneeMembershipId === user?.membership.id)
        .sort((left, right) =>
          WORK_ORDER_PRIORITY_WEIGHT[right.priority] - WORK_ORDER_PRIORITY_WEIGHT[left.priority]
          || WORK_ORDER_STATUS_WEIGHT[right.status] - WORK_ORDER_STATUS_WEIGHT[left.status]
          || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

      setState({
        laboratories,
        deviceTotal: devicePage?.meta.total ?? 0,
        incidentTotal: incidentPage?.meta.total ?? 0,
        recentIncidents: incidentPage?.data ?? [],
        activeWorkOrders,
      });
    } catch {
      setState(EMPTY_STATE);
      setError('Ringkasan server tidak dapat dimuat. Coba muat ulang setelah memastikan API aktif.');
    } finally {
      setLoading(false);
    }
  }, [activeLabId, canViewDevices, canViewIncidents, canViewLaboratories, canViewWorkOrders, personalWorkOrderScope, user?.membership.id]);

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
      ...(canViewWorkOrders ? [{ metric: personalWorkOrderScope ? 'Work Order Saya' : 'Work Order Aktif', value: state.activeWorkOrders.length }] : []),
    ]);
  }

  const workOrderPanelTitle = personalWorkOrderScope ? 'Work Order Saya' : 'Work Order Aktif';
  const workOrderPanelDescription = personalWorkOrderScope
    ? 'Pekerjaan aktif yang ditugaskan pada membership Anda.'
    : 'Pekerjaan aktif dalam scope Laboratorium yang sedang dipilih.';

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
          label={selectedLaboratory ? 'Perangkat (Lab ini)' : 'Perangkat Terkelola'}
          value={canViewDevices && !error ? state.deviceTotal : '—'}
          icon={<Boxes className="h-5 w-5" />}
          tone="success"
          to={canViewDevices ? '/devices' : undefined}
        />
        <StatCard
          label={selectedLaboratory ? 'Tiket Aktif (Lab ini)' : 'Tiket Kerusakan'}
          value={canViewIncidents && !error ? state.incidentTotal : '—'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="warning"
          to={canViewIncidents ? '/incidents' : undefined}
        />
        <StatCard
          label={personalWorkOrderScope ? 'Work Order Saya' : selectedLaboratory ? 'Work Order Aktif (Lab ini)' : 'Work Order Aktif'}
          value={canViewWorkOrders && !error ? state.activeWorkOrders.length : '—'}
          icon={<Wrench className="h-5 w-5" />}
          tone={state.activeWorkOrders.length > 0 ? 'warning' : 'neutral'}
          to={canViewWorkOrders ? '/work-orders' : undefined}
        />
      </div>

      {canViewWorkOrders && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>{workOrderPanelTitle}</CardTitle>
              <p className="mt-1 text-xs text-ink-muted">{workOrderPanelDescription}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={state.activeWorkOrders.length > 0 ? 'warning' : 'muted'}>{state.activeWorkOrders.length}</Badge>
              <Link to="/work-orders" className="text-xs text-accent-content hover:underline">Lihat semua</Link>
            </div>
          </CardHeader>
          <CardContent>
            {state.activeWorkOrders.length === 0 ? (
              <EmptyState
                title={personalWorkOrderScope ? 'Tidak ada Work Order untuk saya' : 'Tidak ada Work Order aktif'}
                description={personalWorkOrderScope
                  ? 'Work Order baru akan muncul setelah membership ini ditugaskan sebagai teknisi.'
                  : 'Work Order draft, ditugaskan, berlangsung, tertahan, menunggu part, atau selesai teknis akan muncul di sini.'}
                className="py-8"
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {state.activeWorkOrders.slice(0, 5).map((workOrder) => (
                  <Link
                    key={workOrder.id}
                    to={`/work-orders/${workOrder.id}`}
                    className="rounded-xl border border-base-700/70 bg-base-800/50 p-4 transition-colors hover:border-base-600"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-accent-content">{workOrder.workOrderNumber}</p>
                        <p className="mt-1 truncate text-xs text-ink-secondary">{workOrder.assetCodeSnapshot} · {workOrder.assetNameSnapshot}</p>
                        <p className="mt-1 truncate text-xs text-ink-muted">{workOrder.laboratoryNameSnapshot} · {workOrder.scheduledFor ?? 'Tanpa jadwal'}</p>
                      </div>
                      <Wrench className="h-4 w-4 shrink-0 text-ink-muted" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge tone={workOrderPriorityTone(workOrder.priority)}>{WORK_ORDER_PRIORITY_LABELS[workOrder.priority]}</Badge>
                      <Badge tone={workOrderStatusTone(workOrder.status)}>{WORK_ORDER_STATUS_LABELS[workOrder.status]}</Badge>
                    </div>
                    {!personalWorkOrderScope && workOrder.assigneeNameSnapshot && (
                      <p className="mt-2 truncate text-[11px] text-ink-muted">Teknisi: {workOrder.assigneeNameSnapshot}</p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
            <p>Laboratorium, perangkat, tiket, dan Work Order pada Dashboard berasal dari API Laravel + PostgreSQL.</p>
            <p>Konteks Lab mengikuti selector global di topbar. Pilih “Semua Laboratorium” untuk ringkasan sekolah.</p>
            <p>Telemetri realtime tetap ditahan sampai S6; Dashboard tidak mengisi kekosongan dengan data seed/browser.</p>
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
            <CardTitle>Domain Belum Canonical</CardTitle>
            <Badge tone="warning">Roadmap</Badge>
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
