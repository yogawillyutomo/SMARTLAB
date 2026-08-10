import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Menu,
  Search,
  Bell,
  Calendar,
  ChevronDown,
  Users,
  LogOut,
  Settings,
  RefreshCw,
  Plus,
  Monitor,
  FlaskConical,
  Boxes,
  AlertTriangle,
  Wrench,
  ClipboardList,
  CalendarClock,
  HandHelping,
  Sun,
  Moon,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppData } from '@/hooks/useAppData';
import { relativeTime, initials, cn } from '@/utils';
import type { RoleName } from '@/types';
import { getNavGroupsForPermissions } from '@/routes/nav';
import { canView, type ModuleKey } from '@/lib/permissions';
import { usePermission } from '@/components/common/PermissionGuard';
import { usePermissionStore } from '@/stores/permissionStore';

const ROLES: RoleName[] = ['Super Admin', 'Admin Lab', 'Kepala Lab', 'Teknisi', 'Guru', 'Ketua Kelas', 'Siswa', 'Pimpinan'];

interface SearchResult {
  label: string;
  sub: string;
  to: string;
  icon: LucideIcon;
}

function useGlobalSearch() {
  const { db } = useAppData();
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  const canViewModule = (module: ModuleKey) => Boolean(user && canView(permissions, user.role, module));
  const pageItems = user
    ? getNavGroupsForPermissions(permissions, user.role)
      .flatMap((group) => group.items)
      .filter((item) => canViewModule(item.module))
    : [];

  return (q: string): SearchResult[] => {
    if (!q) return [];
    const query = q.toLowerCase();
    const results: SearchResult[] = [];
    const limit = 8;
    if (canViewModule('laboratories')) {
      db.labs.forEach((l) => {
        if (results.length >= limit) return;
        if (l.name.toLowerCase().includes(query) || l.code.toLowerCase().includes(query)) {
          results.push({ label: l.name, sub: `Laboratorium · ${l.location}`, to: `/laboratories/${l.id}`, icon: FlaskConical });
        }
      });
    }
    if (canViewModule('monitoring')) {
      db.devices.forEach((d) => {
        if (results.length >= limit) return;
        if (d.hostname.toLowerCase().includes(query) || d.positionCode.toLowerCase().includes(query)) {
          results.push({ label: d.hostname, sub: `Perangkat · ${d.positionCode}`, to: `/monitoring`, icon: Monitor });
        }
      });
    }
    if (canViewModule('assets')) {
      db.assets.forEach((a) => {
        if (results.length >= limit) return;
        if (a.name.toLowerCase().includes(query) || a.assetCode.toLowerCase().includes(query)) {
          results.push({ label: a.name, sub: `Aset · ${a.assetCode}`, to: `/assets/${a.id}`, icon: Boxes });
        }
      });
    }
    if (canViewModule('incidents')) {
      db.incidents.forEach((i) => {
        if (results.length >= limit) return;
        if (i.title.toLowerCase().includes(query) || i.ticketNumber.toLowerCase().includes(query)) {
          results.push({ label: i.title, sub: `Tiket Kerusakan · ${i.ticketNumber}`, to: '/incidents', icon: AlertTriangle });
        }
      });
    }
    if (canViewModule('work-orders')) {
      db.workOrders.forEach((w) => {
        if (results.length >= limit) return;
        if (w.woNumber.toLowerCase().includes(query)) {
          results.push({ label: w.woNumber, sub: `Tugas Perbaikan · ${w.status}`, to: '/work-orders', icon: Wrench });
        }
      });
    }
    if (canViewModule('journals')) {
      db.journals.forEach((j) => {
        if (results.length >= limit) return;
        if (j.journalNumber.toLowerCase().includes(query) || j.material.toLowerCase().includes(query)) {
          results.push({ label: j.material, sub: `Jurnal/Laporan · ${j.journalNumber}`, to: '/journals', icon: ClipboardList });
        }
      });
    }
    if (canViewModule('bookings')) {
      db.bookings.forEach((b) => {
        if (results.length >= limit) return;
        if (b.activity.toLowerCase().includes(query)) {
          results.push({ label: b.activity, sub: `Reservasi Lab · ${b.date}`, to: '/bookings', icon: CalendarClock });
        }
      });
    }
    if (canViewModule('loans')) {
      db.loans.forEach((l) => {
        if (results.length >= limit) return;
        if (l.itemName.toLowerCase().includes(query) || l.borrowerName.toLowerCase().includes(query)) {
          results.push({ label: l.itemName, sub: `Peminjaman Barang · ${l.borrowerName}`, to: '/loans', icon: HandHelping });
        }
      });
    }
    if (canViewModule('users')) {
      db.users.forEach((u) => {
        if (results.length >= limit) return;
        if (u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)) {
          results.push({ label: u.name, sub: `Pengguna · ${u.role}`, to: '/users', icon: Users });
        }
      });
    }
    // Also match nav pages
    if (results.length < limit) {
      pageItems.forEach((it) => {
        if (results.length >= limit) return;
        if (it.label.toLowerCase().includes(query)) {
          results.push({ label: it.label, sub: 'Halaman', to: it.to, icon: it.icon });
        }
      });
    }
    return results;
  };
}

