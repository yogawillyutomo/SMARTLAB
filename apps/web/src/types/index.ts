export type ID = string;

export type RoleName =
  | 'Super Admin'
  | 'Admin Lab'
  | 'Kepala Lab'
  | 'Teknisi'
  | 'Guru'
  | 'Ketua Kelas'
  | 'Siswa'
  | 'Pimpinan';

export interface User {
  id: ID;
  name: string;
  email: string;
  nip?: string;
  nis?: string;
  role: RoleName;
  unit?: string;
  phone?: string;
  status: 'active' | 'inactive';
  avatar?: string;
  lastLogin?: string;
}

export type DeviceStatus =
  | 'Online'
  | 'Offline'
  | 'Warning'
  | 'Critical'
  | 'Maintenance'
  | 'Reserved';

export type ManagedDeviceType =
  | 'desktop_pc'
  | 'laptop'
  | 'server'
  | 'network_switch'
  | 'router'
  | 'access_point'
  | 'printer'
  | 'projector'
  | 'ups'
  | 'other';

export type DeviceLifecycleStatus =
  | 'in_service'
  | 'spare'
  | 'retired'
  | 'decommissioned';

export interface Device {
  id: ID;
  deviceType: ManagedDeviceType;
  lifecycleStatus: DeviceLifecycleStatus;
  qrPublicId: string;
  assetId?: ID;
  positionCode: string;
  hostname: string;
  laboratoryId: ID;
  assetCode: string;
  ipAddress: string;
  macAddress: string;
  serialNumber: string;
  brand: string;
  model: string;
  yearAcquired: number;
  processor: string;
  ramGB: number;
  storageGB: number;
  gpu: string;
  monitor: string;
  os: string;
  status: DeviceStatus;
  cpuUsage: number;
  ramUsage: number;
  diskUsage: number;
  temperature: number;
  uptimeHours: number;
  network: 'Connected' | 'Disconnected' | 'Limited';
  lastHeartbeat: string;
  peripherals: {
    monitor: boolean;
    keyboard: boolean;
    mouse: boolean;
    headset: boolean;
    network: boolean;
    ups: boolean;
  };
}

export interface Laboratory {
  id: ID;
  name: string;
  code: string;
  location: string;
  capacity: number;
  headName: string;
  technicianName: string;
  pcCount: number;
  status: 'active' | 'inactive';
  layoutRows: number;
  layoutCols: number;
}

export type LaboratoryLayoutType =
  | 'grid-classic'
  | 'perimeter-center-island'
  | 'u-shape'
  | 'facing-rows'
  | 'custom';

export type LaboratoryLayoutStatus =
  | 'draft'
  | 'active'
  | 'archived';

export type LayoutElementType =
  | 'student_pc'
  | 'teacher_pc'
  | 'teacher_desk'
  | 'projector'
  | 'printer'
  | 'network_switch'
  | 'access_point'
  | 'door'
  | 'window'
  | 'wall'
  | 'aisle'
  | 'label'
  | 'empty';

export type LayoutRotation = 0 | 90 | 180 | 270;

export interface LaboratoryLayout {
  id: ID;
  laboratoryId: ID;
  name: string;
  layoutType: LaboratoryLayoutType;
  rows: number;
  columns: number;
  version: number;
  status: LaboratoryLayoutStatus;
  isActive: boolean;
  elements: LayoutElement[];
  createdAt: string;
  updatedAt: string;
}

export interface LayoutElement {
  id: ID;
  layoutId: ID;
  type: LayoutElementType;
  referenceId?: ID;
  label?: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  rotation: LayoutRotation;
  movable: boolean;
  swappable: boolean;
  fixed: boolean;
}

export type MasterDataCategoryKey =
  | 'asset-category'
  | 'asset-model'
  | 'asset-condition'
  | 'asset-status'
  | 'class'
  | 'teacher'
  | 'subject'
  | 'lesson-hour'
  | 'academic-year'
  | 'semester'
  | 'incident-category'
  | 'supplier'
  | 'stock-unit'
  | 'stock-location';

