import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Download, Package, Pencil, Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { useAuthStore } from '@/stores/authStore';
import { hasServerPermission } from '@/lib/authIdentity';
import { ApiClientError } from '@/lib/apiClient';
import { downloadCSV, formatCurrency } from '@/utils';
import {
  INVENTORY_CATEGORIES,
  INVENTORY_TRANSACTION_KINDS,
  INVENTORY_UNITS,
  inventoryGateway,
  isDiscreteInventoryUnit,
  type CreateInventoryItemInput,
  type InventoryItemDto,
  type InventoryTransactionDto,
  type InventoryTransactionKind,
  type UpdateInventoryItemInput,
} from '@/services/inventoryApi';

const KIND_LABELS: Record<InventoryTransactionKind, string> = {
  opening: 'Saldo Awal',
  receipt: 'Stok Masuk',
  issue: 'Stok Keluar',
  adjustment_in: 'Penyesuaian Masuk',
  adjustment_out: 'Penyesuaian Keluar',
};

type ItemForm = {
  itemCode: string;
  name: string;
  category: string;
  unit: string;
  minimumStock: string;
  storageLocation: string;
  supplierName: string;
  unitPriceSnapshot: string;
};

type MovementForm = {
  inventoryItemId: string;
  clientMutationId: string;
  kind: InventoryTransactionKind;
  quantity: string;
  reason: string;
  attempted: boolean;
};

const EMPTY_ITEM: ItemForm = {
  itemCode: '',
  name: '',
  category: 'Spare Part Komputer',
  unit: 'pcs',
  minimumStock: '0',
  storageLocation: '',
  supplierName: '',
  unitPriceSnapshot: '',
};

function newMutationId(): string {
  return crypto.randomUUID();
}

function messageFrom(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Inventory gagal.';
}

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function formatRupiahInput(value: string): string {
  if (value === '') return '';
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return '';
  return `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(amount)}`;
}

function toItemForm(item: InventoryItemDto): ItemForm {
  return {
    itemCode: item.itemCode,
    name: item.name,
    category: item.category,
    unit: item.unit,
    minimumStock: String(item.minimumStock),
    storageLocation: item.storageLocation ?? '',
    supplierName: item.supplierName ?? '',
    unitPriceSnapshot: item.unitPriceSnapshot === null ? '' : String(item.unitPriceSnapshot),
  };
}

function createItemInput(form: ItemForm): CreateInventoryItemInput {
  return {
    itemCode: form.itemCode,
    name: form.name,
    category: form.category,
    unit: form.unit,
    minimumStock: Number(form.minimumStock || 0),
    storageLocation: nullIfBlank(form.storageLocation),
    supplierName: nullIfBlank(form.supplierName),
    unitPriceSnapshot: form.unitPriceSnapshot === '' ? null : Number(form.unitPriceSnapshot),
  };
}

function updateItemInput(form: ItemForm): UpdateInventoryItemInput {
  const { itemCode: _itemCode, ...input } = createItemInput(form);
  void _itemCode;
  return input;
}

