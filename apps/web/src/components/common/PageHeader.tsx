import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-primary/15 text-accent-primary">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-primary sm:text-2xl truncate">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-ink-muted truncate">{description}</p>}
        </div>
      </div>
      {actions && <div className="print-hidden flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
