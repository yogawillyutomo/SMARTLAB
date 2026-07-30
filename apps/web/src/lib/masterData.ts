import type { MasterDataCategoryKey } from '@/types';

export type MasterDataNavigationKey = MasterDataCategoryKey | 'laboratory';

export interface MasterDataCategoryGroup {
  label: string;
  keys: readonly MasterDataNavigationKey[];
}

export const MASTER_DATA_CATEGORY_KEYS: readonly MasterDataCategoryKey[] = [
  'asset-category',
  'asset-model',
  'asset-condition',
  'asset-status',
  'class',
  'teacher',
  'subject',
  'lesson-hour',
  'academic-year',
  'semester',
  'incident-category',
  'supplier',
  'stock-unit',
  'stock-location',
];

export const MASTER_DATA_CATEGORY_LABELS: Record<MasterDataCategoryKey, string> = {
  'asset-category': 'Kategori Aset',
  'asset-model': 'Model Aset',
  'asset-condition': 'Kondisi Aset',
  'asset-status': 'Status Aset',
  class: 'Kelas',
  teacher: 'Guru',
  subject: 'Mata Pelajaran',
  'lesson-hour': 'Jam Pelajaran',
  'academic-year': 'Tahun Ajaran',
  semester: 'Semester',
  'incident-category': 'Kategori Incident',
  supplier: 'Supplier',
  'stock-unit': 'Satuan',
  'stock-location': 'Lokasi Stok',
};

export const MASTER_DATA_CATEGORY_DESCRIPTIONS: Record<MasterDataCategoryKey, string> = {
  'asset-category': 'Kelola kategori yang digunakan untuk mengelompokkan inventaris aset.',
  'asset-model': 'Daftar model perangkat dan aset yang digunakan di laboratorium.',
  'asset-condition': 'Kondisi referensi untuk pencatatan dan pemeliharaan aset.',
  'asset-status': 'Status referensi untuk memantau ketersediaan dan siklus hidup aset.',
  class: 'Daftar kelas yang dapat digunakan pada jadwal, sesi, dan jurnal.',
  teacher: 'Daftar guru yang terlibat dalam kegiatan laboratorium.',
  subject: 'Daftar mata pelajaran yang digunakan pada jadwal dan jurnal kegiatan.',
  'lesson-hour': 'Referensi durasi jam pelajaran untuk penjadwalan kegiatan.',
  'academic-year': 'Periode tahun ajaran yang digunakan pada administrasi laboratorium.',
  semester: 'Pilihan semester untuk jadwal, sesi, dan jurnal kegiatan.',
  'incident-category': 'Kelompok permasalahan untuk membantu klasifikasi dan tindak lanjut incident.',
  supplier: 'Daftar pemasok barang, perangkat, dan kebutuhan laboratorium.',
  'stock-unit': 'Satuan pengukuran untuk pencatatan stok dan kebutuhan operasional.',
  'stock-location': 'Lokasi penyimpanan stok, suku cadang, dan perlengkapan laboratorium.',
};

export const LABORATORY_NAVIGATION = {
  key: 'laboratory' as const,
  label: 'Laboratorium',
  description: 'Identitas, kapasitas, personel, dan denah laboratorium dikelola pada halaman khusus.',
};

export const MASTER_DATA_CATEGORY_GROUPS: readonly MasterDataCategoryGroup[] = [
  {
    label: 'Aset & Inventori',
    keys: ['asset-category', 'asset-model', 'asset-condition', 'asset-status', 'supplier', 'stock-unit', 'stock-location'],
  },
  {
    label: 'Akademik',
    keys: ['class', 'teacher', 'subject', 'lesson-hour', 'academic-year', 'semester'],
  },
  {
    label: 'Operasional',
    keys: ['incident-category', 'laboratory'],
  },
];
