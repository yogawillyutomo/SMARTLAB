import { useMemo, useState } from 'react';
import { KeyRound, Save, Download } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/toastStore';
import { cn, downloadCSV } from '@/utils';
import { MODULES, MODULE_LABELS, PERMISSION_ACTIONS, ROLE_PERMISSIONS, type ModuleKey, type PermissionAction, type RoleName } from '@/lib/permissions';
import { readStorage, writeStorage, STORAGE_KEYS } from '@/lib/storage';

const ROLES: RoleName[] = ['Super Admin', 'Admin Lab', 'Kepala Lab', 'Teknisi', 'Guru', 'Ketua Kelas', 'Siswa', 'Pimpinan'];

export function RolesPage() {
  const { db } = useAppData();
  const [permissions, setPermissions] = useState<Record<RoleName, Partial<Record<ModuleKey, PermissionAction[]>>>>(() => {
    const saved = readStorage<Partial<Record<RoleName, Partial<Record<ModuleKey, PermissionAction[]>>>> | null>(STORAGE_KEYS.ROLE_PERMS, null);
    if (saved) {
      return { ...ROLE_PERMISSIONS, ...saved };
    }
    return { ...ROLE_PERMISSIONS };
  });
  const [activeRole, setActiveRole] = useState<RoleName>('Admin Lab');

  function toggle(role: RoleName, module: ModuleKey, action: PermissionAction) {
    setPermissions((prev) => {
      const next = { ...prev };
      const current = next[role][module] ?? [];
      if (current.includes(action)) {
        next[role] = { ...next[role], [module]: current.filter((a) => a !== action) };
      } else {
        next[role] = { ...next[role], [module]: [...current, action] };
      }
      return next;
    });
  }

  function save() {
    writeStorage(STORAGE_KEYS.ROLE_PERMS, permissions);
    toast('Konfigurasi permission disimpan', 'success');
  }

  function reset() {
    setPermissions({ ...ROLE_PERMISSIONS });
    writeStorage(STORAGE_KEYS.ROLE_PERMS, null);
    toast('Permission direset ke default', 'info');
  }

  function exportCSV() {
    const rows: Record<string, unknown>[] = [];
    ROLES.forEach((role) => {
      MODULES.forEach((mod) => {
        PERMISSION_ACTIONS.forEach((act) => {
          rows.push({ Role: role, Module: MODULE_LABELS[mod], Action: act, Allowed: permissions[role]?.[mod]?.includes(act) ? 'Yes' : 'No' });
        });
      });
    });
    downloadCSV('role-permissions.csv', rows);
  }

  const roleStats = useMemo(() => {
    return ROLES.map((role) => ({
      role,
      count: db.users.filter((u) => u.role === role).length,
      modules: Object.keys(permissions[role] ?? {}).filter((m) => permissions[role]?.[m as ModuleKey]?.length).length,
    }));
  }, [db.users, permissions]);

  return (
    <div className="space-y-6">
      <PageHeader title="Role dan Permission" description="Matriks permission per role" icon={<KeyRound className="h-5 w-5" />}
        actions={<>
          <Button variant="secondary" size="sm" onClick={reset}>Reset</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>
          <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={save}>Simpan</Button>
        </>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {roleStats.map((s) => (
          <Card key={s.role} hover onClick={() => setActiveRole(s.role)} className={cn('cursor-pointer', activeRole === s.role && 'border-accent-blue')}>
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
              <button key={r} onClick={() => setActiveRole(r)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', activeRole === r ? 'bg-accent-blue text-white' : 'text-ink-muted hover:text-ink-secondary')}>{r}</button>
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
                    const allowed = permissions[activeRole]?.[mod]?.includes(act) ?? false;
                    return (
                      <td key={act} className="px-3 py-2 text-center">
                        <button onClick={() => toggle(activeRole, mod, act)} className={cn('inline-flex h-6 w-6 items-center justify-center rounded-md border transition-colors', allowed ? 'border-emerald-500 bg-emerald-500/15 text-emerald-400' : 'border-base-600 text-transparent hover:border-base-500')}>
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

      <p className="text-xs text-ink-muted">Catatan: Permission ini disimpan di localStorage untuk simulasi frontend. Saat terhubung ke backend Laravel, permission akan divalidasi dari server.</p>
    </div>
  );
}
