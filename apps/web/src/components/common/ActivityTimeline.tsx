import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface TimelineItem {
  label: ReactNode;
  at?: string;
  by?: string;
  icon?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
}

const toneDot: Record<NonNullable<TimelineItem['tone']>, string> = {
  accent: 'bg-accent-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-base-600',
};

export function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">Belum ada aktivitas</p>;
  }
  return (
    <ol className="relative space-y-5 pl-6">
      <div className="absolute left-2 top-1.5 bottom-1.5 w-px bg-base-700" />
      {items.map((item, i) => (
        <li key={i} className="relative">
          <span
            className={cn(
              'absolute -left-[18px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full ring-4 ring-base-800',
              toneDot[item.tone ?? 'neutral']
            )}
          />
          <div className="text-sm text-ink-primary">{item.label}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
            {item.by && <span>{item.by}</span>}
            {item.by && item.at && <span>·</span>}
            {item.at && <span>{item.at}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
