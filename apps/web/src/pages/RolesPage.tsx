import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, LockKeyhole } from 'lucide-react';
import { ApiClientError } from '@/lib/apiClient';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { downloadCSV } from '@/utils';
import { identityAdminGateway, type IdentityRoleDto } from '@/services/identityAdminApi';

function issueMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'UNAUTHENTICATED') return 'Sesi berakhir. Silakan masuk kembali.';
    if (error.code === 'FORBIDDEN') return 'Anda tidak memiliki izin melihat Hak Akses.';
    if (error.kind === 'network') return 'API SmartLab tidak dapat dijangkau.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Hak akses tidak dapat dimuat.';
}

function permissionModule(permission: string): string {
  const separator = permission.indexOf('.');
  return separator === -1 ? permission : permission.slice(0, separator);
}

export function RolesPage() {
  const [roles, setRoles] = useState<IdentityRoleDto[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setIssue(null);
    try {
      const result = await identityAdminGateway.listRoles();
      setRoles(result);
      setSelectedKey((current) => result.some((role) => role.key === current) ? current : (result[0]?.key ?? ''));
    } catch (error) {
      setIssue(issueMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => roles.find((role) => role.key === selectedKey) ?? null,
    [roles, selectedKey],
  );

  const permissionGroups = useMemo(() => {
    if (!selected) return [];
    const grouped = new Map<string, string[]>();
    for (const permission of selected.permissions) {
      const module = permissionModule(permission);
      const entries = grouped.get(module) ?? [];
      entries.push(permission);
      grouped.set(module, entries);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [selected]);

  function exportCatalog() {
    const rows = roles.flatMap((role) => role.permissions.map((permission) => ({
      RoleKey: role.key,
      Role: role.name,
      Permission: permission,
      Membership: role.membershipCount,
      MembershipAktif: role.activeMembershipCount,
    })));
    downloadCSV('hak-akses-smartlab.csv', rows);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hak Akses"
        description="Katalog role dan permission canonical dari backend SmartLab."
        icon={<KeyRound className="h-5 w-5" />}
        actions={
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCatalog} disabled={roles.length === 0}>
            Export
          </Button>
        }
      />

      <Card className="border-info/30 bg-info/5">
        <CardContent className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <div>
            <p className="text-sm font-semibold text-ink-primary">Server-authoritative · read-only pada tahap S1A</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Permission tidak lagi disimpan atau diedit di browser. Matrix backend saat ini bersifat global; editor tenant baru akan dibuka setelah kontrak override permission per sekolah dikunci agar perubahan satu sekolah tidak memengaruhi tenant lain.
            </p>
          </div>
        </CardContent>
      </Card>

      {loading && roles.length === 0 ? (
        <Card><LoadingState label="Memuat katalog hak akses..." /></Card>
      ) : issue ? (
        <Card><ErrorState message={issue} onRetry={() => void load()} /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((role) => (
              <Card
                key={role.key}
                hover
                onClick={() => setSelectedKey(role.key)}
                className={`cursor-pointer ${selectedKey === role.key ? 'border-accent-content' : ''}`}
              >
                <CardContent>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-primary">{role.name}</p>
                      <p className="mt-0.5 text-[10px] text-ink-muted">{role.key}</p>
                    </div>
                    <Badge tone="accent">{role.activeMembershipCount}/{role.membershipCount}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
                    <span>{role.permissions.length} permission</span>
                    <span>aktif/total user</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selected && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Permission — {selected.name}</CardTitle>
                  <p className="mt-1 text-xs text-ink-muted">{selected.permissions.length} permission efektif dari katalog server.</p>
                </div>
                <Badge tone="muted">Read-only</Badge>
              </CardHeader>
              <CardContent>
                {permissionGroups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-muted">Role ini belum memiliki permission.</p>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {permissionGroups.map(([module, permissions]) => (
                      <div key={module} className="rounded-xl border border-base-700 bg-base-800/40 p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <p className="font-mono text-xs font-semibold text-ink-primary">{module}</p>
                          <Badge tone="neutral">{permissions.length}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {permissions.map((permission) => (
                            <Badge key={permission} tone="success">{permission}</Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <p className="text-xs text-ink-muted">
        Jumlah membership dihitung oleh backend untuk sekolah aktif. Permission pada halaman ini adalah data referensi server, bukan simulasi frontend.
      </p>
    </div>
  );
}
