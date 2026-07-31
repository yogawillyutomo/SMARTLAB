import { useMemo, useState } from 'react';
import { Package, Plus, Pencil, Trash2, Download, ArrowDownToLine, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { toast } from '@/stores/toastStore';
import { downloadCSV, formatCurrency } from '@/utils';
import type { StockItem, StockTransaction } from '@/types';

export function StockPage() {
  const { db, mutate } = useAppData();
  const canCreate = usePermission('stock', 'create');
  const canUpdate = usePermission('stock', 'update');
  const canDelete = usePermission('stock', 'delete');
  const canExport = usePermission('stock', 'export');
  const [open, setOpen] = useState(false);
  const [txOpen, setTxOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<StockItem | null>(null);
  const [editing, setEditing] = useState<StockItem | null>(null);
  const [form, setForm] = useState<Partial<StockItem>>({});
  const [txForm, setTxForm] = useState<{ itemId: string; type: 'in' | 'out' | 'adjust'; quantity: number; reason: string }>({ itemId: '', type: 'in', quantity: 1, reason: '' });
  const [txTab, setTxTab] = useState('items');

  const stats = useMemo(() => ({
    total: db.stock.items.length,
    lowStock: db.stock.items.filter((s) => s.quantity <= s.minStock).length,
    totalValue: db.stock.items.reduce((sum, s) => sum + s.quantity * s.price, 0),
    categories: [...new Set(db.stock.items.map((s) => s.category))].length,
  }), [db.stock]);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ unit: 'pcs', quantity: 0, minStock: 5, price: 0, location: 'Gudang A' });
    setOpen(true);
  }
  function openEdit(s: StockItem) { if (!canUpdate) return; setEditing(s); setForm(s); setOpen(true); }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.name) { toast('Nama barang wajib diisi', 'error'); return; }
    mutate((d) => {
      if (editing) {
        const idx = d.stock.items.findIndex((s) => s.id === editing.id);
        if (idx >= 0) d.stock.items[idx] = { ...d.stock.items[idx], ...form } as StockItem;
      } else {
        d.stock.items.push({ ...form, id: `stk-${Date.now()}` } as StockItem);
      }
    });
    toast(editing ? 'Barang diperbarui' : 'Barang ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.stock.items = d.stock.items.filter((s) => s.id !== confirmDel.id); });
    toast('Barang dihapus', 'success');
    setConfirmDel(null);
  }

  function addTransaction() {
    if (!canCreate) return;
    if (!txForm.itemId || txForm.quantity <= 0) { toast('Lengkapi data transaksi', 'error'); return; }
    const item = db.stock.items.find((s) => s.id === txForm.itemId);
    if (!item) return;
    if (txForm.type === 'out' && txForm.quantity > item.quantity) { toast('Stok tidak mencukupi. Tidak boleh negatif.', 'error'); return; }
    mutate((d) => {
      const idx = d.stock.items.findIndex((s) => s.id === txForm.itemId);
      if (idx >= 0) {
        const delta = txForm.type === 'in' ? txForm.quantity : txForm.type === 'out' ? -txForm.quantity : 0;
        d.stock.items[idx].quantity = Math.max(0, d.stock.items[idx].quantity + delta);
        d.stock.transactions.unshift({ id: `stx-${Date.now()}`, itemId: txForm.itemId, type: txForm.type, quantity: txForm.quantity, date: new Date().toISOString().split('T')[0], reason: txForm.reason, by: 'Admin' });
      }
    });
    toast('Transaksi stok ditambahkan', 'success');
    setTxOpen(false);
    setTxForm({ itemId: '', type: 'in', quantity: 1, reason: '' });
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('stok-spare-part.csv', db.stock.items.map((s) => ({ Nama: s.name, Kategori: s.category, Jumlah: s.quantity, Min: s.minStock, Satuan: s.unit, Lokasi: s.location, Supplier: s.supplier, Harga: s.price })));
  }

  const columns: Column<StockItem>[] = [
    { key: 'name', header: 'Nama', sortable: true, render: (s) => <span className="font-medium text-ink-primary">{s.name}</span> },
    { key: 'category', header: 'Kategori', sortable: true },
    { key: 'quantity', header: 'Jumlah', sortable: true, render: (s) => <span className={s.quantity <= s.minStock ? 'text-danger font-semibold' : 'text-ink-primary'}>{s.quantity} {s.unit}</span> },
    { key: 'minStock', header: 'Min', render: (s) => <span className="text-ink-muted">{s.minStock} {s.unit}</span> },
    { key: 'status', header: 'Status', render: (s) => s.quantity <= s.minStock ? <Badge tone="danger" withIcon>Stok Rendah</Badge> : <Badge tone="success">Aman</Badge> },
    { key: 'location', header: 'Lokasi' },
    { key: 'supplier', header: 'Supplier' },
    { key: 'price', header: 'Harga', sortable: true, sortValue: (s) => s.price, render: (s) => <span className="text-ink-muted">{formatCurrency(s.price)}</span> },
    { key: 'actions', header: 'Aksi', printHidden: true, render: (s) => (
      <div className="flex gap-1">
        {canCreate && <button onClick={() => { setTxOpen(true); setTxForm({ itemId: s.id, type: 'in', quantity: 1, reason: '' }); }} className="rounded p-1 text-success-foreground hover:bg-success/10" title="Stok masuk"><ArrowDownToLine className="h-4 w-4" /></button>}
        {canCreate && <button onClick={() => { setTxOpen(true); setTxForm({ itemId: s.id, type: 'out', quantity: 1, reason: '' }); }} className="rounded p-1 text-warning-foreground hover:bg-warning/10" title="Stok keluar"><ArrowUpFromLine className="h-4 w-4" /></button>}
        {canUpdate && <button onClick={() => openEdit(s)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
        {canDelete && <button onClick={() => setConfirmDel(s)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
      </div>
    ) },
  ];

  const txColumns: Column<StockTransaction>[] = [
    { key: 'date', header: 'Tanggal', sortable: true },
    { key: 'item', header: 'Barang', render: (t) => db.stock.items.find((s) => s.id === t.itemId)?.name ?? '-' },
    { key: 'type', header: 'Tipe', render: (t) => <Badge tone={t.type === 'in' ? 'success' : t.type === 'out' ? 'warning' : 'info'}>{t.type === 'in' ? 'Masuk' : t.type === 'out' ? 'Keluar' : 'Adjust'}</Badge> },
    { key: 'quantity', header: 'Jumlah', render: (t) => `${t.type === 'out' ? '-' : '+'}${t.quantity}` },
    { key: 'reason', header: 'Alasan' },
    { key: 'by', header: 'Oleh' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Stok & Spare Part" description="Kelola persediaan barang habis pakai, komponen pengganti, dan transaksi stok." icon={<Package className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Barang</Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{stats.total}</p><p className="text-xs text-ink-muted">Jenis Barang</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-danger">{stats.lowStock}</p><p className="text-xs text-ink-muted">Stok Rendah</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{formatCurrency(stats.totalValue)}</p><p className="text-xs text-ink-muted">Nilai Stok</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{stats.categories}</p><p className="text-xs text-ink-muted">Kategori</p></CardContent></Card>
      </div>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4" /> {stats.lowStock} barang di bawah stok minimum
        </div>
      )}

      <div className="print-hidden flex gap-2 border-b border-base-700">
        <button onClick={() => setTxTab('items')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${txTab === 'items' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Daftar Barang</button>
        <button onClick={() => setTxTab('transactions')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${txTab === 'transactions' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Histori Transaksi</button>
      </div>

      {txTab === 'items' ? (
        <Card><DataTable columns={columns} data={db.stock.items} rowKey={(s) => s.id} searchable searchKeys={(s) => `${s.name} ${s.category} ${s.supplier}`} /></Card>
      ) : (
        <Card><DataTable columns={txColumns} data={db.stock.transactions} rowKey={(t) => t.id} searchable searchKeys={(t) => `${t.reason} ${t.by}`} /></Card>
      )}

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Barang' : 'Tambah Barang'} onSubmit={save} size="md">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input label="Nama Barang" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <Input label="Kategori" value={form.category ?? ''} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Input label="Satuan" value={form.unit ?? ''} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <Input label="Jumlah" type="number" value={form.quantity ?? 0} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          <Input label="Min Stok" type="number" value={form.minStock ?? 0} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
          <Input label="Lokasi" value={form.location ?? ''} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Input label="Supplier" value={form.supplier ?? ''} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          <Input label="Harga" type="number" value={form.price ?? 0} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
        </div>
      </FormDialog>

      <FormDialog open={txOpen} onClose={() => setTxOpen(false)} title="Transaksi Stok" onSubmit={addTransaction} size="md" submitLabel="Simpan Transaksi">
        <div className="space-y-4">
          <Select label="Barang" value={txForm.itemId} onChange={(e) => setTxForm({ ...txForm, itemId: e.target.value })} options={db.stock.items.map((s) => ({ value: s.id, label: `${s.name} (${s.quantity} ${s.unit})` }))} />
          <Select label="Tipe" value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value as 'in' | 'out' | 'adjust' })} options={[{ value: 'in', label: 'Stok Masuk' }, { value: 'out', label: 'Stok Keluar' }, { value: 'adjust', label: 'Penyesuaian' }]} />
          <Input label="Jumlah" type="number" value={txForm.quantity} onChange={(e) => setTxForm({ ...txForm, quantity: Number(e.target.value) })} />
          <Textarea label="Alasan" value={txForm.reason} onChange={(e) => setTxForm({ ...txForm, reason: e.target.value })} />
        </div>
      </FormDialog>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus barang ${confirmDel?.name}?`} confirmLabel="Hapus" />
    </div>
  );
}
