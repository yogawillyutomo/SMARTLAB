import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/utils';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-xs text-ink-muted', className)}>
      <Link to="/dashboard" className="hover:text-ink-secondary" aria-label="Dashboard">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 opacity-60" />
          {item.to && i < items.length - 1 ? (
            <Link to={item.to} className="hover:text-ink-secondary">
              {item.label}
            </Link>
          ) : (
            <span className={cn(i === items.length - 1 && 'text-ink-secondary font-medium')}>{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

// Hook helper to build breadcrumb from route
export function useAutoBreadcrumb() {
  const navigate = useNavigate();
  return { navigate };
}
