import type { MasterDataCategoryKey } from '@/types';

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
