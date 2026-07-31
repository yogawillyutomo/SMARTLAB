import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
  width?: string;
}

export function Drawer({ open, onClose, title, description, children, footer, side = 'right', width = 'max-w-xl' }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="print-hidden fixed inset-0 z-50 animate-fade-in">
      <div className="absolute inset-0 bg-overlay/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'absolute top-0 bottom-0 w-full bg-base-800 border-base-700 shadow-elevated flex flex-col animate-slide-in-right',
          width,
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r'
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-4 border-b border-base-700 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-ink-primary truncate">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-ink-muted truncate">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-base-700 hover:text-ink-primary shrink-0"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-base-700 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
