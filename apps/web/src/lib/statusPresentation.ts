const STATUS_DISPLAY_LABELS: Readonly<Record<string, string>> = {
  active: 'Aktif',
  inactive: 'Nonaktif',
};

export function statusDisplayLabel(status: string): string {
  return STATUS_DISPLAY_LABELS[status] ?? status;
}
