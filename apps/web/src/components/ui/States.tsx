import type { ReactNode } from 'react';
import { Inbox, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/utils';

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-center', className)}>
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-base-700/50 text-ink-muted">
        {icon ?? <Inbox className="h-7 w-7" />}
      </div>
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Memuat data...', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-3 py-10 text-ink-muted', className)}>
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-10 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/15 text-danger">
        <AlertCircle className="h-6 w-6" />
      </div>
      <p className="text-sm text-ink-secondary">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-sm font-medium text-accent-content hover:underline">
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-base-700/40', className)} />;
}
