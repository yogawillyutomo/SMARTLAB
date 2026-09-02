import {
  LayoutDashboard,
  Monitor,
  CalendarDays,
  CalendarClock,
  BookOpen,
  ClipboardList,
  Boxes,
  Package,
  AlertTriangle,
  Wrench,
  ShieldCheck,
  HandHelping,
  CalendarRange,
  BarChart3,
  Bell,
  Users,
  KeyRound,
  Database,
  ScrollText,
  Settings,
  FlaskConical,
  Laptop,
  type LucideIcon,
} from 'lucide-react';
import { hasServerPermission } from '@/lib/authIdentity';
import { canView, type ModuleKey, type PermissionMatrix, type RoleName } from '@/lib/permissions';
import type { AuthenticatedUser } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  module?: ModuleKey;
  serverPermission?: string;
  badgeKey?: 'pending_bookings' | 'overdue_loans' | 'overdue_maintenance';
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Operasional',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' },
      { to: '/laboratories', label: 'Laboratorium', icon: FlaskConical, module: 'laboratories', serverPermission: 'laboratories.view' },
      { to: '/schedules', label: 'Jadwal Reguler', icon: CalendarDays, module: 'schedules' },
      { to: '/bookings', label: 'Reservasi Lab', icon: CalendarClock, module: 'bookings', badgeKey: 'pending_bookings' },
      { to: '/sessions', label: 'Pelaksanaan Lab', icon: BookOpen, module: 'sessions' },
    ],
  },
  {
    title: 'Aset dan Pemeliharaan',
    items: [
      { to: '/devices', label: 'Perangkat', icon: Laptop, serverPermission: 'devices.view' },
      { to: '/monitoring', label: 'Monitoring Perangkat', icon: Monitor, module: 'monitoring' },
      { to: '/assets', label: 'Aset Tetap', icon: Boxes, module: 'assets' },
      { to: '/stock', label: 'Stok & Spare Part', icon: Package, module: 'stock' },
      { to: '/incidents', label: 'Tiket Kerusakan', icon: AlertTriangle, serverPermission: 'incidents.view' },
      { to: '/work-orders', label: 'Tugas Perbaikan', icon: Wrench, module: 'work-orders' },
      { to: '/maintenance', label: 'Pemeliharaan Berkala', icon: ShieldCheck, module: 'maintenance', badgeKey: 'overdue_maintenance' },
      { to: '/loans', label: 'Peminjaman Barang', icon: HandHelping, module: 'loans', badgeKey: 'overdue_loans' },
    ],
  },
  {
    title: 'Informasi',
    items: [
      { to: '/calendar', label: 'Kalender Akademik', icon: CalendarRange, module: 'calendar' },
      { to: '/reports', label: 'Laporan & Analitik', icon: BarChart3, module: 'reports' },
      { to: '/notifications', label: 'Notifikasi', icon: Bell, module: 'notifications' },
    ],
  },
  {
    title: 'Administrasi',
    items: [
      { to: '/users', label: 'Pengguna', icon: Users, module: 'users' },
      { to: '/roles', label: 'Hak Akses', icon: KeyRound, module: 'roles' },
      { to: '/master-data', label: 'Master Data', icon: Database, module: 'master-data' },
      { to: '/audit-logs', label: 'Audit Log', icon: ScrollText, module: 'audit-logs' },
      { to: '/settings', label: 'Pengaturan', icon: Settings, module: 'settings' },
    ],
  },
];

export function getNavGroupsForPermissions(permissions: PermissionMatrix, role: RoleName): NavGroup[] {
  const canViewSessions = canView(permissions, role, 'sessions');
  const canViewJournals = canView(permissions, role, 'journals');

  if (canViewSessions || !canViewJournals) return NAV_GROUPS;

  return NAV_GROUPS.map((group) => group.title === 'Operasional'
    ? { ...group, items: [...group.items, { to: '/journals', label: 'Riwayat & Laporan', icon: ClipboardList, module: 'journals' }] }
    : group);
}

export function canViewNavigationModule(
  permissions: PermissionMatrix,
  user: AuthenticatedUser | null,
  module: ModuleKey,
): boolean {
  if (!user) return false;
  return module === 'laboratories'
    ? hasServerPermission(user, 'laboratories.view')
    : canView(permissions, user.role, module);
}

export function canViewNavigationItem(
  permissions: PermissionMatrix,
  user: AuthenticatedUser | null,
  item: NavItem,
): boolean {
  if (!user) return false;
  if (item.serverPermission) return hasServerPermission(user, item.serverPermission);
  return item.module ? canView(permissions, user.role, item.module) : false;
}

export function getVisibleNavGroupsForUser(
  permissions: PermissionMatrix,
  user: AuthenticatedUser | null,
): NavGroup[] {
  if (!user) return [];
  return getNavGroupsForPermissions(permissions, user.role).map((group) => ({
    ...group,
    items: group.items.filter((item) => canViewNavigationItem(permissions, user, item)),
  }));
}

export function getVisibleNavItemsForUser(
  permissions: PermissionMatrix,
  user: AuthenticatedUser | null,
): NavItem[] {
  return getVisibleNavGroupsForUser(permissions, user).flatMap((group) => group.items);
}

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
