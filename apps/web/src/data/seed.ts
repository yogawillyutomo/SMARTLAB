import type {
  Asset,
  AuditLog,
  Booking,
  CalendarEvent,
  Device,
  Incident,
  Journal,
  Laboratory,
  LaboratoryLayout,
  Loan,
  MaintenanceExecution,
  MaintenancePlan,
  MasterDataCategoryKey,
  MasterDataCollection,
  Notification,
  Schedule,
  Session,
  StockItem,
  StockTransaction,
  User,
  WorkOrder,
} from '@/types';
import { CURRENT_DB_SCHEMA_VERSION } from '@/lib/dbSchema';
import { migrateLegacyDeviceCoordinates } from '@/domain/laboratory-layout';

// Deterministic PRNG so data is stable across refreshes
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

let rng = seeded(20260725);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function createSeedQrPublicIdFactory(): () => string {
  const qrRandom = seeded(20260819);
  return () => {
    const token = Array.from({ length: 32 }, () => Math.floor(qrRandom() * 16).toString(16)).join('');
    return `qr_${token}`;
  };
}

export const LABS: Laboratory[] = [
  {
    id: 'lab-rpl-1',
    name: 'LAB RPL 1',
    code: 'RPL1',
    location: 'Gedung A Lt. 1',
    capacity: 36,
    headName: 'Drs. Budi Santoso',
    technicianName: 'Andi Wijaya',
    pcCount: 36,
    status: 'active',
    layoutRows: 6,
    layoutCols: 6,
  },
  {
    id: 'lab-rpl-2',
    name: 'LAB RPL 2',
    code: 'RPL2',
    location: 'Gedung A Lt. 2',
    capacity: 36,
    headName: 'Siti Aminah, S.Kom',
    technicianName: 'Andi Wijaya',
    pcCount: 36,
    status: 'active',
    layoutRows: 6,
    layoutCols: 6,
  },
  {
    id: 'lab-rpl-3',
    name: 'LAB RPL 3',
    code: 'RPL3',
    location: 'Gedung B Lt. 1',
    capacity: 36,
    headName: 'Rudi Hartono, M.Kom',
    technicianName: 'Dedi Kurniawan',
    pcCount: 36,
    status: 'active',
    layoutRows: 6,
    layoutCols: 6,
  },
];

const BRANDS = ['Dell', 'HP', 'Lenovo', 'Asus'];
const MODELS = ['OptiPlex 7090', 'ProDesk 600 G6', 'ThinkCentre M70q', 'ExpertCenter D5'];
const OS_LIST = ['Windows 11 Pro', 'Windows 10 Pro', 'Ubuntu 22.04 LTS'];

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

interface SeedDeviceWithLegacyCoordinate extends Device {
  col: number;
  row: number;
}

function generateDevices(): SeedDeviceWithLegacyCoordinate[] {
  const devices: SeedDeviceWithLegacyCoordinate[] = [];
  const nextQrPublicId = createSeedQrPublicIdFactory();
  LABS.forEach((lab, labIdx) => {
    for (let i = 0; i < lab.pcCount; i++) {
      const n = i + 1;
      const col = (i % lab.layoutCols) + 1;
      const row = Math.floor(i / lab.layoutCols) + 1;
      const code = lab.code;
      const positionCode = `PC-${pad(n)}`;

      // Deterministic status distribution
      let status: Device['status'] = 'Online';
      rng();
      if (labIdx === 0) {
        if (n === 5) status = 'Critical';
        else if (n === 12) status = 'Warning';
        else if (n === 18) status = 'Maintenance';
        else if (n === 23) status = 'Offline';
        else if (n === 30) status = 'Reserved';
      } else if (labIdx === 1) {
        if (n === 3) status = 'Offline';
        else if (n === 15) status = 'Warning';
        else if (n === 27) status = 'Maintenance';
      } else {
        if (n === 7) status = 'Critical';
        else if (n === 20) status = 'Reserved';
      }

      const brand = BRANDS[(labIdx + n) % BRANDS.length];
      const model = MODELS[(labIdx + n) % MODELS.length];

      devices.push({
        id: `dev-${code}-${pad(n)}`,
        deviceType: 'desktop_pc',
        lifecycleStatus: 'in_service',
        qrPublicId: nextQrPublicId(),
        assetId: `ast-dev-${code}-${pad(n)}`,
        positionCode,
        hostname: `PC-${code}-${pad(n)}`,
        laboratoryId: lab.id,
        assetCode: `AST-${code}-${pad(n, 3)}`,
        ipAddress: `10.10.${labIdx + 1}.${n}`,
        macAddress: `02:00:${pad(labIdx + 1, 2)}:${pad(n, 2)}:${pad(n + 1, 2)}:${pad(n + 2, 2)}`,
        serialNumber: `SN${code}${pad(n, 3)}2024`,
        brand,
        model,
        yearAcquired: 2024,
        processor: pick(['Intel Core i5-11400', 'Intel Core i7-11700', 'AMD Ryzen 5 5600']),
        ramGB: pick([8, 16, 16]),
        storageGB: pick([256, 512, 512]),
        gpu: 'Intel UHD Graphics 730',
        monitor: 'Dell 24" P2422H',
        os: OS_LIST[(labIdx + n) % OS_LIST.length],
        status,
        cpuUsage: status === 'Online' ? randInt(8, 65) : status === 'Warning' ? randInt(70, 89) : 0,
        ramUsage: status === 'Online' ? randInt(20, 55) : status === 'Warning' ? randInt(75, 92) : 0,
        diskUsage: randInt(35, 80),
        temperature: status === 'Critical' ? randInt(82, 95) : randInt(42, 65),
        uptimeHours: status === 'Online' ? randInt(1, 120) : 0,
        network: status === 'Offline' ? 'Disconnected' : status === 'Warning' ? 'Limited' : 'Connected',
        lastHeartbeat: status === 'Offline' ? '2026-07-24T08:15:00Z' : '2026-07-25T07:30:00Z',
        peripherals: {
          monitor: n !== 23 && n !== 3,
          keyboard: n !== 23,
          mouse: n !== 5,
          headset: n % 6 === 0,
          network: status !== 'Offline',
          ups: n % 12 === 0,
        },
        col,
        row,
      });
    }
  });
  return devices;
}

