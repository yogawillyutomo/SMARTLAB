import { useMemo, useState } from 'react';
import { ScrollText, Download, Eye } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { Drawer } from '@/components/ui/Drawer';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import type { AuditLog } from '@/types';

const actionTones: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  create: 'success', update: 'warning', delete: 'danger', login: 'info', logout: 'info', transfer: 'accent' as never, view: 'neutral',
};

export function AuditLogsPage() {
  const { db } = useAppData();
  const canExport = usePermission('audit-logs', 'export');
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const [filters, setFilters] = useState({ user: 'all', module: 'all', action: 'all' });

  const modules = [...new Set(db.auditLogs.map((a) => a.module))];
  const users = [...new Set(db.auditLogs.map((a) => a.userName))];
  const actions = [...new Set(db.auditLogs.map((a) => a.action))];

  const filtered = useMemo(() => db.auditLogs.filter((a) => {
    if (filters.user !== 'all' && a.userName !== filters.user) return false;
    if (filters.module !== 'all' && a.module !== filters.module) return false;
    if (filters.action !== 'all' && a.action !== filters.action) return false;
    return true;
  }), [db.auditLogs, filters]);

  function exportCSV() {
    downloadCSV('audit-log.csv', filtered.map((a) => ({ Waktu: a.at, Pengguna: a.userName, Role: a.role, Modul: a.module, Aksi: a.action, Objek: a.object, NilaiLama: a.oldValue ?? '', NilaiBaru: a.newValue ?? '', Device: a.device })));
    toast('Audit log berhasil diexport', 'success');
  }

  const columns: Column<AuditLog>[] = [
    { key: 'at', header: 'Waktu', sortable: true, sortValue: (a) => a.at, render: (a) => <span className="text-ink-secondary">{relativeTime(a.at)}</span> },
    { key: 'userName', header: 'Pengguna', sortable: true, render: (a) => <span className="font-medium text-ink-primary">{a.userName}</span> },
    { key: 'role', header: 'Role', render: (a) => <Badge tone="neutral">{a.role}</Badge> },
    { key: 'module', header: 'Modul', sortable: true },
    { key: 'action', header: 'Aksi', sortable: true, render: (a) => <Badge tone={actionTones[a.action] ?? 'neutral'}>{a.action}</Badge> },
    { key: 'object', header: 'Objek', render: (a) => <span className="text-ink-secondary">{a.object}</span> },
    { key: 'device', header: 'Device', render: (a) => <span className="text-ink-muted text-xs">{a.device}</span> },
    { key: 'actions', header: '', render: (a) => <button onClick={() => setDetail(a)} className="rounded p-1 text-ink-muted hover:bg-base-700 hover:text-ink-primary"><Eye className="h-4 w-4" /></button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Riwayat aktivitas pengguna" icon={<ScrollText className="h-5 w-5" />}
        actions={canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select label="Pengguna" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} options={users.map((u) => ({ value: u, label: u }))} placeholder="Semua" />
          <Select label="Modul" value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })} options={modules.map((m) => ({ value: m, label: m }))} placeholder="Semua" />
          <Select label="Aksi" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} options={actions.map((a) => ({ value: a, label: a }))} placeholder="Semua" />
        </CardContent>
      </Card>
      <Card><DataTable columns={columns} data={filtered} rowKey={(a) => a.id} searchable searchKeys={(a) => `${a.userName} ${a.module} ${a.action} ${a.object}`} pageSize={15} /></Card>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title="Detail Audit Log" width="max-w-md">
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Waktu</p><p className="text-ink-primary">{detail.at}</p></div>
              <div><p className="text-xs text-ink-muted">Pengguna</p><p className="text-ink-primary">{detail.userName}</p></div>
              <div><p className="text-xs text-ink-muted">Role</p><p className="text-ink-primary">{detail.role}</p></div>
              <div><p className="text-xs text-ink-muted">Modul</p><p className="text-ink-primary">{detail.module}</p></div>
              <div><p className="text-xs text-ink-muted">Aksi</p><Badge tone={actionTones[detail.action] ?? 'neutral'}>{detail.action}</Badge></div>
              <div><p className="text-xs text-ink-muted">Objek</p><p className="text-ink-primary">{detail.object}</p></div>
              <div><p className="text-xs text-ink-muted">Device</p><p className="text-ink-primary">{detail.device}</p></div>
            </div>
            {detail.oldValue && <div><p className="text-xs text-ink-muted">Nilai Lama</p><pre className="mt-1 rounded-lg border border-base-700 bg-base-900/40 p-3 text-xs text-ink-secondary overflow-x-auto">{detail.oldValue}</pre></div>}
            {detail.newValue && <div><p className="text-xs text-ink-muted">Nilai Baru</p><pre className="mt-1 rounded-lg border border-base-700 bg-base-900/40 p-3 text-xs text-ink-secondary overflow-x-auto">{detail.newValue}</pre></div>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
