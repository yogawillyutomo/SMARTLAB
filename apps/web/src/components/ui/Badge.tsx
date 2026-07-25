import type { ReactNode } from 'react';
import { cn } from '@/utils';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  Pause,
  CircleDot,
  AlertCircle,
  Wrench,
  Lock,
  Calendar,
  FileText,
  Package,
  Server,
} from 'lucide-react';

type Tone =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'accent'
  | 'muted'
  | 'orange'
  | 'purple'
  | 'cyan';

const toneStyles: Record<Tone, string> = {
  neutral: 'bg-base-700/60 text-ink-secondary border-base-600',
  success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  accent: 'bg-accent-blue/15 text-accent-blue border-accent-blue/30',
  muted: 'bg-base-700/40 text-ink-muted border-base-600/60',
  orange: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  purple: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  cyan: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/30',
};

const toneIcons: Partial<Record<Tone, ReactNode>> = {
  success: <CheckCircle2 className="h-3.5 w-3.5" />,
  warning: <AlertTriangle className="h-3.5 w-3.5" />,
  danger: <XCircle className="h-3.5 w-3.5" />,
  info: <Info className="h-3.5 w-3.5" />,
  accent: <CircleDot className="h-3.5 w-3.5" />,
  muted: <CircleDot className="h-3.5 w-3.5" />,
  orange: <Wrench className="h-3.5 w-3.5" />,
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  withIcon?: boolean;
}

export function Badge({ tone = 'neutral', children, icon, className, withIcon }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        toneStyles[tone],
        className
      )}
    >
      {icon ?? (withIcon ? toneIcons[tone] : null)}
      {children}
    </span>
  );
}

// Status badge helpers — not color-only, includes icon
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: Tone; icon?: ReactNode }> = {
    // Device
    Online: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    Offline: { tone: 'muted', icon: <XCircle className="h-3 w-3" /> },
    Warning: { tone: 'warning', icon: <AlertTriangle className="h-3 w-3" /> },
    Critical: { tone: 'danger', icon: <AlertCircle className="h-3 w-3" /> },
    Maintenance: { tone: 'orange', icon: <Wrench className="h-3 w-3" /> },
    Reserved: { tone: 'info', icon: <Lock className="h-3 w-3" /> },
    // Incident
    Dilaporkan: { tone: 'info', icon: <Info className="h-3 w-3" /> },
    Diverifikasi: { tone: 'accent', icon: <CheckCircle2 className="h-3 w-3" /> },
    Ditugaskan: { tone: 'accent', icon: <CircleDot className="h-3 w-3" /> },
    Diproses: { tone: 'warning', icon: <Wrench className="h-3 w-3" /> },
    'Menunggu Spare Part': { tone: 'warning', icon: <Package className="h-3 w-3" /> },
    Selesai: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    Diuji: { tone: 'cyan', icon: <Server className="h-3 w-3" /> },
    Ditutup: { tone: 'muted', icon: <CheckCircle2 className="h-3 w-3" /> },
    Ditolak: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
    // Work order
    Draft: { tone: 'muted', icon: <FileText className="h-3 w-3" /> },
    Assigned: { tone: 'accent', icon: <CircleDot className="h-3 w-3" /> },
    'In Progress': { tone: 'warning', icon: <Wrench className="h-3 w-3" /> },
    'On Hold': { tone: 'muted', icon: <Pause className="h-3 w-3" /> },
    'Waiting Part': { tone: 'warning', icon: <Package className="h-3 w-3" /> },
    Completed: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    Verified: { tone: 'cyan', icon: <CheckCircle2 className="h-3 w-3" /> },
    Cancelled: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
    // Session / Journal
    'Belum Dimulai': { tone: 'muted', icon: <Clock className="h-3 w-3" /> },
    Berlangsung: { tone: 'warning', icon: <CircleDot className="h-3 w-3" /> },
    'Perlu Perbaikan': { tone: 'warning', icon: <AlertTriangle className="h-3 w-3" /> },
    Dibatalkan: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
    // Booking / Loan
    Diajukan: { tone: 'info', icon: <Info className="h-3 w-3" /> },
    'Menunggu Persetujuan': { tone: 'warning', icon: <Clock className="h-3 w-3" /> },
    Disetujui: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    Diserahkan: { tone: 'accent', icon: <Package className="h-3 w-3" /> },
    Dipinjam: { tone: 'accent', icon: <Package className="h-3 w-3" /> },
    Terlambat: { tone: 'danger', icon: <AlertTriangle className="h-3 w-3" /> },
    Dikembalikan: { tone: 'info', icon: <CheckCircle2 className="h-3 w-3" /> },
    Diperiksa: { tone: 'cyan', icon: <Server className="h-3 w-3" /> },
    // Asset
    Aktif: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    Cadangan: { tone: 'muted', icon: <Package className="h-3 w-3" /> },
    Rusak: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
    Hilang: { tone: 'danger', icon: <AlertCircle className="h-3 w-3" /> },
    Dihapuskan: { tone: 'muted', icon: <XCircle className="h-3 w-3" /> },
    // Lab
    active: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    inactive: { tone: 'muted', icon: <Pause className="h-3 w-3" /> },
    Tetap: { tone: 'accent', icon: <Calendar className="h-3 w-3" /> },
    Pengganti: { tone: 'warning', icon: <AlertTriangle className="h-3 w-3" /> },
  };
  const cfg = map[status] ?? { tone: 'neutral' as Tone, icon: <CircleDot className="h-3 w-3" /> };
  return (
    <Badge tone={cfg.tone} icon={cfg.icon}>
      {status}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, Tone> = {
    Rendah: 'muted',
    Normal: 'info',
    Tinggi: 'warning',
    Kritis: 'danger',
  };
  return <Badge tone={map[priority] ?? 'neutral'}>{priority}</Badge>;
}

export function ConditionBadge({ condition }: { condition: string }) {
  const map: Record<string, Tone> = {
    Baik: 'success',
    'Rusak Ringan': 'warning',
    'Rusak Sedang': 'orange',
    'Rusak Berat': 'danger',
    'Tidak Diketahui': 'muted',
  };
  return <Badge tone={map[condition] ?? 'neutral'}>{condition}</Badge>;
}
