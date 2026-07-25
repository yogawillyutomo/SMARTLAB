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
  Online: { ring: 'border-emerald-500/40 hover:border-emerald-500', glow: 'shadow-[0_0_12px_-2px_rgba(16,185,129,0.4)]', icon: MonitorCheck, label: 'Online' },
  Offline: { ring: 'border-base-600 hover:border-base-500', glow: '', icon: MonitorX, label: 'Offline' },
  Warning: { ring: 'border-amber-500/50 hover:border-amber-500', glow: 'shadow-[0_0_12px_-2px_rgba(245,158,11,0.4)]', icon: AlertTriangle, label: 'Warning' },
  Critical: { ring: 'border-red-500/60 hover:border-red-500', glow: 'shadow-[0_0_14px_-2px_rgba(239,68,68,0.5)]', icon: MonitorX, label: 'Critical' },
  Maintenance: { ring: 'border-orange-500/50 hover:border-orange-500', glow: 'shadow-[0_0_12px_-2px_rgba(249,115,22,0.4)]', icon: Wrench, label: 'Maintenance' },
  Reserved: { ring: 'border-blue-500/50 hover:border-blue-500', glow: 'shadow-[0_0_12px_-2px_rgba(59,130,246,0.4)]', icon: Lock, label: 'Reserved' },
};

const statusDot: Record<DeviceStatus, string> = {
  Online: 'bg-emerald-500',
  Offline: 'bg-base-500',
  Warning: 'bg-amber-500',
  Critical: 'bg-red-500 animate-pulse-soft',
  Maintenance: 'bg-orange-500',
  Reserved: 'bg-blue-500',
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
        <Icon className={cn(compact ? 'h-7 w-7' : 'h-9 w-9', device.status === 'Critical' && 'text-red-400', device.status === 'Warning' && 'text-amber-400')} />
        {device.status === 'Online' && (
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-base-800" />
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
            <Wifi className="h-2.5 w-2.5 text-emerald-500" />
          ) : device.network === 'Limited' ? (
            <AlertTriangle className="h-2.5 w-2.5 text-amber-500" />
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
    { status: 'Online', color: 'bg-emerald-500' },
    { status: 'Offline', color: 'bg-base-500' },
    { status: 'Warning', color: 'bg-amber-500' },
    { status: 'Critical', color: 'bg-red-500' },
    { status: 'Maintenance', color: 'bg-orange-500' },
    { status: 'Reserved', color: 'bg-blue-500' },
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
