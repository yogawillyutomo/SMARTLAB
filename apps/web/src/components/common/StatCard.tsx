import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { cn } from '@/utils';
import { Card } from '@/components/ui/Card';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'orange';
  delta?: number;
  deltaLabel?: string;
  to?: string;
  onClick?: () => void;
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  accent: 'bg-accent-blue/15 text-accent-blue',
  success: 'bg-success/15 text-success-foreground',
  warning: 'bg-warning/15 text-warning-foreground',
  danger: 'bg-danger/15 text-danger-foreground',
  info: 'bg-accent-blue/15 text-accent-blue',
  neutral: 'bg-base-700/60 text-ink-secondary',
  orange: 'bg-orange/15 text-orange-foreground',
};

export function StatCard({ label, value, icon, tone = 'accent', delta, deltaLabel, to, onClick }: StatCardProps) {
  const inner = (
    <Card hover={Boolean(to || onClick)} className={cn('p-5', (to || onClick) && 'cursor-pointer')}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-muted uppercase tracking-wide">{label}</p>
          <p className="mt-2 text-2xl font-bold text-ink-primary">{value}</p>
          {delta !== undefined && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              {delta > 0 ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-success-foreground" />
              ) : delta < 0 ? (
                <ArrowDownRight className="h-3.5 w-3.5 text-danger" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-ink-muted" />
              )}
              <span className={delta > 0 ? 'text-success-foreground' : delta < 0 ? 'text-danger' : 'text-ink-muted'}>
                {delta > 0 ? '+' : ''}
                {delta}%
              </span>
              {deltaLabel && <span className="text-ink-muted">{deltaLabel}</span>}
            </div>
          )}
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', toneClasses[tone])}>
          {icon}
        </div>
      </div>
    </Card>
  );

  if (to) return <Link to={to}>{inner}</Link>;
  if (onClick)
    return (
      <button onClick={onClick} className="text-left w-full">
        {inner}
      </button>
    );
  return inner;
}