export function AppTopbar() {
  const { setMobileSidebar, activeLabId, setActiveLab, academicYear, semester, setCommandOpen, resolvedTheme, setTheme } = useUIStore();
  const { user, switchRole, logout } = useAuthStore();
  const { db, refresh } = useAppData();
  const canCreateIncident = usePermission('incidents', 'create');
  const navigate = useNavigate();
  const location = useLocation();

  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const searchFn = useGlobalSearch();
  const searchResults = searchOpen ? searchFn(searchQuery) : [];

  const unreadNotifs = db.notifications.filter((n) => !n.read);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setCommandOpen(!searchOpen);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [setCommandOpen, searchOpen]);

  // Close popovers on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
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

  // Build breadcrumb from location
  const path = location.pathname;
  const crumbs = buildCrumbs(path);

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

        {/* Breadcrumb */}
        <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-ink-muted md:flex">
          {crumbs.map((c, i) => (
            <span key={i} className={cn('flex min-w-0 items-center gap-1', i === crumbs.length - 1 && 'truncate')}>
              {i > 0 && <span className="opacity-50">/</span>}
              {c.to && i < crumbs.length - 1 ? (
                <Link to={c.to} className="truncate hover:text-ink-secondary">
                  {c.label}
                </Link>
              ) : (
                <span className={cn('truncate', i === crumbs.length - 1 && 'font-medium text-ink-secondary')}>{c.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* Search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-ink-muted transition-colors hover:border-base-600 hover:text-ink-secondary sm:ml-2"
        >
          <Search className="h-4 w-4" />
          <span className="hidden 2xl:inline">Cari apa saja...</span>
          <kbd className="hidden rounded border border-base-600 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted 2xl:inline">⌘K</kbd>
        </button>

        {/* Active lab selector */}
        <div className="hidden items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm 2xl:flex">
          <FlaskConical className="h-4 w-4 text-accent-content" />
          <select
            value={activeLabId}
            onChange={(e) => setActiveLab(e.target.value)}
            className="bg-transparent text-ink-secondary outline-none cursor-pointer"
            aria-label="Pilih laboratorium aktif"
          >
            {db.labs.map((l) => (
              <option key={l.id} value={l.id} className="bg-base-800">
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {/* Academic year */}
        <div className="hidden items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-xs text-ink-secondary 2xl:flex">
          <Calendar className="h-4 w-4 text-ink-muted" />
          <span>{academicYear}</span>
          <span className="text-ink-muted">·</span>
          <span>{semester}</span>
        </div>

        {/* Today */}
        <div className="hidden items-center rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-xs text-ink-secondary 2xl:flex">
          {new Date().toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>

        {/* Refresh */}
        <button
          onClick={refresh}
          className="rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
          title="Refresh data"
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>

        <button
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
          title={resolvedTheme === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap'}
          aria-label={resolvedTheme === 'dark' ? 'Beralih ke tema terang' : 'Beralih ke tema gelap'}
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative rounded-lg p-2 text-ink-secondary hover:bg-base-700 hover:text-ink-primary"
            aria-label="Notifikasi"
          >
            <Bell className="h-4 w-4" />
            {unreadNotifs.length > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                {unreadNotifs.length}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border border-base-700 bg-base-800 shadow-elevated animate-slide-up">
              <div className="flex items-center justify-between border-b border-base-700 px-4 py-3">
                <p className="text-sm font-semibold text-ink-primary">Notifikasi</p>
                <Link to="/notifications" onClick={() => setNotifOpen(false)} className="text-xs text-accent-content hover:underline">
                  Lihat semua
                </Link>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {db.notifications.slice(0, 6).map((n) => (
                  <Link
                    key={n.id}
                    to={n.link ?? '/notifications'}
                    onClick={() => setNotifOpen(false)}
                    className={cn('flex gap-3 border-b border-base-700/40 px-4 py-3 transition-colors hover:bg-base-700/40', !n.read && 'bg-accent-primary/5')}
                  >
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent-content" />}
                    <div className={cn('min-w-0 flex-1', n.read && 'pl-5')}>
                      <p className="text-xs font-semibold text-ink-primary">{n.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted line-clamp-2">{n.message}</p>
                      <p className="mt-1 text-[10px] text-ink-muted">{relativeTime(n.at)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick action */}
        {canCreateIncident && (
          <button
            onClick={() => navigate('/incidents')}
            className="hidden items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:brightness-110 sm:flex"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden 2xl:inline">Buat Tiket</span>
          </button>
        )}

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
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
                <p className="mt-1 inline-flex rounded-md bg-accent-primary/15 px-2 py-0.5 text-[10px] font-medium text-accent-content">{user?.role}</p>
              </div>
              <div className="p-2">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Ganti Role (Simulasi)</p>
                <div className="max-h-44 overflow-y-auto">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        switchRole(r, db.users);
                        setProfileOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-base-700',
                        user?.role === r ? 'text-accent-content' : 'text-ink-secondary'
                      )}
                    >
                      {r}
                      {user?.role === r && <span className="h-1.5 w-1.5 rounded-full bg-accent-content" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border-t border-base-700 p-2">
                <Link to="/settings" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-secondary hover:bg-base-700 hover:text-ink-primary">
                  <Settings className="h-3.5 w-3.5" /> Pengaturan
                </Link>
                <button
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-danger hover:bg-danger/10"
                >
                  <LogOut className="h-3.5 w-3.5" /> Keluar
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Command palette */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[15vh] animate-fade-in">
          <div className="absolute inset-0 bg-overlay/60 backdrop-blur-sm" onClick={() => setSearchOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-base-700 bg-base-800 shadow-elevated animate-slide-up">
            <div className="flex items-center gap-3 border-b border-base-700 px-4 py-3">
              <Search className="h-5 w-5 text-ink-muted" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari laboratorium, PC, aset, jurnal, incident, pengguna..."
                className="flex-1 bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-muted"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                  if (e.key === 'Enter' && searchResults[0]) {
                    navigate(searchResults[0].to);
                    setSearchOpen(false);
                  }
                }}
              />
              <kbd className="rounded border border-base-600 px-1.5 py-0.5 text-[10px] text-ink-muted">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {searchQuery === '' ? (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">Ketik untuk mencari di seluruh aplikasi...</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-ink-muted">Tidak ada hasil untuk "{searchQuery}"</p>
              ) : (
                searchResults.map((r, i) => {
                  const Icon = r.icon;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        navigate(r.to);
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-base-700"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-ink-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink-primary">{r.label}</p>
                        <p className="truncate text-xs text-ink-muted">{r.sub}</p>
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
  let acc = '';
  parts.forEach((p, i) => {
    acc += `/${p}`;
    const isLast = i === parts.length - 1;
    const label = labelMap[p] ?? (p.match(/^[a-f0-9-]+$/i) ? 'Detail' : p);
    crumbs.push({ label, to: isLast ? undefined : acc });
  });
  return crumbs;
}
