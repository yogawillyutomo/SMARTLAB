import { useMemo, useState } from 'react';
import { Database, Pencil, Plus, Trash2 } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/States';
import { MASTER_DATA_CATEGORY_KEYS, MASTER_DATA_CATEGORY_LABELS } from '@/lib/masterData';
import { masterDataRepository, type MasterDataActorContext } from '@/services/repositories';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { toast } from '@/stores/toastStore';
import type { MasterDataCategoryKey } from '@/types';
import { cn } from '@/utils';

type MasterDataTabKey = MasterDataCategoryKey | 'laboratory';

interface DisplayItem {
  id: string;
  name: string;
  code?: string;
}

interface MasterDataTab {
  key: MasterDataTabKey;
  label: string;
  items: DisplayItem[];
}

const EMPTY_FORM = { name: '', code: '' };

export function MasterDataPage() {
  const { db, refresh } = useAppData();
  const user = useAuthStore((state) => state.user);
  const permissions = usePermissionStore((state) => state.permissions);
  const canCreate = usePermission('master-data', 'create');
  const canUpdate = usePermission('master-data', 'update');
  const canDelete = usePermission('master-data', 'delete');
  const [tab, setTab] = useState<MasterDataTabKey>('asset-category');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DisplayItem | null>(null);
  const [confirmDel, setConfirmDel] = useState<DisplayItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const data = useMemo<MasterDataTab[]>(() => {
    const masterDataTabs = MASTER_DATA_CATEGORY_KEYS.map((key) => ({
      key,
      label: MASTER_DATA_CATEGORY_LABELS[key],
      items: db.masterData[key].map((item) => ({ id: item.id, name: item.name, code: item.code })),
    }));
    const laboratoryTab: MasterDataTab = {
      key: 'laboratory',
      label: 'Laboratorium',
      items: db.labs.map((laboratory) => ({ id: laboratory.id, name: laboratory.name, code: laboratory.code })),
    };

    return [...masterDataTabs.slice(0, 4), laboratoryTab, ...masterDataTabs.slice(4)];
  }, [db.labs, db.masterData]);

  const activeTab = data.find((item) => item.key === tab) ?? data[0];
  const isLaboratory = activeTab.key === 'laboratory';

  function actor(): MasterDataActorContext | null {
    return user ? { user, permissions } : null;
  }

  function closeForm() {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function selectTab(nextTab: MasterDataTabKey) {
    setTab(nextTab);
    closeForm();
    setConfirmDel(null);
  }

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(item: DisplayItem) {
    if (!canUpdate) return;
    setEditing(item);
    setForm({ name: item.name, code: item.code ?? '' });
    setOpen(true);
  }

  async function save() {
    if (isSaving || (editing ? !canUpdate : !canCreate)) return;
    const currentActor = actor();
    if (!currentActor) {
      toast('Sesi pengguna tidak tersedia', 'error');
      return;
    }

    setIsSaving(true);
    try {
      if (activeTab.key === 'laboratory') {
        if (editing) {
          await masterDataRepository.updateLaboratory(editing.id, form, currentActor);
        } else {
          await masterDataRepository.createLaboratory(form, currentActor);
        }
      } else if (editing) {
        await masterDataRepository.updateItem(activeTab.key, editing.id, form, currentActor);
      } else {
        await masterDataRepository.createItem(activeTab.key, form, currentActor);
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
    if (!confirmDel || isDeleting || !canDelete) return;
    const currentActor = actor();
    if (!currentActor) {
      toast('Sesi pengguna tidak tersedia', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      if (activeTab.key === 'laboratory') {
        await masterDataRepository.deleteLaboratory(confirmDel.id, currentActor);
      } else {
        await masterDataRepository.deleteItem(activeTab.key, confirmDel.id, currentActor);
      }

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data"
        description="Data referensi sistem"
        icon={<Database className="h-5 w-5" />}
        actions={canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah</Button>}
      />
      <Card>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {data.map((item) => (
              <button
                key={item.key}
                onClick={() => selectTab(item.key)}
                className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', tab === item.key ? 'border-accent-blue bg-accent-blue/10 text-accent-blue' : 'border-base-700 text-ink-secondary hover:border-base-600')}
              >
                {item.label} ({item.items.length})
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
                    <p className="truncate text-sm font-medium text-ink-primary">{item.name}</p>
                    {item.code && <p className="text-xs text-ink-muted">{item.code}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {canUpdate && <button onClick={() => openEdit(item)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary" aria-label={`Edit ${item.name}`}><Pencil className="h-3.5 w-3.5" /></button>}
                    {canDelete && <button onClick={() => setConfirmDel(item)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger" aria-label={`Hapus ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <FormDialog
        open={open}
        onClose={closeForm}
        title={editing ? 'Edit Data' : 'Tambah Data'}
        onSubmit={() => { void save(); }}
        loading={isSaving}
        size="sm"
      >
        <Input label="Nama" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
        <Input
          label={isLaboratory ? 'Kode' : 'Kode (opsional)'}
          value={form.code}
          onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          className="mt-4"
          required={isLaboratory}
        />
      </FormDialog>
      <ConfirmDialog
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => { void remove(); }}
        message={`Hapus "${confirmDel?.name}"?`}
        confirmLabel="Hapus"
        loading={isDeleting}
      />
    </div>
  );
}