export function StockPage() {
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'stock.create');
  const canUpdate = hasServerPermission(user, 'stock.update');
  const canTransact = hasServerPermission(user, 'stock.transact');
  const canExport = hasServerPermission(user, 'stock.export');

  const [items, setItems] = useState<InventoryItemDto[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<'items' | 'transactions'>('items');
  const [itemOpen, setItemOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryItemDto | null>(null);
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movement, setMovement] = useState<MovementForm>({
    inventoryItemId: '',
    clientMutationId: newMutationId(),
    kind: 'receipt',
    quantity: '1',
    reason: '',
    attempted: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextItems, nextTransactions] = await Promise.all([
        inventoryGateway.listAllItems(),
        inventoryGateway.listAllTransactions(),
      ]);
      setItems(nextItems);
      setTransactions(nextTransactions);
    } catch (error) {
      setLoadError(messageFrom(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const transactionCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    transactions.forEach((transaction) => counts.set(
      transaction.inventoryItemId,
      (counts.get(transaction.inventoryItemId) ?? 0) + 1,
    ));
    return counts;
  }, [transactions]);

  const stats = useMemo(() => ({
    total: items.length,
    lowStock: items.filter((item) => item.onHandQuantity <= item.minimumStock).length,
    totalValue: items.reduce((sum, item) => sum + item.onHandQuantity * (item.unitPriceSnapshot ?? 0), 0),
    categories: new Set(items.map((item) => item.category)).size,
  }), [items]);

  function openCreate() {
    setEditing(null);
    setItemForm({ ...EMPTY_ITEM });
    setItemOpen(true);
  }

  function openEdit(item: InventoryItemDto) {
    setEditing(item);
    setItemForm(toItemForm(item));
    setItemOpen(true);
  }

  async function saveItem() {
    if (!itemForm.name.trim() || !itemForm.category.trim() || !itemForm.unit.trim() || (!editing && !itemForm.itemCode.trim())) {
      toast('Kode, nama, kategori, dan satuan wajib diisi.', 'error');
      return;
    }

    const minimumStock = Number(itemForm.minimumStock || 0);
    const unitPrice = itemForm.unitPriceSnapshot === '' ? null : Number(itemForm.unitPriceSnapshot);
    if (!Number.isSafeInteger(minimumStock) || minimumStock < 0) {
      toast('Minimum stok harus bilangan bulat 0 atau lebih.', 'error');
      return;
    }
    if (unitPrice !== null && (!Number.isSafeInteger(unitPrice) || unitPrice < 0)) {
      toast('Harga satuan harus Rupiah bulat tanpa desimal.', 'error');
      return;
    }

    try {
      if (editing) {
        await inventoryGateway.updateItem(editing.id, editing.version, updateItemInput(itemForm));
        toast('Metadata item diperbarui pada server.', 'success');
      } else {
        await inventoryGateway.createItem(createItemInput(itemForm));
        toast('Item stok dibuat dengan saldo awal 0.', 'success');
      }

      setItemOpen(false);
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  function openMovement(item: InventoryItemDto, kind: InventoryTransactionKind) {
    setMovement({
      inventoryItemId: item.id,
      clientMutationId: newMutationId(),
      kind,
      quantity: '1',
      reason: '',
      attempted: false,
    });
    setMovementOpen(true);
  }

  function updateMovement(patch: Partial<Omit<MovementForm, 'clientMutationId' | 'attempted'>>) {
    setMovement((current) => ({
      ...current,
      ...patch,
      clientMutationId: current.attempted ? newMutationId() : current.clientMutationId,
      attempted: false,
    }));
  }

  async function submitMovement() {
    const quantity = Number(movement.quantity);
    const selectedItem = items.find((item) => item.id === movement.inventoryItemId);
    const adjustment = movement.kind === 'adjustment_in' || movement.kind === 'adjustment_out';
    const wholeQuantityRequired = Boolean(selectedItem && isDiscreteInventoryUnit(selectedItem.unit) && !adjustment);

    if (!movement.inventoryItemId || !Number.isFinite(quantity) || quantity <= 0 || movement.reason.trim().length < 3) {
      toast('Item, jumlah positif, dan alasan minimal 3 karakter wajib diisi.', 'error');
      return;
    }
    if (wholeQuantityRequired && !Number.isSafeInteger(quantity)) {
      toast(`Satuan ${selectedItem?.unit ?? ''} hanya menerima jumlah bulat untuk transaksi normal.`, 'error');
      return;
    }

    setMovement((current) => ({ ...current, attempted: true }));

    try {
      const result = await inventoryGateway.transact({
        inventoryItemId: movement.inventoryItemId,
        clientMutationId: movement.clientMutationId,
        kind: movement.kind,
        quantity,
        reason: movement.reason.trim(),
      });

      toast(
        result.replayed
          ? 'Retry dikenali; transaksi lama direplay tanpa movement baru.'
          : 'Transaksi stok dicatat pada immutable ledger.',
        'success',
      );
      setMovementOpen(false);
      await load();
    } catch (error) {
      toast(messageFrom(error), 'error');
    }
  }

  function exportCsv() {
    downloadCSV('stok-canonical.csv', items.map((item) => ({
      Kode: item.itemCode,
      Nama: item.name,
      Kategori: item.category,
      Jumlah: item.onHandQuantity,
      Minimum: item.minimumStock,
      Satuan: item.unit,
      Lokasi: item.storageLocation ?? '',
      Supplier: item.supplierName ?? '',
      HargaSnapshot: item.unitPriceSnapshot ?? '',
    })));
  }

  const selectedMovementItem = items.find((item) => item.id === movement.inventoryItemId);
  const movementIsAdjustment = movement.kind === 'adjustment_in' || movement.kind === 'adjustment_out';
  const movementRequiresWholeQuantity = Boolean(
    selectedMovementItem
      && isDiscreteInventoryUnit(selectedMovementItem.unit)
      && !movementIsAdjustment,
  );
  const categoryOptions = [
    ...INVENTORY_CATEGORIES.map((category) => ({ value: category, label: category })),
    ...(itemForm.category && !(INVENTORY_CATEGORIES as readonly string[]).includes(itemForm.category)
      ? [{ value: itemForm.category, label: `${itemForm.category} (legacy)` }]
      : []),
  ];
  const unitOptions = [
    ...INVENTORY_UNITS.map((unit) => ({ value: unit, label: unit })),
    ...(itemForm.unit && !(INVENTORY_UNITS as readonly string[]).includes(itemForm.unit)
      ? [{ value: itemForm.unit, label: `${itemForm.unit} (legacy)` }]
      : []),
  ];

  const itemColumns: Column<InventoryItemDto>[] = [
    { key: 'code', header: 'Kode', sortable: true, render: (item) => <span className="font-medium text-ink-primary">{item.itemCode}</span> },
    { key: 'name', header: 'Nama', sortable: true },
    { key: 'category', header: 'Kategori', sortable: true },
    { key: 'quantity', header: 'On Hand', sortable: true, sortValue: (item) => item.onHandQuantity, render: (item) => <span className={item.onHandQuantity <= item.minimumStock ? 'font-semibold text-danger' : 'text-ink-primary'}>{item.onHandQuantity} {item.unit}</span> },
    { key: 'minimum', header: 'Minimum', render: (item) => <span className="text-ink-muted">{item.minimumStock} {item.unit}</span> },
    { key: 'status', header: 'Status', render: (item) => item.onHandQuantity <= item.minimumStock ? <Badge tone="danger" withIcon>Stok Rendah</Badge> : <Badge tone="success">Aman</Badge> },
    { key: 'location', header: 'Lokasi', render: (item) => item.storageLocation ?? '-' },
    { key: 'price', header: 'Harga Snapshot', sortValue: (item) => item.unitPriceSnapshot ?? 0, render: (item) => item.unitPriceSnapshot === null ? '-' : formatCurrency(item.unitPriceSnapshot) },
    { key: 'actions', header: 'Aksi', printHidden: true, render: (item) => (
      <div className="flex gap-1">
        {canTransact && transactionCountByItem.get(item.id) === undefined && item.onHandQuantity === 0 && <button title="Saldo awal" onClick={() => openMovement(item, 'opening')} className="rounded p-1 text-accent-content hover:bg-base-700"><ArrowDownToLine className="h-4 w-4" /></button>}
        {canTransact && <button title="Stok masuk" onClick={() => openMovement(item, 'receipt')} className="rounded p-1 text-success-foreground hover:bg-success/10"><ArrowDownToLine className="h-4 w-4" /></button>}
        {canTransact && <button title="Stok keluar" onClick={() => openMovement(item, 'issue')} className="rounded p-1 text-warning-foreground hover:bg-warning/10"><ArrowUpFromLine className="h-4 w-4" /></button>}
        {canUpdate && <button title="Edit metadata" onClick={() => openEdit(item)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
      </div>
    ) },
  ];

  const transactionColumns: Column<InventoryTransactionDto>[] = [
    { key: 'date', header: 'Waktu', sortable: true, sortValue: (tx) => tx.occurredAt, render: (tx) => new Date(tx.occurredAt).toLocaleString('id-ID') },
    { key: 'item', header: 'Item', render: (tx) => <span>{tx.itemCodeSnapshot} · {tx.itemNameSnapshot}</span> },
    { key: 'kind', header: 'Jenis', render: (tx) => <Badge tone={tx.signedDelta > 0 ? 'success' : 'warning'}>{KIND_LABELS[tx.kind]}</Badge> },
    { key: 'delta', header: 'Delta', render: (tx) => <span className={tx.signedDelta > 0 ? 'text-success-foreground' : 'text-warning-foreground'}>{tx.signedDelta > 0 ? '+' : ''}{tx.signedDelta} {tx.unitSnapshot}</span> },
    { key: 'balance', header: 'Saldo Setelah', render: (tx) => `${tx.balanceAfter} ${tx.unitSnapshot}` },
    { key: 'reason', header: 'Alasan' },
    { key: 'actor', header: 'Oleh', render: (tx) => tx.actorNameSnapshot },
  ];

  if (loading) {
    return <Card><CardContent><p className="text-sm text-ink-muted">Memuat inventory canonical...</p></CardContent></Card>;
  }

  if (loadError) {
    return <EmptyState title="Inventory tidak dapat dimuat" description={loadError} action={<Button onClick={() => void load()}>Coba Lagi</Button>} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stok & Spare Part"
        description="Saldo stok sekarang hanya berubah melalui immutable InventoryTransaction di server. Tidak ada direct quantity edit browser-local."
        icon={<Package className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCsv}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Item</Button>}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{stats.total}</p><p className="text-xs text-ink-muted">Jenis Item</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-danger">{stats.lowStock}</p><p className="text-xs text-ink-muted">Stok Rendah</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{formatCurrency(stats.totalValue)}</p><p className="text-xs text-ink-muted">Nilai Snapshot</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{stats.categories}</p><p className="text-xs text-ink-muted">Kategori</p></CardContent></Card>
      </div>

      {stats.lowStock > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4" />{stats.lowStock} item berada pada atau di bawah minimum stok.
        </div>
      )}

      <div className="print-hidden flex gap-2 border-b border-base-700">
        <button onClick={() => setTab('items')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'items' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Daftar Item</button>
        <button onClick={() => setTab('transactions')} className={`border-b-2 px-4 py-2.5 text-sm font-medium ${tab === 'transactions' ? 'border-accent-content text-accent-content' : 'border-transparent text-ink-muted'}`}>Immutable Ledger</button>
      </div>

      {tab === 'items'
        ? <Card><DataTable columns={itemColumns} data={items} rowKey={(item) => item.id} searchable searchKeys={(item) => `${item.itemCode} ${item.name} ${item.category} ${item.storageLocation ?? ''} ${item.supplierName ?? ''}`} /></Card>
        : <Card><DataTable columns={transactionColumns} data={transactions} rowKey={(tx) => tx.id} searchable searchKeys={(tx) => `${tx.itemCodeSnapshot} ${tx.itemNameSnapshot} ${tx.reason} ${tx.actorNameSnapshot}`} /></Card>}

      <FormDialog open={itemOpen} onClose={() => setItemOpen(false)} title={editing ? 'Edit Metadata Item' : 'Tambah Item Stok'} onSubmit={() => void saveItem()} size="md">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Kode Item" value={itemForm.itemCode} disabled={Boolean(editing)} onChange={(event) => setItemForm({ ...itemForm, itemCode: event.target.value })} />
          <Input label="Nama Item" value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} />
          <Select label="Kategori" value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })} options={categoryOptions} />
          <Select label="Satuan" value={itemForm.unit} disabled={Boolean(editing && transactionCountByItem.get(editing.id))} onChange={(event) => setItemForm({ ...itemForm, unit: event.target.value })} options={unitOptions} />
          <Input label="Minimum Stok" type="number" min="0" step="1" value={itemForm.minimumStock} onChange={(event) => setItemForm({ ...itemForm, minimumStock: event.target.value })} hint="Bilangan bulat; tidak menerima desimal." />
          <Input label="Lokasi Simpan" value={itemForm.storageLocation} onChange={(event) => setItemForm({ ...itemForm, storageLocation: event.target.value })} />
          <Input label="Supplier" value={itemForm.supplierName} onChange={(event) => setItemForm({ ...itemForm, supplierName: event.target.value })} />
          <Input label="Harga Satuan Snapshot" type="text" inputMode="numeric" value={formatRupiahInput(itemForm.unitPriceSnapshot)} onChange={(event) => setItemForm({ ...itemForm, unitPriceSnapshot: digitsOnly(event.target.value) })} hint="Rupiah bulat, contoh Rp 650.000." />
          {!editing && <p className="sm:col-span-2 rounded-lg border border-base-700 bg-base-800/60 p-3 text-xs text-ink-muted">Jumlah tidak diisi di form metadata. Saldo awal harus dicatat sebagai transaksi <strong>opening</strong> agar history dapat direkonstruksi.</p>}
        </div>
      </FormDialog>

      <FormDialog open={movementOpen} onClose={() => setMovementOpen(false)} title="Transaksi Stok" onSubmit={() => void submitMovement()} submitLabel="Catat Transaksi" size="md">
        <div className="space-y-4">
          <Select label="Item" value={movement.inventoryItemId} onChange={(event) => updateMovement({ inventoryItemId: event.target.value })} options={items.map((item) => ({ value: item.id, label: `${item.itemCode} · ${item.name} (${item.onHandQuantity} ${item.unit})` }))} />
          <Select label="Jenis" value={movement.kind} onChange={(event) => updateMovement({ kind: event.target.value as InventoryTransactionKind })} options={INVENTORY_TRANSACTION_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))} />
          <Input
            label="Jumlah"
            type="number"
            min={movementRequiresWholeQuantity ? 1 : 0.001}
            step={movementRequiresWholeQuantity ? 1 : 0.001}
            value={movement.quantity}
            onChange={(event) => updateMovement({ quantity: event.target.value })}
            hint={movementRequiresWholeQuantity
              ? `Satuan ${selectedMovementItem?.unit ?? ''}: transaksi normal wajib bilangan bulat.`
              : movementIsAdjustment && selectedMovementItem && isDiscreteInventoryUnit(selectedMovementItem.unit)
                ? 'Penyesuaian boleh pecahan untuk rekonsiliasi residue historis; gunakan alasan yang eksplisit.'
                : 'Satuan ukur mendukung hingga 3 angka desimal.'}
          />
          <Textarea label="Alasan" value={movement.reason} onChange={(event) => updateMovement({ reason: event.target.value })} />
          <p className="text-xs text-ink-muted">Retry submit yang sama memakai clientMutationId yang sama. Jika payload diubah setelah percobaan, UI membuat mutation ID baru.</p>
        </div>
      </FormDialog>
    </div>
  );
}
