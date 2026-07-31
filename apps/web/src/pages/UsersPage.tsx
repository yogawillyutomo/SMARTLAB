import { useState } from 'react';
import { Users as UsersIcon, Plus, Pencil, Trash2, Download, KeyRound, Power, Mail, Phone } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import { toast } from '@/stores/toastStore';
import { downloadCSV, initials, relativeTime } from '@/utils';
import type { User, RoleName } from '@/types';

const ROLES: RoleName[] = ['Super Admin', 'Admin Lab', 'Kepala Lab', 'Teknisi', 'Guru', 'Ketua Kelas', 'Siswa', 'Pimpinan'];

export function UsersPage() {
  const { db, mutate } = useAppData();
  const canCreate = usePermission('users', 'create');
  const canUpdate = usePermission('users', 'update');
  const canDelete = usePermission('users', 'delete');
  const canExport = usePermission('users', 'export');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<User | null>(null);
  const [confirmDel, setConfirmDel] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [filterRole, setFilterRole] = useState('all');
  const [form, setForm] = useState<Partial<User>>({});

  const filtered = db.users.filter((u) => filterRole === 'all' || u.role === filterRole);

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ role: 'Siswa', status: 'active' });
    setOpen(true);
  }
  function openEdit(u: User) { if (!canUpdate) return; setEditing(u); setForm(u); setOpen(true); }

  function save() {
    if (editing ? !canUpdate : !canCreate) return;
    if (!form.name || !form.email) { toast('Nama dan email wajib diisi', 'error'); return; }
    mutate((d) => {
      if (editing) {
        const idx = d.users.findIndex((u) => u.id === editing.id);
        if (idx >= 0) d.users[idx] = { ...d.users[idx], ...form } as User;
      } else {
        d.users.push({ ...form, id: `u-${Date.now()}` } as User);
      }
    });
    toast(editing ? 'Pengguna diperbarui' : 'Pengguna ditambahkan', 'success');
    setOpen(false);
  }

  function remove() {
    if (!confirmDel || !canDelete) return;
    mutate((d) => { d.users = d.users.filter((u) => u.id !== confirmDel.id); });
    toast('Pengguna dihapus', 'success');
    setConfirmDel(null);
  }

  function toggleStatus(u: User) {
    if (!canUpdate) return;
    mutate((d) => { const idx = d.users.findIndex((x) => x.id === u.id); if (idx >= 0) d.users[idx].status = d.users[idx].status === 'active' ? 'inactive' : 'active'; });
    toast('Status pengguna diubah', 'success');
  }

  function resetPassword(u: User) {
    if (!canUpdate) return;
    toast(`Password ${u.name} direset ke default (demo)`, 'info');
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('pengguna.csv', db.users.map((u) => ({ Nama: u.name, Email: u.email, Role: u.role, Unit: u.unit ?? '', Status: u.status })));
  }

  const columns: Column<User>[] = [
    { key: 'name', header: 'Nama', sortable: true, render: (u) => (
      <button onClick={() => setDetail(u)} className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-cyan text-xs font-bold text-white">{initials(u.name)}</div>
        <span className="font-medium text-ink-primary">{u.name}</span>
      </button>
    ) },
    { key: 'email', header: 'Email', render: (u) => <span className="text-ink-secondary">{u.email}</span> },
    { key: 'role', header: 'Role', sortable: true, render: (u) => <Badge tone="accent">{u.role}</Badge> },
    { key: 'unit', header: 'Unit', render: (u) => u.unit ?? '-' },
    { key: 'status', header: 'Status', render: (u) => <StatusBadge status={u.status} /> },
    { key: 'lastLogin', header: 'Terakhir Login', render: (u) => u.lastLogin ? relativeTime(u.lastLogin) : '-' },
    { key: 'actions', header: 'Aksi', printHidden: true, render: (u) => (
      <div className="flex gap-1">
        {canUpdate && <button onClick={() => openEdit(u)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Pencil className="h-4 w-4" /></button>}
        {canUpdate && <button onClick={() => resetPassword(u)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary" title="Reset Password"><KeyRound className="h-4 w-4" /></button>}
        {canUpdate && <button onClick={() => toggleStatus(u)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary" title="Aktif/Nonaktif"><Power className="h-4 w-4" /></button>}
        {canDelete && <button onClick={() => setConfirmDel(u)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
      </div>
    ) },
  ];

  const userAuditLogs = detail ? db.auditLogs.filter((a) => a.userName === detail.name).slice(0, 10) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Pengguna" description="Manajemen pengguna sistem" icon={<UsersIcon className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Tambah Pengguna</Button>}
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent><p className="text-2xl font-bold text-accent-blue">{db.users.length}</p><p className="text-xs text-ink-muted">Total Pengguna</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{db.users.filter((u) => u.status === 'active').length}</p><p className="text-xs text-ink-muted">Aktif</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{new Set(db.users.map((u) => u.role)).size}</p><p className="text-xs text-ink-muted">Role</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-warning-foreground">{db.users.filter((u) => u.role === 'Teknisi').length}</p><p className="text-xs text-ink-muted">Teknisi</p></CardContent></Card>
      </div>
      <Card className="print-hidden">
        <CardContent className="flex items-end gap-3">
          <Select label="Filter Role" value={filterRole} onChange={(e) => setFilterRole(e.target.value)} options={ROLES.map((r) => ({ value: r, label: r }))} placeholder="Semua role" />
        </CardContent>
      </Card>
      <Card><DataTable columns={columns} data={filtered} rowKey={(u) => u.id} searchable searchKeys={(u) => `${u.name} ${u.email} ${u.role} ${u.unit ?? ''}`} /></Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title={editing ? 'Edit Pengguna' : 'Tambah Pengguna'} onSubmit={save} size="md">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nama" value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="NIP/NIS" value={form.nip ?? form.nis ?? ''} onChange={(e) => setForm({ ...form, nip: e.target.value })} />
          <Input label="Telepon" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RoleName })} options={ROLES.map((r) => ({ value: r, label: r }))} />
          <Input label="Unit" value={form.unit ?? ''} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'inactive' })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name} description={detail?.email} width="max-w-lg">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan text-xl font-bold text-white">{initials(detail.name)}</div>
              <div>
                <Badge tone="accent">{detail.role}</Badge>
                <p className="mt-1"><StatusBadge status={detail.status} /></p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-ink-muted" /><span className="text-ink-secondary">{detail.email}</span></div>
              {detail.phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-ink-muted" /><span className="text-ink-secondary">{detail.phone}</span></div>}
              {detail.unit && <div><p className="text-xs text-ink-muted">Unit</p><p className="text-ink-primary">{detail.unit}</p></div>}
              {detail.nip && <div><p className="text-xs text-ink-muted">NIP/NIS</p><p className="text-ink-primary">{detail.nip}</p></div>}
              {detail.lastLogin && <div><p className="text-xs text-ink-muted">Terakhir Login</p><p className="text-ink-primary">{relativeTime(detail.lastLogin)}</p></div>}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">Aktivitas Terbaru</p>
              {userAuditLogs.length === 0 ? <p className="text-xs text-ink-muted">Belum ada aktivitas</p> : <ActivityTimeline items={userAuditLogs.map((a) => ({ label: `${a.action} · ${a.module}`, at: relativeTime(a.at), tone: 'neutral' as const }))} />}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} onConfirm={remove} message={`Hapus pengguna ${confirmDel?.name}?`} confirmLabel="Hapus" />
    </div>
  );
}