const TEACHERS = [
  'Drs. Budi Santoso',
  'Siti Aminah, S.Kom',
  'Rudi Hartono, M.Kom',
  'Maya Putri, S.Pd',
  'Joko Susilo, M.Pd',
];
const CLASSES = ['X PPLG 1', 'X PPLG 2', 'XI PPLG 1', 'XI PPLG 2', 'XII PPLG 1', 'XII PPLG 2'];
const SUBJECTS = ['Pemrograman Web', 'Basis Data', 'Pemrograman Berorientasi Objek', 'Jaringan Komputer', 'Sistem Operasi'];
const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

const MASTER_DATA_SEED_VALUES: Record<MasterDataCategoryKey, string[]> = {
  'asset-category': ['Komputer', 'Proyektor', 'Printer', 'Networking', 'UPS', 'Furniture'],
  'asset-model': ['OptiPlex 7090', 'ProDesk 600 G6', 'ThinkCentre M70q', 'EB-X51', 'L3210'],
  'asset-condition': ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'],
  'asset-status': ['Aktif', 'Cadangan', 'Dipinjam', 'Maintenance', 'Rusak', 'Hilang', 'Dihapuskan'],
  class: CLASSES,
  teacher: TEACHERS,
  subject: SUBJECTS,
  'lesson-hour': ['1 JP', '2 JP', '3 JP', '4 JP'],
  'academic-year': ['2026/2027'],
  semester: ['Gasal', 'Genap'],
  'incident-category': ['hardware', 'software', 'jaringan', 'listrik', 'periferal', 'fasilitas', 'kebersihan', 'keamanan', 'lainnya'],
  supplier: ['PT Sumber Rezeki', 'PT Komputindo', 'PT Jaya Network'],
  'stock-unit': ['pcs', 'unit', 'set', 'box', 'botol', 'tube'],
  'stock-location': ['Gudang A', 'Gudang B', 'Gudang C'],
};

function masterDataSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function generateMasterData(): MasterDataCollection {
  return Object.fromEntries(Object.entries(MASTER_DATA_SEED_VALUES).map(([category, names]) => [
    category,
    names.map((name) => ({
      id: `md-${category}-${masterDataSlug(name)}`,
      category: category as MasterDataCategoryKey,
      name,
      isActive: true,
    })),
  ])) as MasterDataCollection;
}

function generateSchedules(): Schedule[] {
  const schedules: Schedule[] = [];
  let id = 1;
  DAYS.forEach((day, dIdx) => {
    const date = `2026-07-${pad(20 + dIdx)}`;
    LABS.forEach((lab) => {
      // 3 sessions per lab per day
      for (let s = 0; s < 3; s++) {
        const startH = 7 + s * 3;
        schedules.push({
          id: `sch-${pad(id++, 4)}`,
          day,
          date,
          startTime: `${pad(startH)}:00`,
          endTime: `${pad(startH + 2)}:30`,
          lessonHours: 3,
          laboratoryId: lab.id,
          className: pick(CLASSES),
          teacherName: pick(TEACHERS),
          subject: pick(SUBJECTS),
          activityType: 'Praktikum',
          status: 'Tetap',
          semester: 'Gasal',
        });
      }
    });
  });
  return schedules;
}

