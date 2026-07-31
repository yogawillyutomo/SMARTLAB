import { Monitor, MonitorCheck, MonitorX, AlertTriangle, Wrench, Lock, Cpu, MemoryStick, Wifi, WifiOff } from 'lucide-react';
import type { Device, DeviceStatus } from '@/types';
import { cn, relativeTime } from '@/utils';

interface PCIconCardProps {
  device: Device;
  onClick?: (device: Device) => void;
  selected?: boolean;
  compact?: boolean;
}

const statusConfig: Record<DeviceStatus, { ring: string; glow: string; icon: typeof Monitor; label: string }> = {
  Online: { ring: 'border-success/40 hover:border-success', glow: 'shadow-soft', icon: MonitorCheck, label: 'Online' },
  Offline: { ring: 'border-base-600 hover:border-base-600', glow: '', icon: MonitorX, label: 'Offline' },
  Warning: { ring: 'border-warning/50 hover:border-warning', glow: 'shadow-soft', icon: AlertTriangle, label: 'Warning' },
  Critical: { ring: 'border-danger/60 hover:border-danger', glow: 'shadow-soft', icon: MonitorX, label: 'Critical' },
  Maintenance: { ring: 'border-orange/50 hover:border-orange', glow: 'shadow-soft', icon: Wrench, label: 'Maintenance' },
  Reserved: { ring: 'border-accent-blue/50 hover:border-accent-blue', glow: 'shadow-soft', icon: Lock, label: 'Reserved' },
};

const statusDot: Record<DeviceStatus, string> = {
  Online: 'bg-success',
  Offline: 'bg-base-600',
  Warning: 'bg-warning',
  Critical: 'bg-danger animate-pulse-soft',
  Maintenance: 'bg-orange',
  Reserved: 'bg-accent-blue',
};

export function PCIconCard({ device, onClick, selected, compact }: PCIconCardProps) {
  const cfg = statusConfig[device.status];
  const Icon = cfg.icon;
  const isOnline = device.status === 'Online';
  const isProblem = device.status === 'Critical' || device.status === 'Warning' || device.status === 'Offline';

  return (
    <button
      onClick={() => onClick?.(device)}
      title={`${device.hostname} — ${device.status}`}
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-xl border-2 bg-base-800/80 p-3 text-center transition-all duration-200 hover:-translate-y-0.5',
        cfg.ring,
        cfg.glow,
        selected && 'ring-2 ring-accent-blue ring-offset-2 ring-offset-base-900',
        compact ? 'w-[72px]' : 'w-full'
      )}
    >
      {/* Status dot */}
      <span className={cn('absolute right-2 top-2 h-2 w-2 rounded-full', statusDot[device.status])} />

      {/* Monitor icon */}
      <div className={cn('relative', isProblem ? 'text-ink-muted' : 'text-ink-secondary')}>
      <Icon className={cn(compact ? 'h-7 w-7' : 'h-9 w-9', device.status === 'Critical' && 'text-danger-foreground', device.status === 'Warning' && 'text-warning-foreground')} />
        {device.status === 'Online' && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-base-800" />
        )}
      </div>

      <div className="space-y-0.5 w-full">
        <p className={cn('font-semibold text-ink-primary', compact ? 'text-[10px]' : 'text-xs')}>{device.positionCode}</p>
        {!compact && <p className="text-[10px] text-ink-muted truncate">{device.hostname}</p>}
      </div>

      {!compact && isOnline && (
        <div className="mt-1 flex w-full items-center justify-between gap-1 text-[10px] text-ink-muted">
          <span className="inline-flex items-center gap-0.5" title="CPU">
            <Cpu className="h-2.5 w-2.5" /> {Math.round(device.cpuUsage)}%
          </span>
          <span className="inline-flex items-center gap-0.5" title="RAM">
            <MemoryStick className="h-2.5 w-2.5" /> {Math.round(device.ramUsage)}%
          </span>
        </div>
      )}

      {!compact && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-muted">
          {device.network === 'Connected' ? (
            <Wifi className="h-2.5 w-2.5 text-success" />
          ) : device.network === 'Limited' ? (
            <AlertTriangle className="h-2.5 w-2.5 text-warning" />
          ) : (
            <WifiOff className="h-2.5 w-2.5 text-ink-muted" />
          )}
          <span>{relativeTime(device.lastHeartbeat)}</span>
        </div>
      )}
    </button>
  );
}

// Small status legend
export function PCStatusLegend() {
  const items: { status: DeviceStatus; color: string }[] = [
    { status: 'Online', color: 'bg-success' },
    { status: 'Offline', color: 'bg-base-600' },
    { status: 'Warning', color: 'bg-warning' },
    { status: 'Critical', color: 'bg-danger' },
    { status: 'Maintenance', color: 'bg-orange' },
    { status: 'Reserved', color: 'bg-accent-blue' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((it) => (
        <div key={it.status} className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={cn('h-2.5 w-2.5 rounded-full', it.color)} />
          {it.status}
        </div>
      ))}
    </div>
  );
}
