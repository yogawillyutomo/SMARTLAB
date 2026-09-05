const STATUS_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  active: 'Aktif',
  inactive: 'Nonaktif',
  submitted: 'Diajukan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
  prepared: 'Disiapkan',
  in_progress: 'Sedang Berlangsung',
  ended: 'Selesai',
  draft: 'Draft',
  revision_required: 'Perlu Perbaikan',
  verified: 'Diverifikasi',
};

export function statusDisplayLabel(status: string): string {
  return STATUS_DISPLAY_LABELS[status] ?? status;
}