function generateJournals(): Journal[] {
  const journals: Journal[] = [];
  for (let i = 1; i <= 24; i++) {
    const lab = pick(LABS);
    const teacher = pick(TEACHERS);
    const cls = pick(CLASSES);
    const subject = pick(SUBJECTS);
    const day = randInt(1, 24);
    const status = (['Selesai', 'Selesai', 'Selesai', 'Diverifikasi', 'Draft', 'Perlu Perbaikan'] as const)[i % 6];
    journals.push({
      id: `jrn-${pad(i, 4)}`,
      journalNumber: `JRN-2026-${pad(i, 4)}`,
      date: `2026-07-${pad(day)}`,
      laboratoryId: lab.id,
      teacherName: teacher,
      className: cls,
      subject,
      hours: 3,
      material: `Praktikum ${subject} - Modul ${randInt(1, 8)}`,
      software: pick(['VS Code', 'MySQL Workbench', 'NetBeans', 'Packet Tracer']),
      presentCount: randInt(28, 36),
      absentCount: randInt(0, 4),
      initialCondition: 'Kondisi baik, semua PC siap digunakan',
      finalCondition: i % 5 === 0 ? 'PC-12 mengalami hang saat praktikum' : 'Kondisi baik setelah praktikum',
      issues: i % 4 === 0 ? `PC-${pad(randInt(1, 36))} error saat kompilasi` : '',
      followUp: i % 4 === 0 ? 'Lapor teknisi untuk pengecekan' : '-',
      status,
      source: i % 3 === 0 ? 'session' : 'manual',
    });
  }
  return journals;
}

function generateIncidents(): Incident[] {
  const incidents: Incident[] = [];
  const samples = [
    { title: 'PC-05 tidak bisa booting', cat: 'hardware' as const, desc: 'Saat dinyalakan hanya muncul layar hitam, tidak ada POST' },
    { title: 'Koneksi internet terputus di PC-12', cat: 'jaringan' as const, desc: 'LAN tidak terdeteksi, kabel kemungkinan rusak' },
    { title: 'Keyboard PC-08 tidak merespons', cat: 'periferal' as const, desc: 'Beberapa tombol tidak berfungsi' },
    { title: 'Windows error blue screen di PC-18', cat: 'software' as const, desc: 'BSOD saat menjalankan aplikasi berat' },
    { title: 'AC ruangan tidak dingin', cat: 'fasilitas' as const, desc: 'Suhu ruangan terasa panas saat praktikum' },
    { title: 'Mouse PC-20 macet', cat: 'periferal' as const, desc: 'Kursor tidak bergerak halus' },
    { title: 'Proyektor mati total', cat: 'hardware' as const, desc: 'Tidak menyala saat ditekan tombol power' },
    { title: 'PC-27 sering restart sendiri', cat: 'hardware' as const, desc: 'Random reboot setiap 15 menit' },
  ];
  samples.forEach((s, i) => {
    const lab = pick(LABS);
    const statuses = ['Dilaporkan', 'Diverifikasi', 'Ditugaskan', 'Diproses', 'Selesai', 'Ditutup'] as const;
    const status = statuses[i % statuses.length];
    incidents.push({
      id: `inc-${pad(i + 1, 4)}`,
      ticketNumber: `INC-2026-${pad(i + 1, 4)}`,
      reporterName: pick(TEACHERS),
      laboratoryId: lab.id,
      assetCode: `AST-${lab.code}-${pad(randInt(1, 36), 3)}`,
      date: `2026-07-${pad(randInt(1, 24))}T10:00:00Z`,
      category: s.cat,
      title: s.title,
      description: s.desc,
      impact: pick(['Tidak menghambat praktikum', 'Praktikum terhenti sebentar', 'Praktikum dialihkan']),
      priority: pick(['Rendah', 'Normal', 'Tinggi', 'Kritis']) as Incident['priority'],
      blocksPracticum: i % 3 === 0,
      stepsTaken: 'Sudah dicoba restart namun masalah masih ada',
      status,
      assignedTechnician: status !== 'Dilaporkan' ? 'Andi Wijaya' : undefined,
      workOrderId: status === 'Selesai' || status === 'Diproses' ? `wo-${pad(i + 1, 4)}` : undefined,
      comments:
        i % 2 === 0
          ? [{ at: '2026-07-22T09:00:00Z', by: 'Andi Wijaya', text: 'Sudah dicek, perlu ganti RAM' }]
          : [],
      timeline: [{ status: 'Dilaporkan', at: `2026-07-${pad(randInt(1, 20))}T10:00:00Z`, by: pick(TEACHERS) }],
    });
  });
  return incidents;
}

