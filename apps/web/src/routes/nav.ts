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
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '@/lib/permissions';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  module: ModuleKey;
  badgeKey?: 'pending_incidents' | 'pending_bookings' | 'overdue_loans' | 'overdue_maintenance';
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
      { to: '/laboratories', label: 'Laboratorium', icon: FlaskConical, module: 'laboratories' },
      { to: '/schedules', label: 'Jadwal Lab', icon: CalendarDays, module: 'schedules' },
      { to: '/bookings', label: 'Booking Lab', icon: CalendarClock, module: 'bookings', badgeKey: 'pending_bookings' },
      { to: '/sessions', label: 'Sesi Praktikum', icon: BookOpen, module: 'sessions' },
      { to: '/journals', label: 'Jurnal Praktikum', icon: ClipboardList, module: 'journals' },
    ],
  },
  {
    title: 'Aset dan Monitoring',
    items: [
      { to: '/monitoring', label: 'Monitoring PC', icon: Monitor, module: 'monitoring' },
      { to: '/assets', label: 'Inventaris', icon: Boxes, module: 'assets' },
      { to: '/stock', label: 'Persediaan', icon: Package, module: 'stock' },
      { to: '/incidents', label: 'Laporan Kerusakan', icon: AlertTriangle, module: 'incidents', badgeKey: 'pending_incidents' },
      { to: '/work-orders', label: 'Work Order', icon: Wrench, module: 'work-orders' },
      { to: '/maintenance', label: 'Maintenance', icon: ShieldCheck, module: 'maintenance', badgeKey: 'overdue_maintenance' },
      { to: '/loans', label: 'Peminjaman', icon: HandHelping, module: 'loans', badgeKey: 'overdue_loans' },
    ],
  },
  {
    title: 'Informasi',
    items: [
      { to: '/calendar', label: 'Kalender Akademik', icon: CalendarRange, module: 'calendar' },
      { to: '/reports', label: 'Laporan dan Analitik', icon: BarChart3, module: 'reports' },
      { to: '/notifications', label: 'Notifikasi', icon: Bell, module: 'notifications' },
    ],
  },
  {
    title: 'Administrasi',
    items: [
      { to: '/users', label: 'Pengguna', icon: Users, module: 'users' },
      { to: '/roles', label: 'Role dan Permission', icon: KeyRound, module: 'roles' },
      { to: '/master-data', label: 'Master Data', icon: Database, module: 'master-data' },
      { to: '/audit-logs', label: 'Audit Log', icon: ScrollText, module: 'audit-logs' },
      { to: '/settings', label: 'Pengaturan', icon: Settings, module: 'settings' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
