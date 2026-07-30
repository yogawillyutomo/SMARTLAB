import { useMemo, useState } from 'react';
import { ArrowUpRight, Database, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import {
  LABORATORY_NAVIGATION,
  MASTER_DATA_CATEGORY_DESCRIPTIONS,
  MASTER_DATA_CATEGORY_GROUPS,
  MASTER_DATA_CATEGORY_KEYS,
  MASTER_DATA_CATEGORY_LABELS,
  type MasterDataNavigationKey,
} from '@/lib/masterData';
import { masterDataRepository, type MasterDataActorContext } from '@/services/repositories';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { toast } from '@/stores/toastStore';
import type { MasterDataCategoryKey, MasterDataItem } from '@/types';
import { cn } from '@/utils';

interface NavigationItem {
  key: MasterDataNavigationKey;
  label: string;
  description: string;
  count: number;
}

interface MasterDataForm {
  name: string;
  code: string;
  isActive: boolean;
}

const EMPTY_FORM: MasterDataForm = { name: '', code: '', isActive: true };

function isGenericCategory(key: MasterDataNavigationKey): key is MasterDataCategoryKey {
  return key !== 'laboratory';
}

export function MasterDataPage() {
  const navigate = useNavigate();
  const { db, refresh } = useAppData();
  const user = useAuthStore((state) => state.user);
  const permissions = usePermissionStore((state) => state.permissions);
  const canCreate = usePermission('master-data', 'create');
  const canUpdate = usePermission('master-data', 'update');
  const canDelete = usePermission('master-data', 'delete');
  const canViewLaboratories = usePermission('laboratories', 'view');
  const [category, setCategory] = useState<MasterDataNavigationKey>('asset-category');
  const [categorySearch, setCategorySearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MasterDataItem | null>(null);
  const [confirmDel, setConfirmDel] = useState<MasterDataItem | null>(null);
  const [form, setForm] = useState<MasterDataForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const navigationItems = useMemo<NavigationItem[]>(() => [
    ...MASTER_DATA_CATEGORY_KEYS.map((key) => ({
      key,
      label: MASTER_DATA_CATEGORY_LABELS[key],
      description: MASTER_DATA_CATEGORY_DESCRIPTIONS[key],
      count: db.masterData[key].length,
    })),
    {
      ...LABORATORY_NAVIGATION,
      count: db.labs.length,
    },
  ], [db.labs.length, db.masterData]);

  const activeItem = navigationItems.find((item) => item.key === category) ?? navigationItems[0];
  const activeCategory = isGenericCategory(activeItem.key) ? activeItem.key : null;
  const activeItems = activeCategory ? db.masterData[activeCategory] : [];
  const normalizedCategorySearch = categorySearch.trim().toLowerCase();

  const groupedNavigation = useMemo(() => {
    const itemsByKey = new Map<MasterDataNavigationKey, NavigationItem>(navigationItems.map((item) => [item.key, item]));
    return MASTER_DATA_CATEGORY_GROUPS.map((group) => ({
      ...group,
      items: group.keys
        .map((key) => itemsByKey.get(key))
        .filter((item): item is NavigationItem => Boolean(item))
        .filter((item) => !normalizedCategorySearch || item.label.toLowerCase().includes(normalizedCategorySearch)),
    })).filter((group) => group.items.length > 0);
  }, [navigationItems, normalizedCategorySearch]);

  const categoryOptions = useMemo(() => MASTER_DATA_CATEGORY_GROUPS.flatMap((group) => group.keys.map((key) => {
    const item = navigationItems.find((candidate) => candidate.key === key);
    return item ? { value: item.key, label: `${group.label} · ${item.label} (${item.count})` } : null;
  }).filter((item): item is { value: MasterDataNavigationKey; label: string } => Boolean(item))), [navigationItems]);

  const columns: Column<MasterDataItem>[] = [
    {
      key: 'name',
      header: 'Nama',
      sortable: true,
      sortValue: (item) => item.name.toLocaleLowerCase('id-ID'),
      render: (item) => <span className="font-medium text-ink-primary">{item.name}</span>,
    },
    {
      key: 'code',
      header: 'Kode',
      render: (item) => item.code ? <span className="font-mono text-xs text-ink-secondary">{item.code}</span> : <span className="text-ink-muted">—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (item) => <Badge tone={item.isActive === false ? 'muted' : 'success'}>{item.isActive === false ? 'Nonaktif' : 'Aktif'}</Badge>,
    },
    {
      key: 'actions',
      header: 'Aksi',
      className: 'w-24 text-right',
      render: (item) => (
        <div className="flex justify-end gap-1">
          {canUpdate && (
            <button
              type="button"
              onClick={() => openEdit(item)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-base-700 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              aria-label={`Edit ${item.name}`}
              title={`Edit ${item.name}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirmDel(item)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-base-700 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              aria-label={`Hapus ${item.name}`}
              title={`Hapus ${item.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  function actor(): MasterDataActorContext | null {
    return user ? { user, permissions } : null;
  }

  function closeForm() {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function selectCategory(nextCategory: MasterDataNavigationKey) {
    setCategory(nextCategory);
    closeForm();
    setConfirmDel(null);
  }

  function openCreate() {
    if (!activeCategory || !canCreate) return;
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(item: MasterDataItem) {
    if (!canUpdate) return;
    setEditing(item);
    setForm({ name: item.name, code: item.code ?? '', isActive: item.isActive !== false });
    setOpen(true);
  }

  async function save() {
    if (!activeCategory || isSaving || (editing ? !canUpdate : !canCreate)) return;
    const currentActor = actor();
    if (!currentActor) {
      toast('Sesi pengguna tidak tersedia', 'error');
      return;
    }

    setIsSaving(true);
    try {
      if (editing) {
        await masterDataRepository.updateItem(activeCategory, editing.id, form, currentActor);
      } else {
        await masterDataRepository.createItem(activeCategory, form, currentActor);
      }
      refresh();
      toast(editing ? 'Data diperbarui' : 'Data ditambahkan', 'success');
      closeForm();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal menyimpan data', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    if (!activeCategory || !confirmDel || isDeleting || !canDelete) return;
    const currentActor = actor();
    if (!currentActor) {
      toast('Sesi pengguna tidak tersedia', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      await masterDataRepository.deleteItem(activeCategory, confirmDel.id, currentActor);
      refresh();
      toast('Data dihapus', 'success');
      if (editing?.id === confirmDel.id) closeForm();
      setConfirmDel(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Gagal menghapus data', 'error');
    } finally {
      setIsDeleting(false);
    }
  }

  const addLabel = `Tambah ${activeItem.label}`;
  const searchPlaceholder = `Cari nama atau kode ${activeItem.label.toLocaleLowerCase('id-ID')}...`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data"
        description="Data referensi sistem"
        icon={<Database className="h-5 w-5" />}
        actions={!activeCategory ? undefined : canCreate && (
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate} aria-label={addLabel} title={addLabel}>
            <span className="sm:hidden">Tambah</span>
            <span className="hidden sm:inline">{addLabel}</span>
          </Button>
        )}
      />

      <Card className="overflow-hidden">
        <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="hidden border-r border-base-700/70 bg-base-800/50 p-4 lg:block">
            <Input
              label="Cari kategori"
              value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)}
              placeholder="Contoh: supplier"
              aria-label="Cari kategori master data"
            />
            <div className="mt-5 space-y-5">
              {groupedNavigation.length === 0 ? (
                <EmptyState title="Kategori tidak ditemukan" description="Coba gunakan kata kunci kategori yang berbeda." className="py-8" />
              ) : groupedNavigation.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => selectCategory(item.key)}
                        aria-current={activeItem.key === item.key ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
                          activeItem.key === item.key
                            ? 'border-accent-blue/50 bg-accent-blue/10 text-accent-blue'
                            : 'border-transparent text-ink-secondary hover:border-base-700 hover:bg-base-700/40 hover:text-ink-primary'
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">{item.label}</span>
                        <Badge tone={activeItem.key === item.key ? 'accent' : 'muted'}>{item.count}</Badge>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="mb-5 lg:hidden">
              <Select
                label="Kategori Master Data"
                value={activeItem.key}
                onChange={(event) => selectCategory(event.target.value as MasterDataNavigationKey)}
                options={categoryOptions}
              />
            </div>

            <div className="mb-5 flex flex-col gap-3 border-b border-base-700/70 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink-primary">{activeItem.label}</h2>
                  <Badge tone="neutral">{activeItem.count} data</Badge>
                </div>
                <p className="mt-1 max-w-2xl text-sm text-ink-muted">{activeItem.description}</p>
              </div>
            </div>

            {activeCategory ? (
              activeItems.length === 0 ? (
                <EmptyState
                  title="Belum ada data"
                  description={`Belum ada ${activeItem.label.toLocaleLowerCase('id-ID')}. Tambahkan data referensi untuk mulai digunakan.`}
                  action={canCreate ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>{addLabel}</Button> : undefined}
                />
              ) : (
                <DataTable
                  key={activeCategory}
                  columns={columns}
                  data={activeItems}
                  rowKey={(item) => item.id}
                  searchable
                  searchPlaceholder={searchPlaceholder}
                  searchKeys={(item) => `${item.name} ${item.code ?? ''}`}
                  pageSize={10}
                  initialSort={{ key: 'name', dir: 'asc' }}
                  compact
                  emptyTitle="Data tidak ditemukan"
                  emptyDescription={`Tidak ada ${activeItem.label.toLocaleLowerCase('id-ID')} yang sesuai dengan pencarian.`}
                />
              )
            ) : (
              <LaboratoryShortcut
                totalLabs={db.labs.length}
                activeLabs={db.labs.filter((lab) => lab.status === 'active').length}
                totalPCs={db.devices.filter((device) => db.labs.some((lab) => lab.id === device.laboratoryId)).length}
                laboratories={db.labs}
                canViewLaboratories={canViewLaboratories}
                onOpen={() => navigate('/laboratories')}
              />
            )}
          </div>
        </div>
      </Card>

      <FormDialog
        open={open}
        onClose={closeForm}
        title={`${editing ? 'Edit' : 'Tambah'} ${activeItem.label}`}
        onSubmit={() => { void save(); }}
        loading={isSaving}
        size="sm"
      >
        <Input label="Nama" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
        <Input label="Kode (opsional)" value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} className="mt-4" />
        <Select
          label="Status"
          value={form.isActive ? 'active' : 'inactive'}
          onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === 'active' }))}
          options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]}
          className="mt-4"
        />
      </FormDialog>
      <ConfirmDialog
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => { void remove(); }}
        message={`Hapus "${confirmDel?.name}" dari ${activeItem.label}?`}
        confirmLabel="Hapus"
        loading={isDeleting}
      />
    </div>
  );
}

function LaboratoryShortcut({
  totalLabs,
  activeLabs,
  totalPCs,
  laboratories,
  canViewLaboratories,
  onOpen,
}: {
  totalLabs: number;
  activeLabs: number;
  totalPCs: number;
  laboratories: { id: string; name: string; code: string; status: 'active' | 'inactive' }[];
  canViewLaboratories: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryMetric label="Total Laboratorium" value={totalLabs} />
        <SummaryMetric label="Laboratorium Aktif" value={activeLabs} tone="success" />
        <SummaryMetric label="PC Terdaftar" value={totalPCs} tone="accent" />
      </div>

      {laboratories.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-base-700/70 bg-base-800/40">
          {laboratories.slice(0, 5).map((laboratory) => (
            <div key={laboratory.id} className="flex items-center justify-between gap-3 border-b border-base-700/50 px-4 py-3 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-primary">{laboratory.name}</p>
                <p className="text-xs text-ink-muted">{laboratory.code}</p>
              </div>
              <StatusBadge status={laboratory.status} />
            </div>
          ))}
        </div>
      )}

      {canViewLaboratories ? (
        <Button icon={<FlaskConical className="h-4 w-4" />} onClick={onOpen}>
          Buka Manajemen Laboratorium
          <ArrowUpRight className="h-4 w-4" />
        </Button>
      ) : (
        <div className="rounded-lg border border-base-700/70 bg-base-800/40 p-4 text-sm text-ink-secondary">
          Anda dapat melihat ringkasan laboratorium, tetapi tidak memiliki izin untuk membuka manajemen laboratorium.
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'accent' }) {
  const toneClass = {
    neutral: 'bg-base-700/40 text-ink-primary',
    success: 'bg-emerald-500/10 text-emerald-400',
    accent: 'bg-accent-blue/10 text-accent-blue',
  }[tone];
  return (
    <div className="rounded-xl border border-base-700/70 bg-base-800/40 p-4">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold', toneClass)}>{value}</p>
    </div>
  );
}