function generateWorkOrders(incidents: Incident[]): WorkOrder[] {
  const wos: WorkOrder[] = [];
  for (let i = 1; i <= 12; i++) {
    const inc = incidents[i % incidents.length];
    const lab = LABS.find((l) => l.id === inc.laboratoryId) ?? LABS[0];
    const statuses = ['Draft', 'Assigned', 'In Progress', 'Waiting Part', 'Completed', 'Verified'] as const;
    const status = statuses[i % statuses.length];
    wos.push({
      id: `wo-${pad(i, 4)}`,
      woNumber: `WO-2026-${pad(i, 4)}`,
      incidentId: inc.id,
      assetCode: inc.assetCode,
      laboratoryId: lab.id,
      technician: 'Andi Wijaya',
      priority: inc.priority,
      diagnosis: i % 2 === 0 ? 'RAM rusak, perlu penggantian' : 'Kabel LAN longgar',
      action: i % 2 === 0 ? 'Ganti RAM 8GB' : 'Pasang ulang konektor RJ45',
      scheduledDate: `2026-07-${pad(randInt(20, 28))}`,
      startTime: status !== 'Draft' && status !== 'Assigned' ? `2026-07-25T09:00:00Z` : undefined,
      endTime: status === 'Completed' || status === 'Verified' ? `2026-07-25T11:00:00Z` : undefined,
      downtimeHours: status === 'Completed' || status === 'Verified' ? 2 : undefined,
      spareParts:
        i % 2 === 0 ? [{ stockItemId: 'stk-001', name: 'RAM DDR4 8GB', quantity: 1 }] : [],
      cost: i % 2 === 0 ? 350000 : 25000,
      testResult: status === 'Verified' ? 'PC berjalan normal setelah perbaikan' : undefined,
      status,
      timeline: [{ status: 'Assigned', at: `2026-07-${pad(randInt(18, 22))}T08:00:00Z`, by: 'Admin Lab' }],
    });
  }
  return wos;
}

function generateAssets(devices: Device[]): Asset[] {
  const assets: Asset[] = [];
  // PC assets from devices
  devices.forEach((d) => {
    assets.push({
      id: `ast-${d.id}`,
      assetCode: d.assetCode,
      name: `${d.brand} ${d.model}`,
      category: 'Komputer',
      model: d.model,
      brand: d.brand,
      serialNumber: d.serialNumber,
      laboratoryId: d.laboratoryId,
      position: d.positionCode,
      yearAcquired: d.yearAcquired,
      fundingSource: 'BOS',
      price: 8500000,
      condition:
        d.status === 'Critical'
          ? 'Rusak Berat'
          : d.status === 'Warning'
          ? 'Rusak Ringan'
          : d.status === 'Maintenance'
          ? 'Rusak Sedang'
          : 'Baik',
      status:
        d.status === 'Offline' && d.positionCode === 'PC-23'
          ? 'Hilang'
          : d.status === 'Maintenance'
          ? 'Maintenance'
          : 'Aktif',
      purchaseDate: '2024-01-15',
      warrantyUntil: '2027-01-15',
      supplier: 'PT Sumber Rezeki',
    });
  });
  // Extra assets
  const extra = [
    { name: 'Proyektor Epson EB-X51', cat: 'Proyektor', price: 5500000, lab: 0 },
    { name: 'Printer Epson L3210', cat: 'Printer', price: 2200000, lab: 0 },
    { name: 'Switch Cisco SG250-24', cat: 'Networking', price: 3200000, lab: 0 },
    { name: 'Access Point TP-Link EAP245', cat: 'Networking', price: 1200000, lab: 1 },
    { name: 'UPS APC BR1500GI', cat: 'UPS', price: 2800000, lab: 1 },
    { name: 'Proyektor Epson EB-X51', cat: 'Proyektor', price: 5500000, lab: 2 },
  ];
  extra.forEach((e, i) => {
    assets.push({
      id: `ast-extra-${pad(i + 1)}`,
      assetCode: `AST-EXTRA-${pad(i + 1, 3)}`,
      name: e.name,
      category: e.cat,
      model: e.name,
      brand: e.name.split(' ')[0],
      serialNumber: `SNEX${pad(i + 1, 3)}`,
      laboratoryId: LABS[e.lab].id,
      position: 'Guru / Meja Teknisi',
      yearAcquired: 2023,
      fundingSource: 'BOS',
      price: e.price,
      condition: 'Baik',
      status: 'Aktif',
      purchaseDate: '2023-08-10',
      warrantyUntil: '2026-08-10',
      supplier: 'PT Sumber Rezeki',
    });
  });
  return assets;
}

