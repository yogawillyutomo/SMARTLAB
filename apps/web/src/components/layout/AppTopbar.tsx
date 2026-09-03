import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Settings,
  RefreshCw,
  Plus,
  FlaskConical,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { initials, cn } from '@/utils';
import { getVisibleNavItemsForUser } from '@/routes/nav';
import { usePermissionStore } from '@/stores/permissionStore';
import { authIssueMessage } from '@/lib/authMessages';
import { hasServerPermission } from '@/lib/authIdentity';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import { toast } from '@/stores/toastStore';

interface SearchResult {
  label: string;
  sub: string;
  to: string;
  icon: LucideIcon;
}

function useGlobalSearch() {
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  const pageItems = getVisibleNavItemsForUser(permissions, user);

  return (q: string): SearchResult[] => {
    const query = q.trim().toLowerCase();
    if (!query) return [];

    return pageItems
      .filter((item) => item.label.toLowerCase().includes(query))
      .slice(0, 8)
      .map((item) => ({
        label: item.label,
        sub: 'Halaman',
        to: item.to,
        icon: item.icon,
      }));
  };
}

export function AppTopbar() {
  const { setMobileSidebar, activeLabId, setActiveLab, setCommandOpen, resolvedTheme, setTheme } = useUIStore();
  const { user, logout, status } = useAuthStore();
  const canCreateIncident = hasServerPermission(user, 'incidents.create');
  const navigate = useNavigate();
  const location = useLocation();

  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [laboratories, setLaboratories] = useState<LaboratoryDto[]>([]);
  const [laboratoriesLoading, setLaboratoriesLoading] = useState(true);
  const [laboratoriesError, setLaboratoriesError] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const searchFn = useGlobalSearch();
  const searchResults = searchOpen ? searchFn(searchQuery) : [];
  const loggingOut = status === 'logging_out';

  async function loadLaboratories() {
    setLaboratoriesLoading(true);
    setLaboratoriesError(false);
    try {
      const rows = await laboratoryGateway.list();
      setLaboratories(rows);
    } catch {
      setLaboratories([]);
      setLaboratoriesError(true);
    } finally {
      setLaboratoriesLoading(false);
    }
  }

  useEffect(() => {
    void loadLaboratories();
  }, []);

  useEffect(() => {
    if (laboratoriesLoading || laboratoriesError) return;
    if (laboratories.length === 0) {
      if (activeLabId !== '') setActiveLab('');
      return;
    }
    if (!laboratories.some((laboratory) => laboratory.id === activeLabId)) {
      setActiveLab(laboratories[0].id);
    }
  }, [activeLabId, laboratories, laboratoriesError, laboratoriesLoading, setActiveLab]);

  async function handleLogout() {
    if (loggingOut) return;
    const result = await logout();
    if (result.ok) {
      setProfileOpen(false);
      navigate('/login', { replace: true });
      return;
    }
    toast(authIssueMessage(result.issue), 'error');
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
        setCommandOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setCommandOpen, searchOpen]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearchQuery('');
    }
  }, [searchOpen]);

  const crumbs = buildCrumbs(location.pathname);

  return (
    <>
      <header className="print-hidden sticky top-0 z-30 flex h-16 min-w-0 items-center gap-2 border-b border-base-700 bg-base-900/90 px-3 backdrop-blur sm:px-4">
        <button
          onClick={() => setMobileSidebar(true)}
          className="rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary lg:hidden"
          aria-label="Buka menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-ink-muted md:flex">
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className={cn('flex min-w-0 items-center gap-1', index === crumbs.length - 1 && 'truncate')}>
              {index > 0 && <span className="opacity-50">/</span>}
              {crumb.to && index < crumbs.length - 1 ? (
                <Link to={crumb.to} className="truncate hover:text-ink-secondary">{crumb.label}</Link>
              ) : (
                <span className={cn('truncate', index === crumbs.length - 1 && 'font-medium text-ink-secondary')}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        <button
          onClick={() => setSearchOpen(true)}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-ink-muted transition-colors hover:border-base-600 hover:text-ink-secondary sm:ml-2"
        >
          <Search className="h-4 w-4" />
          <span className="hidden 2xl:inline">Cari halaman...</span>
          <kbd className="hidden rounded border border-base-600 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted 2xl:inline">⌘K</kbd>
        </button>

        <div className="hidden items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm 2xl:flex">
          <FlaskConical className="h-4 w-4 text-accent-content" />
          {laboratoriesError ? (
            <button type="button" onClick={() => void loadLaboratories()} className="text-xs text-danger hover:underline">Gagal memuat lab</button>
          ) : (
            <select
              value={activeLabId}
              onChange={(event) => setActiveLab(event.target.value)}
              disabled={laboratoriesLoading || laboratories.length === 0}
              className="max-w-44 bg-transparent text-ink-secondary outline-none disabled:cursor-not-allowed disabled:text-ink-muted"
              aria-label="Pilih laboratorium aktif"
            >
              {laboratoriesLoading && <option value="">Memuat laboratorium...</option>}
              {!laboratoriesLoading && laboratories.length === 0 && <option value="">Belum ada laboratorium</option>}
              {laboratories.map((laboratory) => (
                <option key={laboratory.id} value={laboratory.id} className="bg-base-800">
                  {laboratory.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="hidden items-center rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-xs text-ink-secondary 2xl:flex">
          {new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>

        <button
          onClick={() => void loadLaboratories()}
          className="rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
          title="Muat ulang konteks server"
          aria-label="Muat ulang konteks server"
        >
          <RefreshCw className={cn('h-4 w-4', laboratoriesLoading && 'animate-spin')} />
        </button>

        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
          title={resolvedTheme === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap'}
          aria-label={resolvedTheme === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap'}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((open) => !open)}
            className="relative rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
            aria-label="Notifikasi"
          >
            <Bell className="h-4 w-4" />
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border border-base-700 bg-base-800 shadow-elevated animate-slide-up">
              <div className="border-b border-base-700 px-4 py-3">
                <p className="text-sm font-semibold text-ink-primary">Notifikasi</p>
              </div>
              <div className="px-4 py-6 text-center text-xs text-ink-muted">
                Notifikasi server belum tersedia. Data prototype lokal tidak ditampilkan sebagai notifikasi operasional.
              </div>
            </div>
          )}
        </div>

        {canCreateIncident && (
          <button
            onClick={() => navigate('/incidents')}
            className="hidden items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110 sm:flex"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden 2xl:inline">Buat Tiket</span>
          </button>
        )}

        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((open) => !open)}
            className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-base-700"
            aria-label="Menu profil"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-cyan text-xs font-bold text-white">
              {user ? initials(user.name) : '?'}
            </div>
            <ChevronDown className="hidden h-4 w-4 text-ink-muted sm:block" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-12 z-50 w-64 rounded-xl border border-base-700 bg-base-800 shadow-elevated animate-slide-up">
              <div className="border-b border-base-700 px-4 py-3">
                <p className="text-sm font-semibold text-ink-primary">{user?.name}</p>
                <p className="text-xs text-ink-muted">{user?.email}</p>
                {user && (
                  <>
                    <p className="mt-2 text-[10px] text-ink-muted">{user.school.name} · {user.school.code}</p>
                    <div className="mt-2 flex flex-wrap gap-1" aria-label="Role akun">
                      {user.membership.roles.map((role) => (
                        <span key={role} className="inline-flex rounded-md bg-accent-primary/15 px-2 py-0.5 text-[10px] font-medium text-accent-content">
                          {role}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="p-2">
                <div className="rounded-lg px-2 py-1.5 text-[10px] text-ink-muted">
                  Role dan izin berasal dari sesi sekolah aktif.
                </div>
              </div>
              <div className="border-t border-base-700 p-2">
                <Link to="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-secondary hover:bg-base-700 hover:text-ink-primary">
                  <Settings className="h-3.5 w-3.5" /> Pengaturan
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                  aria-busy={loggingOut}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-danger hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-50"
                >
                  <LogOut className="h-3.5 w-3.5" /> {loggingOut ? 'Keluar...' : 'Keluar'}
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[15vh] animate-fade-in">
          <div className="absolute inset-0 bg-overlay/60 backdrop-blur-sm" onClick={() => setSearchOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-base-700 bg-base-800 shadow-elevated animate-slide-up">
            <div className="flex items-center gap-3 border-b border-base-700 px-4 py-3">
              <Search className="h-5 w-5 text-ink-muted" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Cari halaman..."
                className="flex-1 bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-muted"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setSearchOpen(false);
                  if (event.key === 'Enter' && searchResults[0]) {
                    navigate(searchResults[0].to);
                    setSearchOpen(false);
                  }
                }}
              />
              <kbd className="rounded border border-base-600 px-1.5 py-0.5 text-[10px] text-ink-muted">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {searchQuery === '' ? (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">Pencarian lintas data akan diaktifkan setelah query API canonical tersedia.</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">Tidak ada halaman untuk "{searchQuery}"</p>
              ) : (
                searchResults.map((result) => {
                  const Icon = result.icon;
                  return (
                    <button
                      key={result.to}
                      onClick={() => {
                        navigate(result.to);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-base-700"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-primary">{result.label}</p>
                        <p className="truncate text-xs text-ink-muted">{result.sub}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function buildCrumbs(path: string): { label: string; to?: string }[] {
  const parts = path.split('/').filter(Boolean);
  const labelMap: Record<string, string> = {
    dashboard: 'Dashboard',
    laboratories: 'Laboratorium',
    devices: 'Perangkat',
    schedules: 'Jadwal Reguler',
    bookings: 'Reservasi Lab',
    sessions: 'Pelaksanaan Lab',
    journals: 'Riwayat & Laporan Pelaksanaan',
    monitoring: 'Monitoring Perangkat',
    assets: 'Aset Tetap',
    stock: 'Stok & Spare Part',
    incidents: 'Tiket Kerusakan',
    'work-orders': 'Tugas Perbaikan',
    maintenance: 'Pemeliharaan Berkala',
    loans: 'Peminjaman Barang',
    calendar: 'Kalender Akademik',
    reports: 'Laporan & Analitik',
    notifications: 'Notifikasi',
    users: 'Pengguna',
    roles: 'Hak Akses',
    'master-data': 'Master Data',
    'audit-logs': 'Audit Log',
    settings: 'Pengaturan',
    layout: 'Denah',
  };
  const crumbs: { label: string; to?: string }[] = [{ label: 'Beranda', to: '/dashboard' }];
  let accumulatedPath = '';
  parts.forEach((part, index) => {
    accumulatedPath += `/${part}`;
    const isLast = index === parts.length - 1;
    const label = labelMap[part] ?? (part.match(/^[a-f0-9-]+$/i) ? 'Detail' : part);
    crumbs.push({ label, to: isLast ? undefined : accumulatedPath });
  });
  return crumbs;
}
