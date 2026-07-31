import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils';

const baseField =
  'w-full rounded-lg border border-base-600 bg-base-800 text-ink-primary placeholder:text-ink-muted transition-colors focus:outline-none focus:ring-2 focus:ring-accent-primary/60 focus:border-accent-primary disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, icon, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-ink-secondary">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">{icon}</div>}
          <input
            ref={ref}
            id={inputId}
            className={cn(baseField, 'h-10 px-3 text-sm', icon && 'pl-10', error && 'border-danger focus:ring-danger/40', className)}
            {...props}
          />
        </div>
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-muted">{hint}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, placeholder, id, ...props }, ref) => {
    const selId = id || props.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selId} className="block text-sm font-medium text-ink-secondary">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selId}
            className={cn(baseField, 'h-10 px-3 pr-9 text-sm appearance-none', error && 'border-danger', className)}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value} className="bg-base-800 text-ink-primary">
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Select.displayName = 'Select';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const tId = id || props.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={tId} className="block text-sm font-medium text-ink-secondary">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={tId}
          className={cn(baseField, 'px-3 py-2 text-sm min-h-[80px] resize-y', error && 'border-danger', className)}
          {...props}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = 'Textarea';