function generateStock(): { items: StockItem[]; transactions: StockTransaction[] } {
  const items: StockItem[] = [
    { id: 'stk-001', name: 'RAM DDR4 8GB', category: 'Spare Part', unit: 'pcs', quantity: 12, minStock: 5, location: 'Gudang A', supplier: 'PT Komputindo', price: 350000 },
    { id: 'stk-002', name: 'SSD 256GB SATA', category: 'Spare Part', unit: 'pcs', quantity: 8, minStock: 5, location: 'Gudang A', supplier: 'PT Komputindo', price: 450000 },
    { id: 'stk-003', name: 'Mouse Logitech B100', category: 'Periferal', unit: 'pcs', quantity: 3, minStock: 10, location: 'Gudang A', supplier: 'PT Sumber Rezeki', price: 75000 },
    { id: 'stk-004', name: 'Keyboard Logitech K120', category: 'Periferal', unit: 'pcs', quantity: 15, minStock: 8, location: 'Gudang A', supplier: 'PT Sumber Rezeki', price: 120000 },
    { id: 'stk-005', name: 'Kabel LAN UTP 5m', category: 'Kabel', unit: 'pcs', quantity: 25, minStock: 10, location: 'Gudang B', supplier: 'PT Jaya Network', price: 25000 },
    { id: 'stk-006', name: 'Konektor RJ45', category: 'Kabel', unit: 'pcs', quantity: 4, minStock: 20, location: 'Gudang B', supplier: 'PT Jaya Network', price: 3500 },
    { id: 'stk-007', name: 'Tinta Printer Epson Hitam', category: 'Konsumable', unit: 'botol', quantity: 18, minStock: 6, location: 'Gudang A', supplier: 'PT Sumber Rezeki', price: 65000 },
    { id: 'stk-008', name: 'Thermal Paste', category: 'Spare Part', unit: 'tube', quantity: 6, minStock: 3, location: 'Gudang B', supplier: 'PT Komputindo', price: 45000 },
    { id: 'stk-009', name: 'Adaptor Laptop 19V', category: 'Spare Part', unit: 'pcs', quantity: 2, minStock: 5, location: 'Gudang A', supplier: 'PT Komputindo', price: 180000 },
    { id: 'stk-010', name: 'Cleaning Kit', category: 'Konsumable', unit: 'set', quantity: 9, minStock: 4, location: 'Gudang B', supplier: 'PT Sumber Rezeki', price: 55000 },
  ];
  const transactions: StockTransaction[] = [
    { id: 'stx-001', itemId: 'stk-001', type: 'in', quantity: 20, date: '2026-06-15', reason: 'Pembelian awal', by: 'Admin Lab' },
    { id: 'stx-002', itemId: 'stk-001', type: 'out', quantity: 8, date: '2026-07-10', reason: 'Work order WO-2026-0002', by: 'Andi Wijaya' },
    { id: 'stx-003', itemId: 'stk-003', type: 'out', quantity: 2, date: '2026-07-12', reason: 'Penggantian mouse rusak', by: 'Andi Wijaya' },
  ];
  return { items, transactions };
}

function generateBookings(): Booking[] {
  return [
    {
      id: 'bkg-0001',
      requesterName: 'Maya Putri, S.Pd',
      laboratoryId: 'lab-rpl-1',
      date: '2026-07-28',
      startTime: '13:00',
      endTime: '15:00',
      activity: 'Persiapan LKS Web Technologies',
      participants: 8,
      deviceNeeds: '8 PC dengan akses internet',
      notes: 'Untuk latihan tim LKS',
      PIC: 'Maya Putri, S.Pd',
      status: 'Menunggu Persetujuan',
      timeline: [
        { status: 'Diajukan', at: '2026-07-24T09:00:00Z', by: 'Maya Putri, S.Pd' },
        { status: 'Menunggu Persetujuan', at: '2026-07-24T09:30:00Z', by: 'Sistem' },
      ],
    },
    {
      id: 'bkg-0002',
      requesterName: 'Joko Susilo, M.Pd',
      laboratoryId: 'lab-rpl-2',
      date: '2026-07-26',
      startTime: '09:00',
      endTime: '11:00',
      activity: 'Workshop Laravel',
      participants: 30,
      deviceNeeds: 'Semua PC + proyektor',
      PIC: 'Joko Susilo, M.Pd',
      status: 'Disetujui',
      timeline: [
        { status: 'Diajukan', at: '2026-07-20T10:00:00Z', by: 'Joko Susilo, M.Pd' },
        { status: 'Disetujui', at: '2026-07-21T08:00:00Z', by: 'Drs. Budi Santoso' },
      ],
    },
    {
      id: 'bkg-0003',
      requesterName: 'Rudi Hartono, M.Kom',
      laboratoryId: 'lab-rpl-3',
      date: '2026-07-22',
      startTime: '14:00',
      endTime: '16:00',
      activity: 'Uji coba aplikasi',
      participants: 6,
      deviceNeeds: '6 PC',
      PIC: 'Rudi Hartono, M.Kom',
      status: 'Selesai',
      timeline: [
        { status: 'Diajukan', at: '2026-07-18T09:00:00Z', by: 'Rudi Hartono, M.Kom' },
        { status: 'Disetujui', at: '2026-07-19T08:00:00Z', by: 'Admin Lab' },
        { status: 'Selesai', at: '2026-07-22T16:00:00Z', by: 'Sistem' },
      ],
    },
  ];
}

