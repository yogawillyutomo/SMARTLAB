import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Users as UsersIcon } from 'lucide-react';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { downloadCSV, initials, relativeTime } from '@/utils';
import {
  identityAdminGateway,
  type IdentityMembershipDto,
  type IdentityMembershipPage,
  type IdentityRoleDto,
  type IdentityRoleKey,
  type IdentityStatus,
} from '@/services/identityAdminApi';

type FormErrors = Partial<Record<'name' | 'email' | 'password' | 'nip' | 'nis' | 'phone' | 'roleKeys' | 'request', string>>;

interface MembershipForm {
  name: string;
  email: string;
  password: string;
  nip: string;
  nis: string;
  phone: string;
  userStatus: IdentityStatus;
  membershipStatus: IdentityStatus;
  roleKeys: IdentityRoleKey[];
}

const emptyForm = (): MembershipForm => ({
  name: '',
  email: '',
  password: '',
  nip: '',
  nis: '',
  phone: '',
  userStatus: 'active',
  membershipStatus: 'active',
  roleKeys: [],
});

function issueMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'IDENTITY_LAST_SUPER_ADMIN_REQUIRED') {
      return 'Sekolah harus tetap memiliki minimal satu Super Admin aktif.';
    }
    if (error.code === 'UNAUTHENTICATED') return 'Sesi berakhir. Silakan masuk kembali.';
    if (error.code === 'FORBIDDEN') return 'Anda tidak memiliki izin untuk tindakan ini.';
    if (error.kind === 'network') return 'API SmartLab tidak dapat dijangkau.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Administrasi pengguna tidak dapat diselesaikan.';
}

function validationErrors(error: unknown): FormErrors {
  if (!(error instanceof ApiClientError) || !error.errors) return {};
  const result: FormErrors = {};
  const keys: (keyof FormErrors)[] = ['name', 'email', 'password', 'nip', 'nis', 'phone', 'roleKeys', 'request'];
  for (const key of keys) {
    const direct = error.errors[key]?.[0];
    const nested = key === 'roleKeys'
      ? Object.entries(error.errors).find(([field]) => field.startsWith('roleKeys.'))?.[1]?.[0]
      : undefined;
    if (direct || nested) result[key] = direct ?? nested;
  }
  return result;
}

