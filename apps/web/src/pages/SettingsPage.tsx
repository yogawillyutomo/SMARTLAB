import { useState, useRef } from 'react';
import { Settings as SettingsIcon, Download, Upload, Trash2, RefreshCw, Palette, Database, Bell, Monitor, Moon, Sun, Save, Check } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useUIStore, type ThemeMode, type AccentColor } from '@/stores/uiStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { toast } from '@/stores/toastStore';
import { clearAllStorage, downloadJSON } from '@/utils';
import { cn } from '@/utils';

const TABS = [
  { key: 'general', label: 'Umum', icon: SettingsIcon },
  { key: 'appearance', label: 'Tampilan', icon: Palette },
  { key: 'data', label: 'Data Demo', icon: Database },
  { key: 'notifications', label: 'Notifikasi', icon: Bell },
];

type AccentOption = { value: AccentColor; label: string; swatchClass: string };

const ACCENT_OPTIONS: AccentOption[] = [
  { value: 'blue', label: 'Blue', swatchClass: 'bg-palette-blue' },
  { value: 'cyan', label: 'Cyan', swatchClass: 'bg-palette-cyan' },
  { value: 'indigo', label: 'Indigo', swatchClass: 'bg-palette-indigo' },
  { value: 'violet', label: 'Violet', swatchClass: 'bg-palette-violet' },
];

