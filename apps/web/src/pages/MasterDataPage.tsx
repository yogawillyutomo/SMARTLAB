import { useMemo, useState } from 'react';
import { Database, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { cn } from '@/utils';

export function MasterDataPage() {
  const { db } = useAppData();
  const canCreate = usePermission('master-data', 'create');
  const canDelete = usePermission('master-data', 'delete');
  const [tab, setTab] = useState('kategori aset');

  const data = useMemo(() => {
    const tabs: { key: string; label: string; items: { id: string; name: string; code?: string }[] }[] = [
      { key: 'kategori aset', label: 'Kategori Aset', items: ['Komputer', 'Proyektor', 'Printer', 'Networking', 'UPS', 'Furniture'].map((n, i) => ({ id: `md-ka-${i}`, name: n })) },
      { key: 'model aset', label: 'Model Aset', items: ['OptiPlex 7090', 'ProDesk 600 G6', 'ThinkCentre M70q', 'EB-X51', 'L3210'].map((n, i) => ({ id: `md-ma-${i}`, name: n })) },
      { key: 'kondisi aset', label: 'Kondisi Aset', items: ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat', 'Tidak Diketahui'].map((n, i) => ({ id: `md-kk-${i}`, name: n })) },
      { key: 'status aset', label: 'Status Aset', items: ['Aktif', 'Cadangan', 'Dipinjam', 'Maintenance', 'Rusak', 'Hilang', 'Dihapuskan'].map((n, i) => ({ id: `md-sa-${i}`, name: n })) },
      { key: 'laboratorium', label: 'Laboratorium', items: db.labs.map((l) => ({ id: l.id, name: l.name, code: l.code })) },
      { key: 'kelas', label: 'Kelas', items: ['X PPLG 1', 'X PPLG 2', 'XI PPLG 1', 'XI PPLG 2', 'XII PPLG 1', 'XII PPLG 2'].map((n, i) => ({ id: `md-k-${i}`, name: n })) },
      { key: 'guru', label: 'Guru', items: ['Drs. Budi Santoso', 'Siti Aminah, S.Kom', 'Rudi Hartono, M.Kom', 'Maya Putri, S.Pd', 'Joko Susilo, M.Pd'].map((n, i) => ({ id: `md-g-${i}`, name: n })) },
      { key: 'mata pelajaran', label: 'Mata Pelajaran', items: ['Pemrograman Web', 'Basis Data', 'Pemrograman Berorientasi Objek', 'Jaringan Komputer', 'Sistem Operasi'].map((n, i) => ({ id: `md-mp-${i}`, name: n })) },
      { key: 'jam pelajaran', label: 'Jam Pelajaran', items: ['1 JP', '2 JP', '3 JP', '4 JP'].map((n, i) => ({ id: `md-jp-${i}`, name: n })) },
      { key: 'tahun ajaran', label: 'Tahun Ajaran', items: ['2026/2027'].map((n, i) => ({ id: `md-ta-${i}`, name: n })) },
      { key: 'semester', label: 'Semester', items: ['Gasal', 'Genap'].map((n, i) => ({ id: `md-sm-${i}`, name: n })) },
      { key: 'kategori incident', label: 'Kategori Incident', items: ['hardware', 'software', 'jaringan', 'listrik', 'periferal', 'fasilitas', 'kebersihan', 'keamanan', 'lainnya'].map((n, i) => ({ id: `md-ki-${i}`, name: n })) },
      { key: 'supplier', label: 'Supplier', items: ['PT Sumber Rezeki', 'PT Komputindo', 'PT Jaya Network'].map((n, i) => ({ id: `md-sp-${i}`, name: n })) },
      { key: 'satuan', label: 'Satuan', items: ['pcs', 'unit', 'set', 'box', 'botol', 'tube'].map((n, i) => ({ id: `md-st-${i}`, name: n })) },
      { key: 'lokasi stok', label: 'Lokasi Stok', items: ['Gudang A', 'Gudang B', 'Gudang C'].map((n, i) => ({ id: `md-ls-${i}`, name: n })) },
    ];
    return tabs;
  }, [db.labs]);

  const activeTab = data.find((t) => t.key === tab) ?? data[0];
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; code?: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<{ name: string; code?: string }>({ name: '' });

  function openCreate() { setEditing(null); setForm({ name: '' }); setOpen(true); }
  function openEdit(item: { id: string; name: string; code?: string }) { setEditing(item); setForm(item); setOpen(true); }

  function save() {
    if (!form.name) { toast('Nama wajib diisi', 'error'); return; }
    toast(editing ? 'Data diperbarui (demo)' : 'Data ditambahkan (demo)', 'success');
    setOpen(false);
  }

  function remove() {
    toast('Data dihapus (demo)', 'success');
    setConfirmDel(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Master Data" description="Data referensi sistem" icon={<Database className="h-5 w-5" />}
        actions={canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah</Button>}
      />
      <Card>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', tab === t.key ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-base-700 text-ink-secondary hover:border-base-600')}>
                {t.label} ({t.items.length})
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{activeTab.label}</CardTitle></CardHeader>
        <CardContent>
          {activeTab.items.length === 0 ? <EmptyState title="Belum ada data" /> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {activeTab.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-base-700/60 bg-base-800/40 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-primary truncate">{item.name}</p>
                    {item.code && <p className="text-xs text-ink-muted">{item.code}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {canCreate && <button onClick={() => openEdit(item)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-3.5 w-3.5" /></button>}
                    {canDelete && <button onClick={() => setConfirmDel(item)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Data' : 'Tambah Data'} onSubmit={save} size="sm">
        <Input label="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        {activeTab.key === 'laboratorium' && <Input label="Kode" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-4" />}
      </FormDialog>
      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus "${confirmDel?.name}"?`} confirmLabel="Hapus" />
    </div>
  );
}
