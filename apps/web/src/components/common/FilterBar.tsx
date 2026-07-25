import type { ReactNode } from 'react';
import { cn } from '@/utils';

interface FilterBarProps {
  children: ReactNode;
  className?: string;
}

export function FilterBar({ children, className }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-end gap-3 rounded-xl border border-base-700/70 bg-base-800/60 p-4', className)}>
      {children}
    </div>
  );
}
