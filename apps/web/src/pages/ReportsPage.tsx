import { useMemo, useState } from 'react';
import { BarChart3, Download, Printer, FileText, TrendingUp, Activity, Wrench, Package } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { useAppData } from '@/hooks/useAppData';
import { usePermission } from '@/components/common/PermissionGuard';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import { useChartTheme } from '@/hooks/useChartTheme';

const REPORT_CATS = [
  { key: 'usage', label: 'Penggunaan Laboratorium', icon: BarChart3 },
  { key: 'journals', label: 'Jurnal', icon: FileText },
  { key: 'assets', label: 'Kondisi Aset', icon: Package },
  { key: 'incidents', label: 'Kerusakan', icon: Activity },
  { key: 'workorders', label: 'Tugas Perbaikan', icon: Wrench },
  { key: 'sla', label: 'SLA Teknisi', icon: TrendingUp },
  { key: 'maintenance', label: 'Pemeliharaan Berkala', icon: Wrench },
  { key: 'stock', label: 'Stok', icon: Package },
  { key: 'loans', label: 'Peminjaman', icon: Package },
];

export function ReportsPage() {
  const { db } = useAppData();
  const canExport = usePermission('reports', 'export');
  const chartTheme = useChartTheme();
  const [active, setActive] = useState('usage');
  const [dateFrom, setDateFrom] = useState('2026-07-01');
  const [dateTo, setDateTo] = useState('2026-07-31');
  const [labFilter, setLabFilter] = useState('all');

  const usageData = useMemo(() => {
    return db.labs.map((lab) => {
      const devices = db.devices.filter((d) => d.laboratoryId === lab.id);
      const schedules = db.schedules.filter((s) => s.laboratoryId === lab.id);
      return { name: lab.code, jadwal: schedules.length, online: devices.filter((d) => d.status === 'Online').length, masalah: devices.filter((d) => ['Critical', 'Warning', 'Offline'].includes(d.status)).length };
    });
  }, [db]);

  const incidentTrend = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul'];
    return months.map((m, i) => ({ name: m, incident: 5 + ((i * 7) % 10), selesai: 3 + ((i * 5) % 8) }));
  }, []);

  const assetConditionData = useMemo(() => {
    const conds = ['Baik', 'Rusak Ringan', 'Rusak Sedang', 'Rusak Berat'];
    return conds.map((c) => ({ name: c, value: db.assets.filter((a) => a.condition === c).length, color: c === 'Baik' ? chartTheme.success : c === 'Rusak Ringan' ? chartTheme.warning : c === 'Rusak Sedang' ? chartTheme.orange : chartTheme.danger })).filter((x) => x.value > 0);
  }, [chartTheme, db.assets]);

  const slaData = useMemo(() => {
    const techs = ['Andi Wijaya', 'Dedi Kurniawan'];
    return techs.map((t) => {
      const wos = db.workOrders.filter((w) => w.technician === t);
      const completed = wos.filter((w) => w.status === 'Completed' || w.status === 'Verified');
      return { name: t, selesai: completed.length, total: wos.length, sla: wos.length > 0 ? Math.round((completed.length / wos.length) * 100) : 0 };
    });
  }, [db.workOrders]);

  function exportCSV() {
    if (!canExport) return;
    const data: Record<string, unknown>[] = [];
    if (active === 'usage') usageData.forEach((d) => data.push(d));
    else if (active === 'incidents') db.incidents.forEach((i) => data.push({ Tiket: i.ticketNumber, Judul: i.title, Status: i.status, Prioritas: i.priority }));
    else if (active === 'workorders') db.workOrders.forEach((w) => data.push({ WO: w.woNumber, Teknisi: w.technician, Status: w.status, Biaya: w.cost }));
    else if (active === 'journals') db.journals.forEach((j) => data.push({ No: j.journalNumber, Guru: j.teacherName, Kelas: j.className, Status: j.status }));
    else if (active === 'assets') db.assets.forEach((a) => data.push({ Kode: a.assetCode, Nama: a.name, Kondisi: a.condition, Status: a.status }));
    else if (active === 'stock') db.stock.items.forEach((s) => data.push({ Nama: s.name, Jumlah: s.quantity, Min: s.minStock }));
    else if (active === 'loans') db.loans.forEach((l) => data.push({ Peminjam: l.borrowerName, Barang: l.itemName, Status: l.status }));
    else if (active === 'maintenance') db.maintenance.plans.forEach((p) => data.push({ Nama: p.name, Frekuensi: p.frequency, Status: p.status }));
    else if (active === 'sla') slaData.forEach((s) => data.push({ Teknisi: s.name, Selesai: s.selesai, Total: s.total, SLA: s.sla }));
    downloadCSV(`laporan-${active}.csv`, data);
    toast('Laporan CSV berhasil diunduh', 'success');
  }

  const activeCat = REPORT_CATS.find((c) => c.key === active)!;

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan & Analitik" description="Analisis penggunaan laboratorium, aset, kerusakan, perbaikan, stok, dan pemeliharaan." icon={<BarChart3 className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export CSV</Button>}
          {canExport && <Button variant="secondary" size="sm" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>Print</Button>}
        </>}
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Input label="Dari Tanggal" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <Input label="Sampai Tanggal" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <Select label="Lab" value={labFilter} onChange={(e) => setLabFilter(e.target.value)} options={db.labs.map((l) => ({ value: l.id, label: l.name }))} placeholder="Semua" />
        </CardContent>
      </Card>

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {REPORT_CATS.map((cat) => {
          const Icon = cat.icon;
          return (
            <button key={cat.key} onClick={() => setActive(cat.key)} className={`flex items-center gap-2 rounded-xl border p-3 text-left text-sm transition-all ${active === cat.key ? 'border-accent-content bg-accent-primary/10 text-accent-content' : 'border-base-700 text-ink-secondary hover:border-base-600'}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{cat.label}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader><CardTitle>{activeCat.label}</CardTitle><Badge tone="accent">{dateFrom} - {dateTo}</Badge></CardHeader>
        <CardContent className="space-y-6">
          {active === 'usage' && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={usageData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="name" stroke={chartTheme.axis} fontSize={11} />
                <YAxis stroke={chartTheme.axis} fontSize={11} />
                <Tooltip contentStyle={chartTheme.tooltip} />
                <Legend wrapperStyle={chartTheme.legend} />
                <Bar dataKey="jadwal" fill={chartTheme.primary} name="Jadwal" radius={[4, 4, 0, 0]} />
                <Bar dataKey="online" fill={chartTheme.success} name="Online" radius={[4, 4, 0, 0]} />
                <Bar dataKey="masalah" fill={chartTheme.warning} name="Bermasalah" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {active === 'incidents' && (
            <>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={incidentTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis dataKey="name" stroke={chartTheme.axis} fontSize={11} />
                  <YAxis stroke={chartTheme.axis} fontSize={11} />
                  <Tooltip contentStyle={chartTheme.tooltip} />
                  <Legend wrapperStyle={chartTheme.legend} />
                  <Line type="monotone" dataKey="incident" stroke={chartTheme.danger} strokeWidth={2} name="Incident" />
                  <Line type="monotone" dataKey="selesai" stroke={chartTheme.success} strokeWidth={2} name="Selesai" />
                </LineChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Total" value={db.incidents.length} />
                <Stat label="Selesai" value={db.incidents.filter((i) => i.status === 'Selesai' || i.status === 'Ditutup').length} />
                <Stat label="Aktif" value={db.incidents.filter((i) => !['Selesai', 'Ditutup', 'Ditolak'].includes(i.status)).length} />
                <Stat label="Kritis" value={db.incidents.filter((i) => i.priority === 'Kritis').length} />
              </div>
            </>
          )}
          {active === 'assets' && (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={assetConditionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                  {assetConditionData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={chartTheme.tooltip} />
                <Legend wrapperStyle={chartTheme.legend} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {active === 'workorders' && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Total WO" value={db.workOrders.length} />
              <Stat label="Completed" value={db.workOrders.filter((w) => w.status === 'Completed' || w.status === 'Verified').length} />
              <Stat label="In Progress" value={db.workOrders.filter((w) => w.status === 'In Progress').length} />
              <Stat label="Total Biaya" value={`Rp ${(db.workOrders.reduce((s, w) => s + w.cost, 0) / 1000000).toFixed(1)}jt`} />
            </div>
          )}
          {active === 'journals' && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Total" value={db.journals.length} />
              <Stat label="Diverifikasi" value={db.journals.filter((j) => j.status === 'Diverifikasi').length} />
              <Stat label="Draft" value={db.journals.filter((j) => j.status === 'Draft').length} />
              <Stat label="Perlu Perbaikan" value={db.journals.filter((j) => j.status === 'Perlu Perbaikan').length} />
            </div>
          )}
          {active === 'sla' && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={slaData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="name" stroke={chartTheme.axis} fontSize={11} />
                <YAxis stroke={chartTheme.axis} fontSize={11} />
                <Tooltip contentStyle={chartTheme.tooltip} />
                <Legend wrapperStyle={chartTheme.legend} />
                <Bar dataKey="selesai" fill={chartTheme.success} name="Selesai" radius={[4, 4, 0, 0]} />
                <Bar dataKey="total" fill={chartTheme.primary} name="Total" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          {active === 'maintenance' && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Rencana Aktif" value={db.maintenance.plans.filter((p) => p.status === 'active').length} />
              <Stat label="Overdue" value={db.maintenance.plans.filter((p) => p.status === 'active' && new Date(p.nextSchedule) < new Date()).length} />
              <Stat label="Eksekusi" value={db.maintenance.executions.length} />
              <Stat label="Compliance" value={`${db.maintenance.plans.length > 0 ? Math.round((db.maintenance.executions.length / (db.maintenance.executions.length + db.maintenance.plans.filter((p) => new Date(p.nextSchedule) < new Date()).length)) * 100) : 100}%`} />
            </div>
          )}
          {active === 'stock' && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Jenis" value={db.stock.items.length} />
              <Stat label="Stok Rendah" value={db.stock.items.filter((s) => s.quantity <= s.minStock).length} />
              <Stat label="Transaksi" value={db.stock.transactions.length} />
              <Stat label="Nilai" value={`Rp ${(db.stock.items.reduce((s, i) => s + i.quantity * i.price, 0) / 1000000).toFixed(1)}jt`} />
            </div>
          )}
          {active === 'loans' && (
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Total" value={db.loans.length} />
              <Stat label="Dipinjam" value={db.loans.filter((l) => l.status === 'Dipinjam').length} />
              <Stat label="Terlambat" value={db.loans.filter((l) => l.status === 'Terlambat').length} />
              <Stat label="Selesai" value={db.loans.filter((l) => l.status === 'Selesai').length} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-base-700/60 bg-base-800/40 p-3 text-center"><p className="text-2xl font-bold text-ink-primary">{value}</p><p className="text-xs text-ink-muted">{label}</p></div>;
}
