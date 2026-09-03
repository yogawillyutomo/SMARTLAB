import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FlaskConical, X } from 'lucide-react';
import { getVisibleNavGroupsForUser } from '@/routes/nav';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { cn } from '@/utils';

export function AppSidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileSidebarOpen, setMobileSidebar } = useUIStore();
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  const navGroups = getVisibleNavGroupsForUser(permissions, user);

  return (
    <>
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 bg-overlay/60 backdrop-blur-sm lg:hidden" onClick={() => setMobileSidebar(false)} />
      )}

      <aside
        className={cn(
          'print-hidden fixed inset-y-0 left-0 z-50 flex flex-col border-r border-base-700 bg-base-800/95 backdrop-blur transition-all duration-200 lg:static lg:translate-x-0',
          sidebarCollapsed ? 'w-[68px]' : 'w-64',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="flex items-center gap-3 border-b border-base-700 px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-blue to-brand-cyan text-white shadow-soft">
            <FlaskConical className="h-5 w-5" />
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-ink-primary">SMARTLAB PPLG</p>
              <p className="truncate text-[10px] text-ink-muted">Laboratory Management System</p>
            </div>
          )}
          <button
            onClick={() => setMobileSidebar(false)}
            className="rounded-lg p-1.5 text-ink-muted hover:bg-base-700 hover:text-ink-primary lg:hidden"
            aria-label="Tutup sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 no-scrollbar">
          {navGroups.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.title} className="mb-4">
                {!sidebarCollapsed && (
                  <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{group.title}</p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        onClick={() => setMobileSidebar(false)}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            sidebarCollapsed && 'justify-center',
                            isActive
                              ? 'bg-accent-primary/15 text-accent-content'
                              : 'text-ink-secondary hover:bg-base-700/60 hover:text-ink-primary',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent-content" />}
                            <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-accent-content' : 'text-ink-muted group-hover:text-ink-secondary')} />
                            {!sidebarCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="hidden border-t border-base-700 p-2 lg:block">
          <button
            onClick={toggleSidebar}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium text-ink-muted hover:bg-base-700 hover:text-ink-primary"
            aria-label={sidebarCollapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!sidebarCollapsed && 'Ciutkan'}
          </button>
        </div>
      </aside>
    </>
  );
}
