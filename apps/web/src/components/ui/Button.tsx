import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/utils';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success' | 'warning';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent-primary hover:brightness-110 text-accent-foreground shadow-soft',
  secondary: 'bg-base-700 hover:bg-base-600 text-ink-primary border border-base-600',
  ghost: 'hover:bg-base-700/60 text-ink-secondary hover:text-ink-primary',
  outline: 'border border-base-600 hover:bg-base-700/60 text-ink-primary',
  danger: 'bg-danger hover:brightness-110 text-white shadow-soft',
  success: 'bg-success hover:brightness-110 text-white shadow-soft',
  warning: 'bg-warning hover:brightness-110 text-white shadow-soft',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, icon, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-base-900 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