function generateSessions(): Session[] {
  return [
    {
      id: 'ses-0001',
      laboratoryId: 'lab-rpl-1',
      scheduleId: 'sch-0001',
      teacherName: 'Drs. Budi Santoso',
      className: 'XI PPLG 1',
      subject: 'Pemrograman Web',
      participantCount: 34,
      startTime: '2026-07-25T07:00:00Z',
      initialCondition: 'Semua PC siap kecuali PC-05 (critical)',
      brokenPCsBefore: ['PC-05'],
      notes: 'Modul 5: React Components',
      status: 'Berlangsung',
    },
    {
      id: 'ses-0002',
      laboratoryId: 'lab-rpl-2',
      scheduleId: 'sch-0004',
      teacherName: 'Siti Aminah, S.Kom',
      className: 'X PPLG 1',
      subject: 'Basis Data',
      participantCount: 32,
      startTime: '2026-07-24T07:00:00Z',
      endTime: '2026-07-24T09:30:00Z',
      initialCondition: 'Kondisi baik',
      brokenPCsBefore: [],
      notes: 'Modul 3: Normalisasi',
      status: 'Selesai',
      finalMaterial: 'Normalisasi 1NF, 2NF, 3NF',
      finalSoftware: 'MySQL Workbench',
      presentCount: 32,
      absentCount: 0,
      finalCondition: 'Kondisi baik setelah praktikum',
      issues: '',
      brokenPCsAfter: [],
      followUp: '-',
      journalId: 'jrn-0001',
    },
    {
      id: 'ses-0003',
      laboratoryId: 'lab-rpl-3',
      scheduleId: 'sch-0007',
      teacherName: 'Rudi Hartono, M.Kom',
      className: 'XII PPLG 1',
      subject: 'Pemrograman Berorientasi Objek',
      participantCount: 30,
      startTime: '2026-07-26T07:00:00Z',
      initialCondition: 'Semua PC siap',
      brokenPCsBefore: [],
      notes: 'Modul 7: Design Pattern',
      status: 'Belum Dimulai',
    },
  ];
}

function generateLoans(): Loan[] {
  return [
    {
      id: 'loan-0001',
      borrowerName: 'Andi Pratama',
      unitOrClass: 'XII PPLG 1',
      itemName: 'Proyektor Epson EB-X51',
      quantity: 1,
      borrowDate: '2026-07-20',
      plannedReturn: '2026-07-22',
      purpose: 'Presentasi tugas akhir',
      PIC: 'Drs. Budi Santoso',
      conditionOut: 'Baik',
      status: 'Dipinjam',
    },
    {
      id: 'loan-0002',
      borrowerName: 'Siti Rahma',
      unitOrClass: 'XI PPLG 2',
      itemName: 'Mouse Logitech B100',
      quantity: 5,
      borrowDate: '2026-07-18',
      plannedReturn: '2026-07-20',
      actualReturn: '2026-07-24',
      purpose: 'Praktikum di kelas',
      PIC: 'Maya Putri, S.Pd',
      conditionOut: 'Baik',
      conditionReturn: 'Rusak Ringan',
      notes: '1 mouse tidak berfungsi',
      status: 'Diperiksa',
    },
    {
      id: 'loan-0003',
      borrowerName: 'Budi Santoso Jr',
      unitOrClass: 'X PPLG 1',
      itemName: 'Keyboard Logitech K120',
      quantity: 3,
      borrowDate: '2026-07-15',
      plannedReturn: '2026-07-17',
      purpose: 'Workshop',
      PIC: 'Joko Susilo, M.Pd',
      conditionOut: 'Baik',
      actualReturn: '2026-07-17',
      conditionReturn: 'Baik',
      status: 'Selesai',
    },
  ];
}

