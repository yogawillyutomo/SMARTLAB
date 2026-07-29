import type { RoleName } from '@/types';

export type { RoleName };
export interface PermissionDef {
  module: string;
  actions: string[];
}

export const PERMISSION_ACTIONS = ['view', 'create', 'update', 'delete', 'approve', 'assign', 'export', 'manage'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const ROLE_NAMES = ['Super Admin', 'Admin Lab', 'Kepala Lab', 'Teknisi', 'Guru', 'Ketua Kelas', 'Siswa', 'Pimpinan'] as const;

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

export type PermissionMatrix = Record<RoleName, Record<ModuleKey, PermissionAction[]>>;

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

function isPermissionAction(value: unknown): value is PermissionAction {
  return typeof value === 'string' && (PERMISSION_ACTIONS as readonly string[]).includes(value);
}

function isRoleName(value: string): value is RoleName {
  return (ROLE_NAMES as readonly string[]).includes(value);
}

function isModuleKey(value: string): value is ModuleKey {
  return (MODULES as readonly string[]).includes(value);
}

export function createDefaultPermissionMatrix(): PermissionMatrix {
  return Object.fromEntries(ROLE_NAMES.map((role) => [
    role,
    Object.fromEntries(MODULES.map((module) => [module, [...(ROLE_PERMISSIONS[role]?.[module] ?? [])]])),
  ])) as PermissionMatrix;
}

export function sanitizePermissionMatrix(value: unknown): PermissionMatrix {
  const matrix = createDefaultPermissionMatrix();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return matrix;

  for (const [role, rawModules] of Object.entries(value)) {
    if (!isRoleName(role) || !rawModules || typeof rawModules !== 'object' || Array.isArray(rawModules)) continue;
    for (const [module, rawActions] of Object.entries(rawModules)) {
      if (!isModuleKey(module) || !Array.isArray(rawActions)) continue;
      matrix[role][module] = [...new Set(rawActions.filter(isPermissionAction))];
    }
  }

  return matrix;
}

export function can(permissions: PermissionMatrix, role: RoleName, module: ModuleKey, action: PermissionAction): boolean {
  const perms = permissions[role]?.[module];
  return perms ? perms.includes(action) : false;
}

export function canView(permissions: PermissionMatrix, role: RoleName, module: ModuleKey): boolean {
  return can(permissions, role, module, 'view');
}

export function roleMenuItems(permissions: PermissionMatrix, role: RoleName): ModuleKey[] {
  return MODULES.filter((m) => canView(permissions, role, m));
}
