import type { Device, DeviceStatus } from '@/types';

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatOptionalTelemetry(value: number | undefined, unit: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}${unit}` : 'Tidak tersedia';
}

export function simulateDeviceHeartbeat(
  device: Device,
  input: { at: string; cpuDelta: number; ramDelta: number },
): Device {
  const next = { ...device };
  if (next.status !== 'Online') return next;
  if (typeof next.cpuUsage === 'number' && Number.isFinite(next.cpuUsage)) {
    next.cpuUsage = clamp(next.cpuUsage + input.cpuDelta, 5, 95);
  }
  if (typeof next.ramUsage === 'number' && Number.isFinite(next.ramUsage)) {
    next.ramUsage = clamp(next.ramUsage + input.ramDelta, 15, 95);
  }
  if (next.lastHeartbeat !== undefined) next.lastHeartbeat = input.at;
  return next;
}

export function applyDeviceOperationalStatus(device: Device, status: DeviceStatus, changedAt: string): Device {
  const next = { ...device, status };
  if (next.lastHeartbeat !== undefined) next.lastHeartbeat = changedAt;
  if (next.network !== undefined) {
    next.network = status === 'Offline' ? 'Disconnected' : status === 'Warning' ? 'Limited' : 'Connected';
  }
  if (typeof next.cpuUsage === 'number' && Number.isFinite(next.cpuUsage)) {
    next.cpuUsage = status === 'Online' ? Math.max(5, next.cpuUsage) : 0;
  }
  if (typeof next.ramUsage === 'number' && Number.isFinite(next.ramUsage)) {
    next.ramUsage = status === 'Online' ? Math.max(15, next.ramUsage) : 0;
  }
  return next;
}