function generateMaintenance(): { plans: MaintenancePlan[]; executions: MaintenanceExecution[] } {
  const plans: MaintenancePlan[] = [
    {
      id: 'mp-001',
      name: 'Cleaning PC Lab RPL 1',
      assetCategory: 'Komputer',
      laboratoryId: 'lab-rpl-1',
      frequency: 'bulanan',
      checklist: ['Bersihkan keyboard', 'Bersihkan monitor', 'Cek kipas', 'Scan antivirus'],
      technician: 'Andi Wijaya',
      nextSchedule: '2026-08-01',
      status: 'active',
    },
    {
      id: 'mp-002',
      name: 'Update OS Lab RPL 2',
      assetCategory: 'Komputer',
      laboratoryId: 'lab-rpl-2',
      frequency: 'tiga bulanan',
      checklist: ['Update Windows', 'Update driver', 'Patch keamanan', 'Defrag disk'],
      technician: 'Andi Wijaya',
      nextSchedule: '2026-07-28',
      status: 'active',
    },
    {
      id: 'mp-003',
      name: 'Maintenance Jaringan Lab RPL 3',
      assetCategory: 'Networking',
      laboratoryId: 'lab-rpl-3',
      frequency: 'semester',
      checklist: ['Cek kabel LAN', 'Test throughput', 'Restart switch', 'Update firmware AP'],
      technician: 'Dedi Kurniawan',
      nextSchedule: '2026-07-20',
      status: 'active',
    },
  ];
  const executions: MaintenanceExecution[] = [
    {
      id: 'me-001',
      planId: 'mp-001',
      assetCode: 'AST-RPL1-001',
      laboratoryId: 'lab-rpl-1',
      technician: 'Andi Wijaya',
      date: '2026-06-15',
      checklist: [
        { item: 'Bersihkan keyboard', done: true },
        { item: 'Bersihkan monitor', done: true },
        { item: 'Cek kipas', done: true },
        { item: 'Scan antivirus', done: true },
      ],
      findings: 'Kipas PC-12 berdebu',
      action: 'Dibersihkan dan dites ulang',
      spareParts: [],
      conditionBefore: 'Baik',
      conditionAfter: 'Baik',
      nextSchedule: '2026-07-15',
    },
  ];
  return { plans, executions };
}

function generateCalendarEvents(): CalendarEvent[] {
  return [
    { id: 'cal-001', title: 'Awal Tahun Ajaran 2026/2027', date: '2026-07-13', category: 'kegiatan sekolah', description: 'Masa Pengenalan Lingkungan Sekolah' },
    { id: 'cal-002', title: 'Libur Hari Raya', date: '2026-07-17', endDate: '2026-07-20', category: 'libur' },
    { id: 'cal-003', title: 'Ujian Tengah Semester', date: '2026-09-21', endDate: '2026-09-28', category: 'ujian' },
    { id: 'cal-004', title: 'Maintenance Rutin Lab RPL 1', date: '2026-08-01', category: 'maintenance' },
    { id: 'cal-005', title: 'Workshop Laravel', date: '2026-07-26', category: 'workshop' },
    { id: 'cal-006', title: 'LKS Tingkat Provinsi', date: '2026-10-05', endDate: '2026-10-08', category: 'LKS' },
    { id: 'cal-007', title: 'Rapat Dinas Bulanan', date: '2026-07-30', category: 'rapat' },
    { id: 'cal-008', title: 'Hari Kemerdekaan RI', date: '2026-08-17', category: 'libur' },
  ];
}

function generateNotifications(): Notification[] {
  return [
    { id: 'n-001', category: 'incident', title: 'Incident baru', message: 'INC-2026-0001: PC-05 tidak bisa booting', at: '2026-07-25T06:30:00Z', read: false, link: '/incidents' },
    { id: 'n-002', category: 'work_order', title: 'Work order ditugaskan', message: 'WO-2026-0001 telah ditugaskan kepada Anda', at: '2026-07-25T07:00:00Z', read: false, link: '/work-orders' },
    { id: 'n-003', category: 'stock', title: 'Stok rendah', message: 'Stok Mouse Logitech B100 di bawah minimum (3/10)', at: '2026-07-24T15:00:00Z', read: false, link: '/stock' },
    { id: 'n-004', category: 'maintenance', title: 'Maintenance jatuh tempo', message: 'Maintenance Jaringan Lab RPL 3 jatuh tempo 20 Jul', at: '2026-07-24T09:00:00Z', read: true, link: '/maintenance' },
    { id: 'n-005', category: 'pc_offline', title: 'PC offline', message: 'PC-RPL1-23 offline lebih dari 24 jam', at: '2026-07-24T08:00:00Z', read: true, link: '/monitoring' },
    { id: 'n-006', category: 'booking', title: 'Booking menunggu persetujuan', message: 'Booking oleh Maya Putri menunggu approval', at: '2026-07-24T09:30:00Z', read: false, link: '/bookings' },
    { id: 'n-007', category: 'loan', title: 'Peminjaman terlambat', message: 'Peminjaman oleh Andi Pratama terlambat 3 hari', at: '2026-07-23T17:00:00Z', read: false, link: '/loans' },
  ];
}

