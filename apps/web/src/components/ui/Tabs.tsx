import { type ReactNode } from 'react';
import { cn } from '@/utils';

interface Tab {
  key: string;
  label: string;
  icon?: ReactNode;
  content: ReactNode;
}

export function Tabs({ tabs, active, onChange, className }: { tabs: { key: string; label: string; icon?: ReactNode }[]; active: string; onChange: (key: string) => void; className?: string }) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto border-b border-base-700/70 no-scrollbar', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            active === tab.key
              ? 'border-accent-blue text-accent-blue'
              : 'border-transparent text-ink-muted hover:text-ink-secondary'
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabContent({ tabs, active }: { tabs: Tab[]; active: string }) {
  const tab = tabs.find((t) => t.key === active);
  return <div className="animate-fade-in">{tab?.content}</div>;
}