function nullable(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

export function UsersPage() {
  const user = useAuthStore((state) => state.user);
  const canCreate = hasServerPermission(user, 'users.create');
  const canUpdate = hasServerPermission(user, 'users.update');
  const canViewRoles = hasServerPermission(user, 'roles.view');

  const [membershipPage, setMembershipPage] = useState<IdentityMembershipPage | null>(null);
  const [roles, setRoles] = useState<IdentityRoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | IdentityStatus>('');
  const [roleKey, setRoleKey] = useState<'' | IdentityRoleKey>('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IdentityMembershipDto | null>(null);
  const [detail, setDetail] = useState<IdentityMembershipDto | null>(null);
  const [form, setForm] = useState<MembershipForm>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  const loadMemberships = useCallback(async () => {
    setLoading(true);
    setLoadIssue(null);
    try {
      const result = await identityAdminGateway.listMemberships({
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
        ...(roleKey ? { roleKey } : {}),
        page,
        perPage: 25,
      });
      setMembershipPage(result);
      if (result.meta.lastPage > 0 && page > result.meta.lastPage) setPage(result.meta.lastPage);
    } catch (error) {
      setLoadIssue(issueMessage(error));
    } finally {
      setLoading(false);
    }
  }, [page, roleKey, search, status]);

  const loadRoles = useCallback(async () => {
    if (!canViewRoles) return;
    try {
      setRoles(await identityAdminGateway.listRoles());
    } catch (error) {
      setLoadIssue(issueMessage(error));
    }
  }, [canViewRoles]);

  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  function applySearch() {
    setPage(1);
    setSearch(searchDraft.trim());
  }

  function openCreate() {
    if (!canCreate) return;
    setEditing(null);
    setForm({ ...emptyForm(), roleKeys: roles.some((role) => role.key === 'siswa') ? ['siswa'] : [] });
    setFormErrors({});
    setFormOpen(true);
  }

  function openEdit(membership: IdentityMembershipDto) {
    if (!canUpdate) return;
    setEditing(membership);
    setForm({
      name: membership.user.name,
      email: membership.user.email,
      password: '',
      nip: membership.user.nip ?? '',
      nis: membership.user.nis ?? '',
      phone: membership.user.phone ?? '',
      userStatus: membership.user.status,
      membershipStatus: membership.status,
      roleKeys: membership.roles.map((role) => role.key),
    });
    setFormErrors({});
    setFormOpen(true);
  }

  function toggleRole(key: IdentityRoleKey) {
    setForm((current) => ({
      ...current,
      roleKeys: current.roleKeys.includes(key)
        ? current.roleKeys.filter((roleKeyValue) => roleKeyValue !== key)
        : [...current.roleKeys, key],
    }));
    setFormErrors((current) => ({ ...current, roleKeys: undefined }));
  }

  async function save() {
    if (editing ? !canUpdate : !canCreate) return;
    const errors: FormErrors = {};
    if (!form.name.trim()) errors.name = 'Nama wajib diisi.';
    if (!form.email.trim()) errors.email = 'Email wajib diisi.';
    if (!editing && form.password.length < 12) errors.password = 'Password awal minimal 12 karakter.';
    if (form.roleKeys.length === 0) errors.roleKeys = 'Minimal satu role wajib dipilih.';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    setFormErrors({});
    try {
      if (editing) {
        await identityAdminGateway.updateMembership(editing.id, {
          name: form.name.trim(),
          email: form.email.trim(),
          nip: nullable(form.nip),
          nis: nullable(form.nis),
          phone: nullable(form.phone),
          userStatus: form.userStatus,
          membershipStatus: form.membershipStatus,
          roleKeys: form.roleKeys,
        });
        toast('Pengguna diperbarui dari data server.', 'success');
      } else {
        await identityAdminGateway.createMembership({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          nip: nullable(form.nip),
          nis: nullable(form.nis),
          phone: nullable(form.phone),
          roleKeys: form.roleKeys,
        });
        toast('Pengguna berhasil dibuat.', 'success');
      }
      setFormOpen(false);
      setEditing(null);
      await Promise.all([loadMemberships(), loadRoles()]);
    } catch (error) {
      const fieldErrors = validationErrors(error);
      setFormErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { request: issueMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function exportCurrentPage() {
    if (!membershipPage) return;
    downloadCSV('pengguna-smartlab.csv', membershipPage.data.map((membership) => ({
      Nama: membership.user.name,
      Email: membership.user.email,
      NIP: membership.user.nip ?? '',
      NIS: membership.user.nis ?? '',
      Telepon: membership.user.phone ?? '',
      Role: membership.roles.map((role) => role.name).join(', '),
      StatusAkun: membership.user.status,
      StatusMembership: membership.status,
      TerakhirLogin: membership.user.lastLoginAt ?? '',
    })));
  }

  const roleOptions = useMemo(
    () => roles.map((role) => ({ value: role.key, label: role.name })),
    [roles],
  );

  const columns: Column<IdentityMembershipDto>[] = [
    {
      key: 'name',
      header: 'Nama',
      render: (membership) => (
        <button type="button" onClick={() => setDetail(membership)} className="flex items-center gap-2 text-left">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-cyan text-xs font-bold text-white">
            {initials(membership.user.name)}
          </div>
          <div>
            <p className="font-medium text-ink-primary">{membership.user.name}</p>
            <p className="text-xs text-ink-muted">{membership.user.email}</p>
          </div>
        </button>
      ),
    },
    {
      key: 'roles',
      header: 'Role',
      render: (membership) => (
        <div className="flex flex-wrap gap-1">
          {membership.roles.map((role) => <Badge key={role.key} tone="accent">{role.name}</Badge>)}
        </div>
      ),
    },
    { key: 'accountStatus', header: 'Akun', render: (membership) => <StatusBadge status={membership.user.status} /> },
    { key: 'membershipStatus', header: 'Membership', render: (membership) => <StatusBadge status={membership.status} /> },
    {
      key: 'lastLoginAt',
      header: 'Terakhir Login',
      render: (membership) => membership.user.lastLoginAt ? relativeTime(membership.user.lastLoginAt) : '-',
    },
    {
      key: 'actions',
      header: 'Aksi',
      printHidden: true,
      render: (membership) => canUpdate ? (
        <button
          type="button"
          onClick={() => openEdit(membership)}
          className="rounded p-1.5 text-ink-muted hover:bg-base-700 hover:text-ink-primary"
          aria-label={`Edit ${membership.user.name}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
      ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pengguna"
        description="Membership pengguna pada sekolah aktif. Data berasal dari Laravel/PostgreSQL."
        icon={<UsersIcon className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCurrentPage} disabled={!membershipPage?.data.length}>
              Export Halaman
            </Button>
            {canCreate && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate} disabled={!canViewRoles || roles.length === 0}>
                Tambah Pengguna
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{membershipPage?.meta.total ?? '—'}</p><p className="text-xs text-ink-muted">Hasil Filter</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-ink-primary">{membershipPage?.meta.page ?? '—'} / {membershipPage?.meta.lastPage ?? '—'}</p><p className="text-xs text-ink-muted">Halaman Server</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-success-foreground">{roles.length || '—'}</p><p className="text-xs text-ink-muted">Role Canonical</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_220px_auto] md:items-end">
          <Input
            label="Cari nama/email"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
            placeholder="Nama atau email"
          />
          <Select
            label="Status Membership"
            value={status}
            onChange={(event) => { setPage(1); setStatus(event.target.value as '' | IdentityStatus); }}
            options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]}
            placeholder="Semua status"
          />
          {canViewRoles ? (
            <Select
              label="Role"
              value={roleKey}
              onChange={(event) => { setPage(1); setRoleKey(event.target.value as '' | IdentityRoleKey); }}
              options={roleOptions}
              placeholder="Semua role"
            />
          ) : <div />}
          <Button variant="secondary" onClick={applySearch}>Terapkan</Button>
        </CardContent>
      </Card>

      {loading && !membershipPage ? (
        <Card><LoadingState label="Memuat pengguna sekolah..." /></Card>
      ) : loadIssue ? (
        <Card><ErrorState message={loadIssue} onRetry={() => void Promise.all([loadMemberships(), loadRoles()])} /></Card>
      ) : (
        <Card>
          <DataTable
            columns={columns}
            data={membershipPage?.data ?? []}
            rowKey={(membership) => membership.id}
            pageSize={100}
            emptyTitle="Belum ada pengguna pada filter ini"
            emptyDescription="Data pengguna berasal dari membership sekolah aktif."
          />
          {membershipPage && membershipPage.meta.lastPage > 1 && (
            <div className="flex items-center justify-between border-t border-base-700 px-4 py-3 text-xs text-ink-muted">
              <span>{membershipPage.meta.total} membership · halaman {membershipPage.meta.page} dari {membershipPage.meta.lastPage}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Sebelumnya</Button>
                <Button variant="ghost" size="sm" icon={<ChevronRight className="h-4 w-4" />} disabled={page >= membershipPage.meta.lastPage || loading} onClick={() => setPage((current) => current + 1)}>Berikutnya</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <FormDialog
        open={formOpen}
        onClose={() => { if (!saving) setFormOpen(false); }}
        title={editing ? 'Edit Pengguna' : 'Tambah Pengguna'}
        description={editing ? 'Perubahan diterapkan pada akun dan membership sekolah aktif.' : 'Membuat akun baru dan membership pada sekolah aktif.'}
        onSubmit={() => void save()}
        submitLabel={editing ? 'Simpan Perubahan' : 'Buat Pengguna'}
        loading={saving}
        size="lg"
      >
        <div className="space-y-5">
          {formErrors.request && <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{formErrors.request}</div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Nama" required value={form.name} error={formErrors.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Input label="Email" type="email" required value={form.email} error={formErrors.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            {!editing && (
              <Input label="Password awal" type="password" required minLength={12} maxLength={72} value={form.password} error={formErrors.password} hint="Minimal 12 karakter; password tidak pernah ditampilkan kembali." onChange={(event) => setForm({ ...form, password: event.target.value })} />
            )}
            <Input label="NIP" value={form.nip} error={formErrors.nip} onChange={(event) => setForm({ ...form, nip: event.target.value })} />
            <Input label="NIS" value={form.nis} error={formErrors.nis} onChange={(event) => setForm({ ...form, nis: event.target.value })} />
            <Input label="Telepon" value={form.phone} error={formErrors.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            {editing && (
              <>
                <Select label="Status Akun" value={form.userStatus} onChange={(event) => setForm({ ...form, userStatus: event.target.value as IdentityStatus })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
                <Select label="Status Membership" value={form.membershipStatus} onChange={(event) => setForm({ ...form, membershipStatus: event.target.value as IdentityStatus })} options={[{ value: 'active', label: 'Aktif' }, { value: 'inactive', label: 'Nonaktif' }]} />
              </>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-ink-secondary">Role <span className="text-danger">*</span></p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {roles.map((role) => {
                const selected = form.roleKeys.includes(role.key);
                return (
                  <button
                    type="button"
                    key={role.key}
                    onClick={() => toggleRole(role.key)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${selected ? 'border-accent-content bg-accent-primary/15 text-accent-content' : 'border-base-600 bg-base-800 text-ink-secondary hover:border-base-500'}`}
                  >
                    <span className="font-medium">{role.name}</span>
                    <span className="mt-1 block text-[10px] opacity-70">{role.key}</span>
                  </button>
                );
              })}
            </div>
            {formErrors.roleKeys && <p className="mt-2 text-xs text-danger">{formErrors.roleKeys}</p>}
          </div>
        </div>
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.user.name} description={detail?.user.email} width="max-w-lg">
        {detail && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan text-xl font-bold text-white">{initials(detail.user.name)}</div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">{detail.roles.map((role) => <Badge key={role.key} tone="accent">{role.name}</Badge>)}</div>
                <div className="flex gap-2"><StatusBadge status={detail.user.status} /><StatusBadge status={detail.status} /></div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-ink-muted">NIP</p><p className="text-ink-primary">{detail.user.nip ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">NIS</p><p className="text-ink-primary">{detail.user.nis ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Telepon</p><p className="text-ink-primary">{detail.user.phone ?? '-'}</p></div>
              <div><p className="text-xs text-ink-muted">Terakhir Login</p><p className="text-ink-primary">{detail.user.lastLoginAt ? relativeTime(detail.user.lastLoginAt) : '-'}</p></div>
            </div>
            <p className="text-xs text-ink-muted">Riwayat perubahan disimpan sebagai audit event immutable di backend dan akan diproyeksikan pada modul Audit Log canonical.</p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
