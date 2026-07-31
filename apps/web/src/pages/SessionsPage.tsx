import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardList, Play, Square, Plus, AlertTriangle, Download } from 'lucide-react';
import { useAppData } from '@/hooks/useAppData';
import { useAuthStore } from '@/stores/authStore';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV, relativeTime } from '@/utils';
import type { Session } from '@/types';

export function SessionsPage() {
  const { db, mutate } = useAppData();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canCreate = usePermission('sessions', 'create');
  const canUpdate = usePermission('sessions', 'update');
  const canExport = usePermission('sessions', 'export');
  const canViewJournals = usePermission('journals', 'view');
  const [open, setOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState<Session | null>(null);
  const [detail, setDetail] = useState<Session | null>(null);
  const [form, setForm] = useState<Partial<Session>>({});
  const [finishForm, setFinishForm] = useState<Partial<Session>>({});

  function openCreate() {
    if (!canCreate) return;
    setForm({ laboratoryId: db.labs[0]?.id, teacherName: user?.name ?? '', className: '', subject: '', participantCount: 30, initialCondition: '', notes: '', status: 'Belum Dimulai' });
    setOpen(true);
  }

  function save() {
    if (!canCreate) return;
    if (!form.laboratoryId || !form.className || !form.subject) {
      toast('Lengkapi field wajib', 'error');
      return;
    }
    mutate((d) => {
      d.sessions.unshift({
        id: `ses-${Date.now()}`,
        laboratoryId: form.laboratoryId ?? '',
        teacherName: form.teacherName ?? '',
        className: form.className ?? '',
        subject: form.subject ?? '',
        participantCount: form.participantCount ?? 0,
        startTime: new Date().toISOString(),
        initialCondition: form.initialCondition ?? '',
        brokenPCsBefore: [],
        notes: form.notes ?? '',
        status: 'Belum Dimulai',
      });
    });
    toast('Pelaksanaan Lab dibuat', 'success');
    setOpen(false);
  }

  function startSession(s: Session) {
    if (!canUpdate) return;
    mutate((d) => {
      const idx = d.sessions.findIndex((x) => x.id === s.id);
      if (idx >= 0) {
        d.sessions[idx].status = 'Berlangsung';
        d.sessions[idx].startTime = new Date().toISOString();
      }
    });
    toast('Pelaksanaan dimulai', 'success');
  }

  function openFinish(s: Session) {
    setFinishForm({ presentCount: s.participantCount, absentCount: 0, finalMaterial: s.subject, finalSoftware: '', finalCondition: '', issues: '', followUp: '', brokenPCsAfter: [] });
    setFinishOpen(s);
  }

  function finishSession() {
    if (!canUpdate) return;
    if (!finishOpen) return;
    mutate((d) => {
      const idx = d.sessions.findIndex((x) => x.id === finishOpen.id);
      if (idx >= 0) {
        const s = d.sessions[idx];
        d.sessions[idx] = {
          ...s,
          ...finishForm,
          status: 'Selesai',
          endTime: new Date().toISOString(),
        };
        // Auto-create journal
        const jn = `JRN-2026-${String(d.journals.length + 1).padStart(4, '0')}`;
        const journal = {
          id: `jrn-${Date.now()}`,
          journalNumber: jn,
          date: new Date().toISOString().split('T')[0],
          laboratoryId: s.laboratoryId,
          teacherName: s.teacherName,
          className: s.className,
          subject: s.subject,
          hours: 3,
          material: finishForm.finalMaterial ?? '',
          software: finishForm.finalSoftware ?? '',
          presentCount: finishForm.presentCount ?? 0,
          absentCount: finishForm.absentCount ?? 0,
          initialCondition: s.initialCondition,
          finalCondition: finishForm.finalCondition ?? '',
          issues: finishForm.issues ?? '',
          followUp: finishForm.followUp ?? '',
          status: 'Draft' as const,
          source: 'session' as const,
          sessionId: s.id,
        };
        d.journals.unshift(journal);
        d.sessions[idx].journalId = journal.id;
        // Convert broken PCs to incidents
        if (finishForm.brokenPCsAfter && finishForm.brokenPCsAfter.length > 0) {
          finishForm.brokenPCsAfter.forEach((pc) => {
            const num = `INC-2026-${String(d.incidents.length + 1).padStart(4, '0')}`;
            d.incidents.unshift({
              id: `inc-${Date.now()}-${pc}`,
              ticketNumber: num,
              reporterName: s.teacherName,
              laboratoryId: s.laboratoryId,
              assetCode: pc,
              date: new Date().toISOString(),
              category: 'hardware',
              title: `Kerusakan ${pc} dari pelaksanaan ${s.subject}`,
              description: `Ditemukan saat pelaksanaan ${s.className} - ${s.subject}`,
              impact: 'Menghambat praktikum',
              priority: 'Normal',
              blocksPracticum: true,
              stepsTaken: 'Dicek saat pelaksanaan berlangsung',
              status: 'Dilaporkan',
              comments: [],
              timeline: [{ status: 'Dilaporkan', at: new Date().toISOString(), by: s.teacherName }],
            });
          });
        }
      }
    });
    toast('Pelaksanaan selesai. Jurnal otomatis dibuat' + (finishForm.brokenPCsAfter?.length ? ` dan ${finishForm.brokenPCsAfter.length} tiket kerusakan dibuat` : ''), 'success');
    setFinishOpen(null);
  }

  function exportCSV() {
    if (!canExport) return;
    downloadCSV('pelaksanaan-lab.csv', db.sessions.map((s) => ({
      Lab: db.labs.find((l) => l.id === s.laboratoryId)?.name, Kelas: s.className, Guru: s.teacherName, Mapel: s.subject, Status: s.status, Mulai: s.startTime, Selesai: s.endTime ?? '',
    })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pelaksanaan Lab"
        description="Kelola kegiatan laboratorium dari mulai pelaksanaan, kondisi perangkat, hingga penyelesaian laporan."
        icon={<BookOpen className="h-5 w-5" />}
        actions={
          <>
            {canViewJournals && <Button variant="secondary" size="sm" icon={<ClipboardList className="h-4 w-4" />} onClick={() => navigate('/journals')}>Riwayat & Laporan</Button>}
            {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
            {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>Pelaksanaan Baru</Button>}
          </>
        }
      />

      <Card>
        <CardContent>
          <p className="text-sm text-ink-secondary">Pelaksanaan dan laporan merupakan satu rangkaian. Setelah kegiatan diakhiri, laporan atau jurnal harus dilengkapi sebelum pelaksanaan dinyatakan tuntas. Frontend saat ini masih menggunakan layar sesi dan jurnal terpisah selama masa transisi.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Belum Dimulai', 'Berlangsung', 'Selesai', 'Dibatalkan'].map((st) => (
          <Card key={st}><CardContent>
            <p className="text-2xl font-bold text-ink-primary">{db.sessions.filter((s) => s.status === st).length}</p>
            <p className="text-xs text-ink-muted">{st}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-base-700 text-left text-ink-muted">
              <th className="px-4 py-3 font-medium">Lab</th><th className="px-4 py-3 font-medium">Kelas</th><th className="px-4 py-3 font-medium">Guru</th><th className="px-4 py-3 font-medium">Mapel</th><th className="px-4 py-3 font-medium">Peserta</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Aksi</th>
            </tr></thead>
            <tbody>
              {db.sessions.length === 0 ? <tr><td colSpan={7}><EmptyState title="Belum ada pelaksanaan" className="py-10" /></td></tr> : db.sessions.map((s) => (
                <tr key={s.id} className="border-b border-base-700/40 hover:bg-base-700/30 cursor-pointer" onClick={() => setDetail(s)}>
                  <td className="px-4 py-3 text-ink-primary">{db.labs.find((l) => l.id === s.laboratoryId)?.name}</td>
                  <td className="px-4 py-3 text-ink-secondary">{s.className}</td>
                  <td className="px-4 py-3 text-ink-secondary">{s.teacherName}</td>
                  <td className="px-4 py-3 text-ink-secondary">{s.subject}</td>
                  <td className="px-4 py-3 text-ink-secondary">{s.participantCount}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {s.status === 'Belum Dimulai' && canUpdate && <Button size="sm" variant="success" icon={<Play className="h-3.5 w-3.5" />} onClick={() => startSession(s)}>Mulai</Button>}
                      {s.status === 'Berlangsung' && canUpdate && <Button size="sm" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={() => openFinish(s)}>Selesai</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <FormDialog open={open} onClose={() => setOpen(false)} title="Pelaksanaan Lab Baru" onSubmit={save} size="lg">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Laboratorium" value={form.laboratoryId} onChange={(e) => setForm({ ...form, laboratoryId: e.target.value })} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} />
          <Input label="Guru" value={form.teacherName ?? ''} onChange={(e) => setForm({ ...form, teacherName: e.target.value })} />
          <Input label="Kelas" value={form.className ?? ''} onChange={(e) => setForm({ ...form, className: e.target.value })} />
          <Input label="Mata Pelajaran" value={form.subject ?? ''} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <Input label="Jumlah Peserta" type="number" value={form.participantCount ?? 0} onChange={(e) => setForm({ ...form, participantCount: Number(e.target.value) })} />
          <Input label="PC Bermasalah (sebelum)" placeholder="PC-01, PC-02" onChange={(e) => setForm({ ...form, brokenPCsBefore: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          <div className="sm:col-span-2"><Textarea label="Kondisi Awal" value={form.initialCondition ?? ''} onChange={(e) => setForm({ ...form, initialCondition: e.target.value })} /></div>
          <div className="sm:col-span-2"><Textarea label="Catatan" value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(finishOpen)} onClose={() => setFinishOpen(null)} title="Akhiri Pelaksanaan" description="Jurnal akan dibuat otomatis" onSubmit={finishSession} size="lg" submitLabel="Selesai & Buat Jurnal">
        {finishOpen && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Materi" value={finishForm.finalMaterial ?? ''} onChange={(e) => setFinishForm({ ...finishForm, finalMaterial: e.target.value })} />
            <Input label="Software" value={finishForm.finalSoftware ?? ''} onChange={(e) => setFinishForm({ ...finishForm, finalSoftware: e.target.value })} />
            <Input label="Jumlah Hadir" type="number" value={finishForm.presentCount ?? 0} onChange={(e) => setFinishForm({ ...finishForm, presentCount: Number(e.target.value) })} />
            <Input label="Jumlah Tidak Hadir" type="number" value={finishForm.absentCount ?? 0} onChange={(e) => setFinishForm({ ...finishForm, absentCount: Number(e.target.value) })} />
            <div className="sm:col-span-2"><Textarea label="Kondisi Akhir" value={finishForm.finalCondition ?? ''} onChange={(e) => setFinishForm({ ...finishForm, finalCondition: e.target.value })} /></div>
            <div className="sm:col-span-2"><Textarea label="Kendala" value={finishForm.issues ?? ''} onChange={(e) => setFinishForm({ ...finishForm, issues: e.target.value })} /></div>
            <div className="sm:col-span-2"><Input label="PC Bermasalah (akan jadi incident)" placeholder="PC-05, PC-12" onChange={(e) => setFinishForm({ ...finishForm, brokenPCsAfter: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
            <div className="sm:col-span-2"><Textarea label="Tindak Lanjut" value={finishForm.followUp ?? ''} onChange={(e) => setFinishForm({ ...finishForm, followUp: e.target.value })} /></div>
          </div>
        )}
      </FormDialog>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail ? `${detail.subject} · ${detail.className}` : ''} description={detail?.teacherName} width="max-w-lg">
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-ink-muted">Lab</p><p className="text-ink-primary">{db.labs.find((l) => l.id === detail.laboratoryId)?.name}</p></div>
              <div><p className="text-xs text-ink-muted">Peserta</p><p className="text-ink-primary">{detail.participantCount}</p></div>
              <div><p className="text-xs text-ink-muted">Mulai</p><p className="text-ink-primary">{relativeTime(detail.startTime)}</p></div>
              <div><p className="text-xs text-ink-muted">Selesai</p><p className="text-ink-primary">{detail.endTime ? relativeTime(detail.endTime) : '-'}</p></div>
            </div>
            <div><p className="text-xs text-ink-muted">Kondisi Awal</p><p className="text-ink-secondary">{detail.initialCondition || '-'}</p></div>
            {detail.finalMaterial && <div><p className="text-xs text-ink-muted">Materi</p><p className="text-ink-secondary">{detail.finalMaterial}</p></div>}
            {detail.issues && <div><p className="text-xs text-ink-muted">Kendala</p><p className="text-warning-foreground">{detail.issues}</p></div>}
            {detail.brokenPCsAfter && detail.brokenPCsAfter.length > 0 && (
              <div><p className="text-xs text-ink-muted">PC Bermasalah</p><div className="mt-1 flex flex-wrap gap-1">{detail.brokenPCsAfter.map((pc) => <Badge key={pc} tone="danger">{pc}</Badge>)}</div></div>
            )}
            {detail.journalId && <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success-foreground"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />Jurnal dibuat otomatis dari pelaksanaan ini</div>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
