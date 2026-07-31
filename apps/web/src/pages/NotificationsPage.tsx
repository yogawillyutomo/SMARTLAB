import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { cn, relativeTime } from '@/utils';
import type { Notification } from '@/types';

const CAT_LABELS: Record<Notification['category'], { label: string; tone: 'danger' | 'warning' | 'accent' | 'info' | 'success' | 'orange' | 'purple' | 'cyan' }> = {
  incident: { label: 'Incident', tone: 'danger' },
  work_order: { label: 'Work Order', tone: 'warning' },
  maintenance: { label: 'Maintenance', tone: 'orange' },
  stock: { label: 'Stok', tone: 'warning' },
  booking: { label: 'Booking', tone: 'accent' },
  journal: { label: 'Jurnal', tone: 'info' },
  loan: { label: 'Peminjaman', tone: 'purple' },
  pc_offline: { label: 'PC Offline', tone: 'danger' },
  system: { label: 'Sistem', tone: 'cyan' },
};

export function NotificationsPage() {
  const { db, mutate } = useAppData();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [showUnread, setShowUnread] = useState(false);

  const filtered = useMemo(() => db.notifications.filter((n) => {
    if (filter !== 'all' && n.category !== filter) return false;
    if (showUnread && n.read) return false;
    return true;
  }), [db.notifications, filter, showUnread]);

  function markRead(id: string) {
    mutate((d) => { const n = d.notifications.find((x) => x.id === id); if (n) n.read = true; });
  }
  function markAllRead() {
    mutate((d) => d.notifications.forEach((n) => (n.read = true)));
    toast('Semua notifikasi ditandai dibaca', 'success');
  }
  function remove(id: string) {
    mutate((d) => { d.notifications = d.notifications.filter((n) => n.id !== id); });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Notifikasi" description="Pusat notifikasi sistem" icon={<Bell className="h-5 w-5" />}
        actions={<Button variant="secondary" size="sm" icon={<CheckCheck className="h-4 w-4" />} onClick={markAllRead}>Tandai Semua Dibaca</Button>}
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Select label="Kategori" value={filter} onChange={(e) => setFilter(e.target.value)} options={Object.entries(CAT_LABELS).map(([k, v]) => ({ value: k, label: v.label }))} placeholder="Semua" />
          <label className="flex items-center gap-2 text-sm text-ink-secondary pb-2.5">
            <input type="checkbox" checked={showUnread} onChange={(e) => setShowUnread(e.target.checked)} className="rounded border-base-600 text-accent-content" />
            Hanya belum dibaca
          </label>
          <div className="ml-auto text-sm text-ink-muted">{db.notifications.filter((n) => !n.read).length} belum dibaca</div>
        </CardContent>
      </Card>

      <Card>
        {filtered.length === 0 ? <EmptyState icon={<Bell className="h-7 w-7" />} title="Tidak ada notifikasi" /> : (
          <div className="divide-y divide-base-700/40">
            {filtered.map((n) => {
              const cat = CAT_LABELS[n.category];
              return (
                <div key={n.id} className={cn('flex items-start gap-3 p-4 transition-colors hover:bg-base-700/20', !n.read && 'bg-accent-primary/5')}>
                  <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', cat.tone === 'danger' ? 'bg-danger/15' : cat.tone === 'warning' ? 'bg-warning/15' : cat.tone === 'accent' ? 'bg-accent-primary/15' : cat.tone === 'info' ? 'bg-info/15' : cat.tone === 'success' ? 'bg-success/15' : cat.tone === 'orange' ? 'bg-orange/15' : cat.tone === 'purple' ? 'bg-purple/15' : 'bg-status-cyan/15')}>
                    <Bell className={cn('h-4 w-4', cat.tone === 'danger' ? 'text-danger' : cat.tone === 'warning' ? 'text-warning-foreground' : cat.tone === 'accent' ? 'text-accent-content' : cat.tone === 'info' ? 'text-info' : cat.tone === 'success' ? 'text-success-foreground' : cat.tone === 'orange' ? 'text-orange-foreground' : cat.tone === 'purple' ? 'text-purple-foreground' : 'text-status-cyan')} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink-primary">{n.title}</p>
                      <Badge tone={cat.tone}>{cat.label}</Badge>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-accent-content" />}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-secondary">{n.message}</p>
                    <p className="mt-1 text-xs text-ink-muted">{relativeTime(n.at)}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {n.link && <button onClick={() => navigate(n.link!)} className="rounded p-1.5 text-ink-muted hover:bg-base-700 hover:text-ink-primary" title="Buka sumber"><Bell className="h-4 w-4" /></button>}
                    {!n.read && <button onClick={() => markRead(n.id)} className="rounded p-1.5 text-ink-muted hover:bg-base-700 hover:text-success-foreground" title="Tandai dibaca"><CheckCheck className="h-4 w-4" /></button>}
                    <button onClick={() => remove(n.id)} className="rounded p-1.5 text-ink-muted hover:bg-base-700 hover:text-danger" title="Hapus"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <CardContent>
          <p className="mb-3 text-sm font-semibold text-ink-primary">Preferensi Notifikasi</p>
          <div className="space-y-2">
            {Object.entries(CAT_LABELS).map(([key, cat]) => (
              <label key={key} className="flex items-center justify-between rounded-lg border border-base-700/60 bg-base-800/40 px-3 py-2">
                <span className="text-sm text-ink-secondary">{cat.label}</span>
                    <input type="checkbox" defaultChecked className="rounded border-base-600 text-accent-content" />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
