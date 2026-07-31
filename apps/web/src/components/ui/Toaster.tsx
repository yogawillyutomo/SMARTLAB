import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToastStore } from '@/stores/toastStore';
import { cn } from '@/utils';

export function Toaster() {
  const { toasts, remove } = useToastStore();
  if (toasts.length === 0) return null;

  return createPortal(
    <div className="print-hidden fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-xl border bg-base-800/95 backdrop-blur px-4 py-3 shadow-elevated animate-slide-up',
            t.type === 'success' && 'border-success/30',
            t.type === 'error' && 'border-danger/30',
            t.type === 'info' && 'border-info/30'
          )}
        >
          <div
            className={cn(
              'mt-0.5',
              t.type === 'success' && 'text-success-foreground',
              t.type === 'error' && 'text-danger',
              t.type === 'info' && 'text-info'
            )}
          >
            {t.type === 'success' && <CheckCircle2 className="h-5 w-5" />}
            {t.type === 'error' && <XCircle className="h-5 w-5" />}
            {t.type === 'info' && <Info className="h-5 w-5" />}
          </div>
          <p className="flex-1 text-sm text-ink-primary">{t.message}</p>
          <button onClick={() => remove(t.id)} className="text-ink-muted hover:text-ink-primary" aria-label="Tutup">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
