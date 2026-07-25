import type { RoleName } from '@/types';

export type { RoleName };
export interface PermissionDef {
  module: string;
  actions: string[];
}

export const PERMISSION_ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'assign', 'export', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// Module list aligned with sidebar groups
export const MODULES = [
  'dashboard',
  'laboratories',
  'schedules',
  'bookings',
  'sessions',
  'journals',
  'monitoring',
  'assets',
  'stock',
  'incidents',
  'work-orders',
  'maintenance',
  'loans',
  'calendar',
  'reports',
  'notifications',
  'users',
  'roles',
  'master-data',
  'audit-logs',
  'settings',
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  laboratories: 'Laboratorium',
  schedules: 'Jadwal Lab',
  bookings: 'Booking Lab',
  sessions: 'Sesi Praktikum',
  journals: 'Jurnal Praktikum',
  monitoring: 'Monitoring PC',
  assets: 'Inventaris',
  stock: 'Persediaan',
  incidents: 'Laporan Kerusakan',
  'work-orders': 'Work Order',
  maintenance: 'Maintenance',
  loans: 'Peminjaman',
  calendar: 'Kalender Akademik',
  reports: 'Laporan dan Analitik',
  notifications: 'Notifikasi',
  users: 'Pengguna',
  roles: 'Role dan Permission',
  'master-data': 'Master Data',
  'audit-logs': 'Audit Log',
  settings: 'Pengaturan',
};

// Default permission matrix per role
export const ROLE_PERMISSIONS: Record<RoleName, Partial<Record<ModuleKey, PermissionAction[]>>> = {
  'Super Admin': Object.fromEntries(MODULES.map((m) => [m, [...PERMISSION_ACTIONS]])) as Record<ModuleKey, PermissionAction[]>,
  'Admin Lab': {
    dashboard: ['view', 'export'],
    laboratories: ['view', 'create', 'update', 'export'],
    schedules: ['view', 'create', 'update', 'delete', 'export'],
    bookings: ['view', 'create', 'update', 'approve', 'export'],
    sessions: ['view', 'create', 'update'],
    journals: ['view', 'create', 'update', 'delete', 'export'],
    monitoring: ['view', 'update', 'export'],
    assets: ['view', 'create', 'update', 'delete', 'export'],
    stock: ['view', 'create', 'update', 'export'],
    incidents: ['view', 'create', 'update', 'assign', 'export'],
    'work-orders': ['view', 'create', 'update', 'assign', 'export'],
    maintenance: ['view', 'create', 'update', 'export'],
    loans: ['view', 'create', 'update', 'approve', 'export'],
    calendar: ['view', 'create', 'update', 'delete'],
    reports: ['view', 'export'],
    notifications: ['view'],
    users: ['view'],
    'master-data': ['view', 'create', 'update', 'delete'],
    'audit-logs': ['view', 'export'],
    settings: ['view', 'update', 'manage'],
  },
  'Kepala Lab': {
    dashboard: ['view', 'export'],
    laboratories: ['view', 'update'],
    schedules: ['view', 'export'],
    bookings: ['view', 'approve', 'export'],
    sessions: ['view'],
    journals: ['view', 'update', 'export'],
    monitoring: ['view', 'export'],
    assets: ['view', 'export'],
    stock: ['view', 'export'],
    incidents: ['view', 'approve', 'export'],
    'work-orders': ['view', 'approve', 'export'],
    maintenance: ['view', 'export'],
    loans: ['view', 'approve', 'export'],
    calendar: ['view'],
    reports: ['view', 'export'],
    notifications: ['view'],
    users: ['view'],
    'audit-logs': ['view', 'export'],
  },
  Teknisi: {
    dashboard: ['view'],
    laboratories: ['view'],
    monitoring: ['view', 'update'],
    assets: ['view', 'update'],
    stock: ['view'],
    incidents: ['view', 'update'],
    'work-orders': ['view', 'update'],
    maintenance: ['view', 'create', 'update'],
    notifications: ['view'],
    reports: ['view'],
  },
  Guru: {
    dashboard: ['view'],
    laboratories: ['view'],
    schedules: ['view', 'create', 'update', 'export'],
    bookings: ['view', 'create'],
    sessions: ['view', 'create', 'update'],
    journals: ['view', 'create', 'update', 'export'],
    monitoring: ['view'],
    assets: ['view'],
    incidents: ['view', 'create'],
    loans: ['view', 'create'],
    calendar: ['view'],
    notifications: ['view'],
    reports: ['view', 'export'],
  },
  'Ketua Kelas': {
    dashboard: ['view'],
    schedules: ['view'],
    sessions: ['view'],
    monitoring: ['view'],
    incidents: ['view', 'create'],
    loans: ['view', 'create'],
    calendar: ['view'],
    notifications: ['view'],
  },
  Siswa: {
    dashboard: ['view'],
    schedules: ['view'],
    monitoring: ['view'],
    incidents: ['view', 'create'],
    calendar: ['view'],
    notifications: ['view'],
  },
  Pimpinan: {
    dashboard: ['view', 'export'],
    laboratories: ['view'],
    schedules: ['view'],
    sessions: ['view'],
    journals: ['view', 'export'],
    monitoring: ['view'],
    assets: ['view', 'export'],
    incidents: ['view', 'export'],
    'work-orders': ['view', 'export'],
    maintenance: ['view', 'export'],
    loans: ['view', 'export'],
    calendar: ['view'],
    reports: ['view', 'export'],
    notifications: ['view'],
    users: ['view'],
  },
};

export function can(role: RoleName, module: ModuleKey, action: PermissionAction): boolean {
  const perms = ROLE_PERMISSIONS[role]?.[module];
  return perms ? perms.includes(action) : false;
}

export function canView(role: RoleName, module: ModuleKey): boolean {
  return can(role, module, 'view');
}

export function roleMenuItems(role: RoleName): ModuleKey[] {
  return MODULES.filter((m) => canView(role, m));
}