function generateUsers(): User[] {
  return [
    { id: 'u-001', name: 'Super Admin', email: 'admin@smartlab.local', role: 'Super Admin', status: 'active', lastLogin: '2026-07-25T07:00:00Z' },
    { id: 'u-002', name: 'Andi Wijaya', email: 'teknisi@smartlab.local', role: 'Teknisi', unit: 'Lab RPL', phone: '081234567890', status: 'active', lastLogin: '2026-07-25T06:30:00Z' },
    { id: 'u-003', name: 'Drs. Budi Santoso', email: 'guru@smartlab.local', nip: '198501012010011001', role: 'Guru', unit: 'PPLG', phone: '081298765432', status: 'active', lastLogin: '2026-07-25T07:15:00Z' },
    { id: 'u-004', name: 'Drs. Hendra Wijaya, M.M', email: 'pimpinan@smartlab.local', nip: '197001011995031003', role: 'Pimpinan', unit: 'Kepala Program', phone: '081200001111', status: 'active', lastLogin: '2026-07-24T10:00:00Z' },
    { id: 'u-005', name: 'Siti Aminah, S.Kom', email: 'siti@smartlab.local', nip: '199003152015042002', role: 'Admin Lab', unit: 'Lab RPL', phone: '081233344455', status: 'active', lastLogin: '2026-07-25T08:00:00Z' },
    { id: 'u-006', name: 'Rudi Hartono, M.Kom', email: 'rudi@smartlab.local', nip: '198807202014031004', role: 'Kepala Lab', unit: 'Lab RPL', phone: '081277788899', status: 'active', lastLogin: '2026-07-25T06:45:00Z' },
  ];
}

export interface SeedData {
  schemaVersion: typeof CURRENT_DB_SCHEMA_VERSION;
  labs: Laboratory[];
  masterData: MasterDataCollection;
  devices: Device[];
  layouts: LaboratoryLayout[];
  schedules: Schedule[];
  bookings: Booking[];
  sessions: Session[];
  journals: Journal[];
  incidents: Incident[];
  workOrders: WorkOrder[];
  assets: Asset[];
  stock: { items: StockItem[]; transactions: StockTransaction[] };
  loans: Loan[];
  maintenance: { plans: MaintenancePlan[]; executions: MaintenanceExecution[] };
  calendarEvents: CalendarEvent[];
  notifications: Notification[];
  users: User[];
  auditLogs: AuditLog[];
}

export function generateSeedData(): SeedData {
  rng = seeded(20260725);
  const legacyDevices = generateDevices();
  const layouts = LABS.map((laboratory) => {
    const layoutId = `layout:${laboratory.id}:v1`;
    const migrated = migrateLegacyDeviceCoordinates({
      layoutId,
      laboratory,
      devices: legacyDevices,
      name: `${laboratory.name} — Denah Aktif`,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      layoutType: 'grid-classic',
      version: 1,
      status: 'active',
      isActive: true,
    });
    if (!migrated.ok) throw new Error(`Seed denah ${laboratory.id} tidak valid.`);
    return migrated.layout;
  });
  const devices = legacyDevices.map(({ row, col, ...device }) => {
    void row;
    void col;
    return device;
  });
  const incidents = generateIncidents();
  const workOrders = generateWorkOrders(incidents);
  const assets = generateAssets(devices);
  const stock = generateStock();
  const maintenance = generateMaintenance();
  return {
    schemaVersion: CURRENT_DB_SCHEMA_VERSION,
    labs: LABS,
    masterData: generateMasterData(),
    devices,
    layouts,
    schedules: generateSchedules(),
    bookings: generateBookings(),
    sessions: generateSessions(),
    journals: generateJournals(),
    incidents,
    workOrders,
    assets,
    stock,
    loans: generateLoans(),
    maintenance,
    calendarEvents: generateCalendarEvents(),
    notifications: generateNotifications(),
    users: generateUsers(),
    auditLogs: [
      { id: 'al-001', at: '2026-07-25T07:00:00Z', userName: 'Super Admin', role: 'Super Admin', module: 'auth', action: 'login', object: 'session', device: 'Chrome / Windows' },
      { id: 'al-002', at: '2026-07-25T07:05:00Z', userName: 'Andi Wijaya', role: 'Teknisi', module: 'work-orders', action: 'update', object: 'WO-2026-0001', oldValue: 'Assigned', newValue: 'In Progress', device: 'Chrome / Windows' },
      { id: 'al-003', at: '2026-07-25T07:10:00Z', userName: 'Siti Aminah, S.Kom', role: 'Admin Lab', module: 'assets', action: 'create', object: 'AST-EXTRA-007', newValue: 'Proyektor', device: 'Chrome / Windows' },
    ],
  };
}