export function SettingsPage() {
  const { db, reset, exportDB, importDB } = useAppData();
  const canUpdate = usePermission('settings', 'update');
  const canManage = usePermission('settings', 'manage');
  const { theme, setTheme, accent, setAccent, compactTable, setCompactTable, academicYear, setAcademicYear, semester, setSemester } = useUIStore();
  const [tab, setTab] = useState('general');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: 'SMK Negeri 1 Purwokerto', program: 'PPLG', year: academicYear, semester });
  const fileRef = useRef<HTMLInputElement>(null);

  function handleReset() {
    if (!canManage) return;
    reset();
    toast('Data demo direset ke kondisi awal', 'success');
    setConfirmReset(false);
    setTimeout(() => window.location.reload(), 500);
  }

  function handleClear() {
    if (!canManage) return;
    clearAllStorage();
    toast('Semua data lokal dihapus', 'success');
    setConfirmClear(false);
    setTimeout(() => window.location.reload(), 500);
  }

  function handleExport() {
    if (!canManage) return;
    downloadJSON('smartlab-backup.json', JSON.parse(exportDB()));
    toast('Backup data berhasil diunduh', 'success');
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    if (!canManage) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      if (importDB(raw)) {
        toast('Data berhasil diimpor', 'success');
        setTimeout(() => window.location.reload(), 500);
      } else {
        toast('File backup tidak valid', 'error');
      }
    };
    reader.readAsText(file);
  }

  function saveGeneral() {
    if (!canUpdate) return;
    setAcademicYear(schoolForm.year);
    setSemester(schoolForm.semester);
    toast('Pengaturan disimpan', 'success');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Pengaturan" description="Konfigurasi sistem SmartLab" icon={<SettingsIcon className="h-5 w-5" />} />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <Card>
          <CardContent className="space-y-1 p-2">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.key} onClick={() => setTab(t.key)} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors', tab === t.key ? 'bg-accent-primary/15 text-accent-content' : 'text-ink-secondary hover:bg-base-700/60 hover:text-ink-primary')}>
                  <Icon className="h-4 w-4" />{t.label}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <div className="space-y-6">
          {tab === 'general' && (
            <>
              <Card>
                <CardHeader><CardTitle>Identitas Sekolah</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <Input label="Nama Sekolah" value={schoolForm.name} onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })} />
                  <Input label="Program Keahlian" value={schoolForm.program} onChange={(e) => setSchoolForm({ ...schoolForm, program: e.target.value })} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Tahun Ajaran" value={schoolForm.year} onChange={(e) => setSchoolForm({ ...schoolForm, year: e.target.value })} />
                    <Select label="Semester" value={schoolForm.semester} onChange={(e) => setSchoolForm({ ...schoolForm, semester: e.target.value })} options={[{ value: 'Gasal', label: 'Gasal' }, { value: 'Genap', label: 'Genap' }]} />
                  </div>
                  <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={saveGeneral} disabled={!canUpdate}>Simpan</Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Nomor Dokumen</CardTitle></CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Input label="Format Incident" defaultValue="INC-{YYYY}-{NNNN}" />
                  <Input label="Format Work Order" defaultValue="WO-{YYYY}-{NNNN}" />
                  <Input label="Format Jurnal" defaultValue="JRN-{YYYY}-{NNNN}" />
                  <Input label="Format Booking" defaultValue="BKG-{NNNN}" />
                </CardContent>
              </Card>
            </>
          )}

          {tab === 'appearance' && (
            <Card>
              <CardHeader><CardTitle>Tampilan</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <p className="mb-2 text-sm font-medium text-ink-secondary">Tema</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([['dark', Moon, 'Dark'], ['light', Sun, 'Light'], ['system', Monitor, 'System']] as const).map(([val, Icon, label]) => (
                      <button key={val} type="button" aria-pressed={theme === val} onClick={() => setTheme(val as ThemeMode)} className={cn('flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors', theme === val ? 'border-accent-content bg-accent-primary/10 text-accent-content' : 'border-base-700 text-ink-secondary hover:border-base-600')}>
                        <Icon className="h-5 w-5" />
                        <span className="text-xs font-medium">{label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">Gunakan tema Sistem untuk mengikuti pengaturan tampilan perangkat Anda.</p>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-ink-secondary">Warna Aksen</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {ACCENT_OPTIONS.map((option) => (
                      <button key={option.value} type="button" aria-label={`Pilih aksen ${option.label}`} aria-pressed={accent === option.value} onClick={() => setAccent(option.value)} className={cn('flex min-w-0 items-center gap-2 rounded-xl border p-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-base-900 hover:border-accent-content/60', accent === option.value ? 'border-accent-content bg-accent-primary/10 text-accent-content ring-1 ring-accent-content/30' : 'border-base-700 text-ink-secondary')}>
                        <span className={cn('h-5 w-5 shrink-0 rounded-full', option.swatchClass)} aria-hidden="true" />
                        <span className="min-w-0 truncate">{option.label}</span>
                        {accent === option.value && <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden="true" />}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">Warna aksen digunakan pada tombol utama, menu aktif, tautan, fokus, dan grafik.</p>
                </div>
                <div>
                  <label className="flex items-center justify-between rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-3">
                    <div><p className="text-sm font-medium text-ink-primary">Tabel Compact</p><p className="text-xs text-ink-muted">Tampilkan tabel dengan padding lebih rapat</p></div>
                    <input type="checkbox" checked={compactTable} onChange={(e) => setCompactTable(e.target.checked)} className="h-5 w-5 rounded border-base-600 text-accent-content" />
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {tab === 'data' && (
            <>
              <Card>
                <CardHeader><CardTitle>Backup dan Restore</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-ink-muted">Ekspor seluruh data lokal sebagai file JSON untuk backup, atau impor kembali untuk memulihkan.</p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleExport} disabled={!canManage}>Export JSON</Button>
                    <Button variant="secondary" size="sm" icon={<Upload className="h-4 w-4" />} onClick={() => fileRef.current?.click()} disabled={!canManage}>Import JSON</Button>
                    <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} className="hidden" />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Data Demo</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3"><p className="text-lg font-bold text-ink-primary">{db.labs.length}</p><p className="text-xs text-ink-muted">Laboratorium</p></div>
                    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3"><p className="text-lg font-bold text-ink-primary">{db.devices.length}</p><p className="text-xs text-ink-muted">Perangkat</p></div>
                    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3"><p className="text-lg font-bold text-ink-primary">{db.assets.length}</p><p className="text-xs text-ink-muted">Aset</p></div>
                    <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3"><p className="text-lg font-bold text-ink-primary">{db.incidents.length}</p><p className="text-xs text-ink-muted">Incident</p></div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="warning" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirmReset(true)} disabled={!canManage}>Reset Data Demo</Button>
                    <Button variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmClear(true)} disabled={!canManage}>Hapus Semua Data</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {tab === 'notifications' && (
            <Card>
              <CardHeader><CardTitle>Preferensi Notifikasi</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {['Incident Baru', 'Work Order', 'Maintenance Overdue', 'Stok Rendah', 'Booking Baru', 'Jurnal', 'Peminjaman Terlambat', 'PC Offline'].map((n) => (
                  <label key={n} className="flex items-center justify-between rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-2.5">
                    <span className="text-sm text-ink-secondary">{n}</span>
                    <input type="checkbox" defaultChecked className="rounded border-base-600 text-accent-content" />
                  </label>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmDialog open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={handleReset} title="Reset Data Demo" message="Semua perubahan akan dikembalikan ke data demo awal. Lanjutkan?" confirmLabel="Reset" />
      <ConfirmDialog open={confirmClear} onClose={() => setConfirmClear(false)} onConfirm={handleClear} title="Hapus Semua Data" message="Seluruh data lokal akan dihapus permanen dan aplikasi akan dimuat ulang. Lanjutkan?" confirmLabel="Hapus Semua" />
    </div>
  );
}
