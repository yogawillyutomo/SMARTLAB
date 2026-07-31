import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Save, Download } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermissionStore } from '@/stores/permissionStore';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/toastStore';
import { cn, downloadCSV } from '@/utils';
import { auditLog } from '@/services/repositories';
import { usePermission } from '@/components/common/PermissionGuard';
import { MODULES, MODULE_LABELS, PERMISSION_ACTIONS, type ModuleKey, type PermissionAction, type PermissionMatrix, type RoleName } from '@/lib/permissions';

const ROLES: RoleName[] = ['Super Admin', 'Admin Lab', 'Kepala Lab', 'Teknisi', 'Guru', 'Ketua Kelas', 'Siswa', 'Pimpinan'];

export function RolesPage() {
  const { db, refresh } = useAppData();
  const user = useAuthStore((s) => s.user);
  const permissions = usePermissionStore((s) => s.permissions);
  const setPermissions = usePermissionStore((s) => s.setPermissions);
  const resetRole = usePermissionStore((s) => s.resetRole);
  const resetAll = usePermissionStore((s) => s.resetAll);
  const canUpdate = usePermission('roles', 'update');
  const canManage = usePermission('roles', 'manage');
  const canExport = usePermission('roles', 'export');
  const canEdit = canUpdate || canManage;
  const [draftPermissions, setDraftPermissions] = useState<PermissionMatrix>(permissions);
  const [activeRole, setActiveRole] = useState<RoleName>('Admin Lab');

  useEffect(() => {
    setDraftPermissions(permissions);
  }, [permissions]);

  function toggle(role: RoleName, module: ModuleKey, action: PermissionAction) {
    if (!canEdit) return;
    setDraftPermissions((prev) => {
      const current = prev[role][module];
      const next: PermissionMatrix = { ...prev, [role]: { ...prev[role] } };
      if (current.includes(action)) {
        next[role][module] = current.filter((a) => a !== action);
      } else {
        next[role][module] = [...current, action];
      }
      return next;
    });
  }

  function save() {
    if (!canEdit) return;
    setPermissions(draftPermissions);
    auditLog.log({ userName: user?.name ?? 'Admin', role: user?.role ?? 'Super Admin', module: 'roles', action: 'update', object: 'permission-matrix', newValue: 'Role permissions updated', device: 'Web' });
    refresh();
    toast('Konfigurasi permission disimpan', 'success');
  }

  function reset() {
    if (!canEdit) return;
    resetAll();
    auditLog.log({ userName: user?.name ?? 'Admin', role: user?.role ?? 'Super Admin', module: 'roles', action: 'reset', object: 'all-roles', newValue: 'All role permissions reset to defaults', device: 'Web' });
    refresh();
    toast('Permission direset ke default', 'info');
  }

  function resetActiveRole() {
    if (!canEdit) return;
    resetRole(activeRole);
    auditLog.log({ userName: user?.name ?? 'Admin', role: user?.role ?? 'Super Admin', module: 'roles', action: 'reset', object: activeRole, newValue: `Role permissions reset to defaults: ${activeRole}`, device: 'Web' });
    refresh();
    toast(`Permission ${activeRole} direset ke default`, 'info');
  }

  function exportCSV() {
    if (!canExport) return;
    const rows: Record<string, unknown>[] = [];
    ROLES.forEach((role) => {
      MODULES.forEach((mod) => {
        PERMISSION_ACTIONS.forEach((act) => {
          rows.push({ Role: role, Module: MODULE_LABELS[mod], Action: act, Allowed: draftPermissions[role][mod].includes(act) ? 'Yes' : 'No' });
        });
      });
    });
    downloadCSV('role-permissions.csv', rows);
  }

  const roleStats = useMemo(() => {
    return ROLES.map((role) => ({
      role,
      count: db.users.filter((u) => u.role === role).length,
      modules: MODULES.filter((module) => draftPermissions[role][module].length > 0).length,
    }));
  }, [db.users, draftPermissions]);

  return (
    <div className="space-y-6">
      <PageHeader title="Hak Akses" description="Kelola hak lihat dan tindakan setiap role pada modul SmartLab." icon={<KeyRound className="h-5 w-5" />}
        actions={<>
          <Button variant="secondary" size="sm" onClick={reset} disabled={!canEdit}>Reset</Button>
          <Button variant="secondary" size="sm" onClick={resetActiveRole} disabled={!canEdit}>Reset Role</Button>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={save} disabled={!canEdit}>Simpan</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roleStats.map((s) => (
          <Card key={s.role} hover onClick={() => setActiveRole(s.role)} className={cn('cursor-pointer', activeRole === s.role && 'border-accent-content')}>
            <CardContent>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-primary">{s.role}</p>
                <Badge tone="accent">{s.count} user</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{s.modules} modul diakses</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Permission Matrix — {activeRole}</CardTitle>
          <div className="flex items-center gap-1 rounded-lg border border-base-700 p-1">
            {ROLES.map((r) => (
              <button key={r} onClick={() => setActiveRole(r)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', activeRole === r ? 'bg-accent-primary text-accent-foreground' : 'text-ink-muted hover:text-ink-secondary')}>{r}</button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-base-700 text-left text-ink-muted">
                <th className="px-3 py-2 font-medium sticky left-0 bg-base-800">Modul</th>
                {PERMISSION_ACTIONS.map((act) => <th key={act} className="px-3 py-2 text-center font-medium capitalize">{act}</th>)}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((mod) => (
                <tr key={mod} className="border-b border-base-700/40 hover:bg-base-700/20">
                  <td className="px-3 py-2 font-medium text-ink-primary sticky left-0 bg-base-800">{MODULE_LABELS[mod]}</td>
                  {PERMISSION_ACTIONS.map((act) => {
                    const allowed = draftPermissions[activeRole][mod].includes(act);
                    return (
                      <td key={act} className="px-3 py-2 text-center">
                        <button disabled={!canEdit} onClick={() => toggle(activeRole, mod, act)} className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-50', allowed ? 'border-success bg-success/15 text-success-foreground' : 'border-base-600 text-transparent hover:border-base-600')}>
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-muted">Catatan: Permission ini disimpan melalui abstraksi storage untuk simulasi frontend. Saat terhubung ke backend Laravel, policy server tetap menjadi batas keamanan dan sumber validasi utama.</p>
    </div>
  );
}