export interface MasterDataItem {
  id: ID;
  category: MasterDataCategoryKey;
  name: string;
  code?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type MasterDataCollection = Record<MasterDataCategoryKey, MasterDataItem[]>;

export type AssetCondition =
  | 'Baik'
  | 'Rusak Ringan'
  | 'Rusak Sedang'
  | 'Rusak Berat'
  | 'Tidak Diketahui';

export type AssetStatus =
  | 'Aktif'
  | 'Cadangan'
  | 'Dipinjam'
  | 'Maintenance'
  | 'Rusak'
  | 'Hilang'
  | 'Dihapuskan';

export interface Asset {
  id: ID;
  assetCode: string;
  name: string;
  category: string;
  model: string;
  brand: string;
  serialNumber: string;
  laboratoryId: ID;
  position: string;
  yearAcquired: number;
  fundingSource: string;
  price: number;
  condition: AssetCondition;
  status: AssetStatus;
  purchaseDate: string;
  warrantyUntil: string;
  supplier: string;
  notes?: string;
}

export type SessionStatus =
  | 'Belum Dimulai'
  | 'Berlangsung'
  | 'Selesai'
  | 'Dibatalkan';

export interface Schedule {
  id: ID;
  day: string;
  date: string;
  startTime: string;
  endTime: string;
  lessonHours: number;
  laboratoryId: ID;
  className: string;
  teacherName: string;
  subject: string;
  activityType: 'Praktikum' | 'Teori' | 'Ujian' | 'Lainnya';
  status: 'Tetap' | 'Pengganti' | 'Dibatalkan';
  semester: string;
}

export type BookingStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Menunggu Persetujuan'
  | 'Disetujui'
  | 'Ditolak'
  | 'Dibatalkan'
  | 'Selesai';

export interface Booking {
  id: ID;
  requesterName: string;
  laboratoryId: ID;
  date: string;
  startTime: string;
  endTime: string;
  activity: string;
  participants: number;
  deviceNeeds: string;
  notes?: string;
  PIC: string;
  status: BookingStatus;
  rejectionReason?: string;
  timeline: { status: BookingStatus; at: string; by: string }[];
}

export interface Session {
  id: ID;
  laboratoryId: ID;
  scheduleId?: ID;
  teacherName: string;
  className: string;
  subject: string;
  participantCount: number;
  startTime: string;
  endTime?: string;
  initialCondition: string;
  brokenPCsBefore: string[];
  notes: string;
  status: SessionStatus;
  finalMaterial?: string;
  finalSoftware?: string;
  presentCount?: number;
  absentCount?: number;
  finalCondition?: string;
  issues?: string;
  brokenPCsAfter?: string[];
  followUp?: string;
  journalId?: ID;
}

export type JournalStatus =
  | 'Draft'
  | 'Berlangsung'
  | 'Selesai'
  | 'Perlu Perbaikan'
  | 'Diverifikasi';

export interface Journal {
  id: ID;
  journalNumber: string;
  date: string;
  laboratoryId: ID;
  teacherName: string;
  className: string;
  subject: string;
  hours: number;
  material: string;
  software: string;
  presentCount: number;
  absentCount: number;
  initialCondition: string;
  finalCondition: string;
  issues: string;
  followUp: string;
  status: JournalStatus;
  source: 'manual' | 'session';
  sessionId?: ID;
}

export type IncidentStatus =
  | 'Dilaporkan'
  | 'Diverifikasi'
  | 'Ditugaskan'
  | 'Diproses'
  | 'Menunggu Spare Part'
  | 'Selesai'
  | 'Diuji'
  | 'Ditutup'
  | 'Ditolak';

export type Priority = 'Rendah' | 'Normal' | 'Tinggi' | 'Kritis';

export type IncidentCategory =
  | 'hardware'
  | 'software'
  | 'jaringan'
  | 'listrik'
  | 'periferal'
  | 'fasilitas'
  | 'kebersihan'
  | 'keamanan'
  | 'lainnya';

export interface Incident {
  id: ID;
  ticketNumber: string;
  reporterName: string;
  laboratoryId: ID;
  assetCode?: string;
  date: string;
  category: IncidentCategory;
  title: string;
  description: string;
  impact: string;
  priority: Priority;
  blocksPracticum: boolean;
  stepsTaken: string;
  status: IncidentStatus;
  assignedTechnician?: string;
  workOrderId?: ID;
  comments: { at: string; by: string; text: string }[];
  timeline: { status: IncidentStatus; at: string; by: string }[];
}

export type WorkOrderStatus =
  | 'Draft'
  | 'Assigned'
  | 'In Progress'
  | 'On Hold'
  | 'Waiting Part'
  | 'Completed'
  | 'Verified'
  | 'Cancelled';

export interface WorkOrderSparePart {
  stockItemId: ID;
  name: string;
  quantity: number;
}

export interface WorkOrder {
  id: ID;
  woNumber: string;
  incidentId?: ID;
  assetCode?: string;
  laboratoryId: ID;
  technician: string;
  priority: Priority;
  diagnosis: string;
  action: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  downtimeHours?: number;
  spareParts: WorkOrderSparePart[];
  cost: number;
  testResult?: string;
  notes?: string;
  status: WorkOrderStatus;
  timeline: { status: WorkOrderStatus; at: string; by: string }[];
}

export type MaintenanceFrequency =
  | 'mingguan'
  | 'bulanan'
  | 'tiga bulanan'
  | 'semester'
  | 'tahunan'
  | 'custom';

export interface MaintenancePlan {
  id: ID;
  name: string;
  assetCategory: string;
  laboratoryId: ID;
  frequency: MaintenanceFrequency;
  checklist: string[];
  technician: string;
  nextSchedule: string;
  status: 'active' | 'inactive';
}

export interface MaintenanceExecution {
  id: ID;
  planId?: ID;
  assetCode: string;
  laboratoryId: ID;
  technician: string;
  date: string;
  checklist: { item: string; done: boolean }[];
  findings: string;
  action: string;
  spareParts: WorkOrderSparePart[];
  conditionBefore: AssetCondition;
  conditionAfter: AssetCondition;
  nextSchedule: string;
}

export type LoanStatus =
  | 'Draft'
  | 'Diajukan'
  | 'Disetujui'
  | 'Ditolak'
  | 'Diserahkan'
  | 'Dipinjam'
  | 'Terlambat'
  | 'Dikembalikan'
  | 'Diperiksa'
  | 'Selesai';

export interface Loan {
  id: ID;
  borrowerName: string;
  unitOrClass: string;
  itemName: string;
  quantity: number;
  borrowDate: string;
  plannedReturn: string;
  actualReturn?: string;
  purpose: string;
  PIC: string;
  conditionOut: AssetCondition;
  conditionReturn?: AssetCondition;
  notes?: string;
  status: LoanStatus;
}

export interface StockItem {
  id: ID;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  location: string;
  supplier: string;
  price: number;
}

export interface StockTransaction {
  id: ID;
  itemId: ID;
  type: 'in' | 'out' | 'adjust';
  quantity: number;
  date: string;
  reason: string;
  by: string;
}

export type CalendarCategory =
  | 'hari efektif'
  | 'libur'
  | 'ujian'
  | 'kegiatan sekolah'
  | 'maintenance'
  | 'booking'
  | 'workshop'
  | 'LKS'
  | 'rapat'
  | 'lainnya';

export interface CalendarEvent {
  id: ID;
  title: string;
  date: string;
  endDate?: string;
  category: CalendarCategory;
  description?: string;
}

export interface Notification {
  id: ID;
  category: 'incident' | 'work_order' | 'maintenance' | 'stock' | 'booking' | 'journal' | 'loan' | 'pc_offline' | 'system';
  title: string;
  message: string;
  at: string;
  read: boolean;
  link?: string;
}

export interface AuditLog {
  id: ID;
  at: string;
  userName: string;
  role: RoleName;
  module: string;
  action: string;
  object: string;
  oldValue?: string;
  newValue?: string;
  device: string;
}

export interface Permission {
  module: string;
  actions: { action: string; allowed: boolean }[];
}

export interface RolePermissions {
  role: RoleName;
  permissions: Permission[];
}
