import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, Check, ClipboardCheck, Download, HandHelping, PackageCheck, Plus, RotateCcw, UserRound, XCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { hasServerPermission } from '@/lib/authIdentity';
import { ApiClientError } from '@/lib/apiClient';
import { PageHeader } from '@/components/common/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { FormDialog } from '@/components/forms/FormDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { toast } from '@/stores/toastStore';
import { downloadCSV } from '@/utils';
import {
  ASSET_CONDITIONS,
  assetGateway,
  type AssetCondition,
  type AssetDto,
} from '@/services/assetApi';
import {
  loanGateway,
  type LoanDto,
  type LoanStatus,
  type ReturnLoanItemInput,
} from '@/services/loanApi';

const STATUS_LABELS: Record<LoanStatus, string> = {
  submitted: 'Diajukan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  cancelled: 'Dibatalkan',
  checked_out: 'Dipinjam',
  returned: 'Dikembalikan',
  closed: 'Selesai',
};

const CONDITION_LABELS: Record<AssetCondition, string> = {
  good: 'Baik',
  minor_damage: 'Rusak Ringan',
  moderate_damage: 'Rusak Sedang',
  major_damage: 'Rusak Berat',
  unknown: 'Tidak Diketahui',
};

function statusTone(status: LoanStatus): 'info' | 'success' | 'danger' | 'accent' | 'muted' {
  if (status === 'submitted') return 'info';
  if (status === 'approved' || status === 'returned') return 'success';
  if (status === 'rejected' || status === 'cancelled') return 'danger';
  if (status === 'checked_out') return 'accent';
  return 'muted';
}

function conditionTone(condition: AssetCondition | null): 'success' | 'warning' | 'orange' | 'danger' | 'muted' {
  if (condition === 'good') return 'success';
  if (condition === 'minor_damage') return 'warning';
  if (condition === 'moderate_damage') return 'orange';
  if (condition === 'major_damage') return 'danger';
  return 'muted';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi peminjaman gagal.';
}

function futureDateTimeInput(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function formatLoanDateTime(value: string | null): string {
  if (!value) return 'Belum';
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function loanTimeline(loan: LoanDto) {
  return [
    { label: 'Diajukan', at: loan.createdAt, actor: loan.requestedByNameSnapshot },
    { label: 'Disetujui', at: loan.approvedAt, actor: loan.approvedByNameSnapshot },
    { label: 'Diserahkan', at: loan.handedOverAt, actor: loan.handedOverByNameSnapshot },
    { label: 'Dikembalikan', at: loan.returnedAt, actor: loan.returnedByNameSnapshot },
    { label: 'Pemeriksaan selesai', at: loan.inspectedAt, actor: loan.inspectedByNameSnapshot },
  ];
}

type CreateForm = {
  borrowerName: string;
  borrowerUnit: string;
  borrowerReference: string;
  purpose: string;
  requestedReturnAt: string;
  assetIds: string[];
};

type ReasonAction = { kind: 'reject' | 'cancel'; loan: LoanDto } | null;

export function LoansPage() {
  const user = useAuthStore((state) => state.user);
  const activeLabId = useUIStore((state) => state.activeLabId);
  const canViewAssets = hasServerPermission(user, 'assets.view');
  const canCreate = hasServerPermission(user, 'loans.create');
  const canApprove = hasServerPermission(user, 'loans.approve');
  const canCheckout = hasServerPermission(user, 'loans.checkout');
  const canReturn = hasServerPermission(user, 'loans.return');
  const canClose = hasServerPermission(user, 'loans.close');
  const canCancel = hasServerPermission(user, 'loans.cancel');
  const canExport = hasServerPermission(user, 'loans.export');

  const [loans, setLoans] = useState<LoanDto[]>([]);
  const [assets, setAssets] = useState<AssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState('');
  const [detail, setDetail] = useState<LoanDto | null>(null);
  const [reasonAction, setReasonAction] = useState<ReasonAction>(null);
  const [reason, setReason] = useState('');
  const [returnLoan, setReturnLoan] = useState<LoanDto | null>(null);
  const [returnItems, setReturnItems] = useState<ReturnLoanItemInput[]>([]);
  const [form, setForm] = useState<CreateForm>({
    borrowerName: '',
    borrowerUnit: '',
    borrowerReference: '',
    purpose: '',
    requestedReturnAt: futureDateTimeInput(),
    assetIds: [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextLoans, nextAssets] = await Promise.all([
        loanGateway.listAll(),
        canViewAssets
          ? assetGateway.listAll(activeLabId ? { homeLaboratoryId: activeLabId } : {})
          : Promise.resolve([]),
      ]);
      setLoans(nextLoans);
      setAssets(nextAssets);
      setDetail((current) => current ? (nextLoans.find((loan) => loan.id === current.id) ?? null) : null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [activeLabId, canViewAssets]);

  useEffect(() => {
    void load();
  }, [load]);

  const eligibleAssets = useMemo(
    () => assets.filter((asset) =>
      asset.lifecycleStatus === 'active'
      && (asset.condition === 'good' || asset.condition === 'minor_damage')),
    [assets],
  );
  const filteredEligibleAssets = useMemo(() => {
    const query = assetSearch.trim().toLocaleLowerCase('id-ID');
    if (query === '') return eligibleAssets;
    return eligibleAssets.filter((asset) =>
      [
        asset.assetCode,
        asset.name,
        asset.category,
        asset.brand ?? '',
        asset.model ?? '',
        asset.serialNumber ?? '',
      ].some((value) => value.toLocaleLowerCase('id-ID').includes(query)));
  }, [assetSearch, eligibleAssets]);
  const scopedAssetIds = useMemo(() => new Set(assets.map((asset) => asset.id)), [assets]);
  const scopedLoans = useMemo(
    () => activeLabId
      ? loans.filter((loan) => loan.items.some((item) => scopedAssetIds.has(item.assetId)))
      : loans,
    [activeLabId, loans, scopedAssetIds],
  );

  const stats = useMemo(() => {
    const returned = scopedLoans.filter((loan) => loan.status === 'returned').length;
    const closed = scopedLoans.filter((loan) => loan.status === 'closed').length;

    return {
      active: scopedLoans.filter((loan) => loan.status === 'checked_out').length,
      overdue: scopedLoans.filter((loan) => loan.isOverdue).length,
      returned,
      closed,
      completedHistory: returned + closed,
    };
  }, [scopedLoans]);

  const detailCustodyCount = detail?.items.filter((item) => item.custodyActive).length ?? 0;
  const detailTimeline = detail ? loanTimeline(detail) : [];

  function resetCreate() {
    setAssetSearch('');
    setForm({
      borrowerName: '',
      borrowerUnit: '',
      borrowerReference: '',
      purpose: '',
      requestedReturnAt: futureDateTimeInput(),
      assetIds: [],
    });
  }

  function toggleAsset(assetId: string) {
    setForm((current) => ({
      ...current,
      assetIds: current.assetIds.includes(assetId)
        ? current.assetIds.filter((id) => id !== assetId)
        : [...current.assetIds, assetId],
    }));
  }

  async function saveCreate() {
    if (form.borrowerName.trim().length < 2 || form.purpose.trim().length < 3 || form.assetIds.length === 0) {
      toast('Peminjam, tujuan, dan minimal satu Asset exact wajib dipilih.', 'error');
      return;
    }

    const requestedReturn = new Date(form.requestedReturnAt);
    if (Number.isNaN(requestedReturn.getTime()) || requestedReturn.getTime() <= Date.now()) {
      toast('Rencana kembali harus berada di masa depan.', 'error');
      return;
    }

    try {
      await loanGateway.create({
        borrowerReference: form.borrowerReference.trim() || null,
        borrowerName: form.borrowerName.trim(),
        borrowerUnit: form.borrowerUnit.trim() || null,
        purpose: form.purpose.trim(),
        requestedReturnAt: requestedReturn.toISOString(),
        assetIds: form.assetIds,
      });
      toast('Peminjaman diajukan dengan identitas Asset canonical.', 'success');
      setCreateOpen(false);
      resetCreate();
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function runAction(
    loan: LoanDto,
    action: 'approve' | 'checkout' | 'close',
  ) {
    try {
      if (action === 'approve') await loanGateway.approve(loan.id, loan.version);
      if (action === 'checkout') await loanGateway.checkout(loan.id, loan.version);
      if (action === 'close') await loanGateway.close(loan.id, loan.version);
      toast(
        action === 'approve' ? 'Peminjaman disetujui setelah Asset direvalidasi.'
          : action === 'checkout' ? 'Custody Asset aktif dan kondisi keluar disnapshot.'
            : 'Peminjaman ditutup setelah pengembalian.',
        'success',
      );
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  async function submitReasonAction() {
    if (!reasonAction || reason.trim().length < 3) {
      toast('Alasan minimal 3 karakter wajib diisi.', 'error');
      return;
    }

    try {
      if (reasonAction.kind === 'reject') {
        await loanGateway.reject(reasonAction.loan.id, reasonAction.loan.version, reason.trim());
      } else {
        await loanGateway.cancel(reasonAction.loan.id, reasonAction.loan.version, reason.trim());
      }
      toast(reasonAction.kind === 'reject' ? 'Peminjaman ditolak.' : 'Peminjaman dibatalkan.', 'success');
      setReasonAction(null);
      setReason('');
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function openReturn(loan: LoanDto) {
    setReturnLoan(loan);
    setReturnItems(loan.items.map((item) => ({
      loanItemId: item.id,
      conditionReturn: item.conditionOut ?? 'good',
      returnNotes: null,
    })));
  }

  function updateReturnItem(loanItemId: string, patch: Partial<ReturnLoanItemInput>) {
    setReturnItems((current) => current.map((item) =>
      item.loanItemId === loanItemId ? { ...item, ...patch } : item));
  }

  async function submitReturn() {
    if (!returnLoan || returnItems.length !== returnLoan.items.length) return;

    try {
      await loanGateway.returnLoan(returnLoan.id, returnLoan.version, returnItems);
      toast('Pengembalian dicatat sebagai evidence. Asset/Incident tidak dimutasi otomatis.', 'success');
      setReturnLoan(null);
      setReturnItems([]);
      await load();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function exportCSV() {
    downloadCSV('peminjaman-canonical.csv', scopedLoans.map((loan) => ({
      Nomor: loan.loanNumber,
      Peminjam: loan.borrowerNameSnapshot,
      Unit: loan.borrowerUnitSnapshot ?? '',
      Asset: loan.items.map((item) => item.assetCodeSnapshot).join(' | '),
      RencanaKembali: loan.requestedReturnAt,
      Status: STATUS_LABELS[loan.status],
      Terlambat: loan.isOverdue ? 'Ya' : 'Tidak',
    })));
  }

  if (loading) {
    return <Card><CardContent><p className="text-sm text-ink-muted">Memuat Loan custody canonical...</p></CardContent></Card>;
  }

  if (loadError) {
    return <EmptyState title="Peminjaman tidak dapat dimuat" description={loadError} action={<Button onClick={() => void load()}>Coba Lagi</Button>} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Peminjaman Barang"
        description="Peminjaman mengikuti konteks Lab melalui exact Asset binding. Checkout tetap hanya mengubah custody Loan, bukan home Laboratory atau lifecycle Asset/Device."
        icon={<HandHelping className="h-5 w-5" />}
        actions={<>
          {canExport && <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export</Button>}
          {canCreate && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { resetCreate(); setCreateOpen(true); }}>Pinjam Baru</Button>}
        </>}
      />

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent><p className="text-2xl font-bold text-accent-content">{stats.active}</p><p className="text-xs text-ink-muted">Custody Aktif</p></CardContent></Card>
        <Card><CardContent><p className="text-2xl font-bold text-danger">{stats.overdue}</p><p className="text-xs text-ink-muted">Terlambat (derived)</p></CardContent></Card>
        <Card>
          <CardContent>
            <p className="text-2xl font-bold text-success-foreground">{stats.completedHistory}</p>
            <p className="text-xs text-ink-muted">Riwayat pengembalian</p>
            <p className="mt-1 text-[11px] text-ink-muted">{stats.returned} menunggu pemeriksaan · {stats.closed} selesai</p>
          </CardContent>
        </Card>
      </div>

      {stats.overdue > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4" /> {stats.overdue} Loan melewati requestedReturnAt. Tidak ada status “overdue” yang ditulis manual.
        </div>
      )}

      <Card>
        {scopedLoans.length === 0 ? <EmptyState title="Belum ada peminjaman pada konteks ini" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-base-700 text-left text-ink-muted">
                  <th className="px-4 py-3 font-medium">Nomor</th>
                  <th className="px-4 py-3 font-medium">Peminjam</th>
                  <th className="px-4 py-3 font-medium">Asset Exact</th>
                  <th className="px-4 py-3 font-medium">Rencana Kembali</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {scopedLoans.map((loan) => (
                  <tr key={loan.id} className="cursor-pointer border-b border-base-700/40 hover:bg-base-700/30" onClick={() => setDetail(loan)}>
                    <td className="px-4 py-3 font-medium text-ink-primary">{loan.loanNumber}</td>
                    <td className="px-4 py-3 text-ink-secondary">
                      <div>{loan.borrowerNameSnapshot}</div>
                      <div className="text-xs text-ink-muted">{loan.borrowerUnitSnapshot ?? '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-ink-secondary">{loan.items.map((item) => item.assetCodeSnapshot).join(', ')}</td>
                    <td className={`px-4 py-3 ${loan.isOverdue ? 'font-medium text-danger' : 'text-ink-secondary'}`}>
                      {new Date(loan.requestedReturnAt).toLocaleString('id-ID')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={statusTone(loan.status)}>{STATUS_LABELS[loan.status]}</Badge>
                        {loan.isOverdue && <Badge tone="danger">Terlambat</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {canApprove && loan.status === 'submitted' && <Button size="sm" variant="success" icon={<Check className="h-3.5 w-3.5" />} onClick={() => void runAction(loan, 'approve')}>Setujui</Button>}
                        {canCheckout && loan.status === 'approved' && <Button size="sm" icon={<PackageCheck className="h-3.5 w-3.5" />} onClick={() => void runAction(loan, 'checkout')}>Serahkan</Button>}
                        {canReturn && loan.status === 'checked_out' && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => openReturn(loan)}>Kembali</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <FormDialog open={createOpen} onClose={() => setCreateOpen(false)} title="Ajukan Peminjaman" onSubmit={() => void saveCreate()} size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Peminjam" required value={form.borrowerName} onChange={(event) => setForm({ ...form, borrowerName: event.target.value })} />
            <Input label="Unit/Kelas" value={form.borrowerUnit} onChange={(event) => setForm({ ...form, borrowerUnit: event.target.value })} />
            <Input label="Referensi Person eksternal (opsional)" value={form.borrowerReference} onChange={(event) => setForm({ ...form, borrowerReference: event.target.value })} />
            <Input label="Rencana Kembali" required type="datetime-local" value={form.requestedReturnAt} onChange={(event) => setForm({ ...form, requestedReturnAt: event.target.value })} />
          </div>
          <Textarea label="Tujuan" required value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} />

          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm font-medium text-ink-secondary">Asset canonical yang dipinjam</p>
              <p className="text-xs text-ink-muted">{form.assetIds.length} dipilih</p>
            </div>
            <Input
              label="Cari Asset"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              placeholder="Kode, nama, kategori, brand, model, atau serial"
            />
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-base-700 p-3">
              {eligibleAssets.length === 0 ? (
                <p className="text-sm text-ink-muted">Tidak ada Asset active dengan kondisi Baik/Rusak Ringan yang dapat dipilih.</p>
              ) : filteredEligibleAssets.length === 0 ? (
                <p className="text-sm text-ink-muted">Tidak ada Asset yang cocok dengan pencarian.</p>
              ) : filteredEligibleAssets.map((asset) => (
                <label key={asset.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-base-700 bg-base-800/60 p-3">
                  <input
                    type="checkbox"
                    checked={form.assetIds.includes(asset.id)}
                    onChange={() => toggleAsset(asset.id)}
                    className="mt-1 rounded border-base-600 text-accent-content"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink-primary">{asset.assetCode} · {asset.name}</span>
                    <span className="block text-xs text-ink-muted">{asset.category} · {CONDITION_LABELS[asset.condition]}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">Tidak ada quantity ambigu: setiap pilihan menghasilkan satu LoanItem → satu Asset ULID exact.</p>
          </div>
        </div>
      </FormDialog>

      <Drawer
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.loanNumber}
        description={detail ? `${detail.borrowerNameSnapshot} · ${detail.borrowerUnitSnapshot ?? 'Tanpa unit'}` : undefined}
        width="max-w-2xl"
        footer={detail ? (
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-ink-muted">Version {detail.version} · {detailCustodyCount}/{detail.items.length} Asset dalam custody aktif</p>
            <div className="flex flex-wrap justify-end gap-2">
              {canApprove && detail.status === 'submitted' && <>
                <Button size="sm" variant="success" icon={<Check className="h-4 w-4" />} onClick={() => void runAction(detail, 'approve')}>Setujui</Button>
                <Button size="sm" variant="secondary" icon={<XCircle className="h-4 w-4" />} onClick={() => { setReason(''); setReasonAction({ kind: 'reject', loan: detail }); }}>Tolak</Button>
              </>}
              {canCheckout && detail.status === 'approved' && <Button size="sm" icon={<PackageCheck className="h-4 w-4" />} onClick={() => void runAction(detail, 'checkout')}>Serahkan Asset</Button>}
              {canReturn && detail.status === 'checked_out' && <Button size="sm" variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => openReturn(detail)}>Catat Pengembalian</Button>}
              {canClose && detail.status === 'returned' && <Button size="sm" onClick={() => void runAction(detail, 'close')}>Tutup Setelah Pemeriksaan</Button>}
              {canCancel && (detail.status === 'submitted' || detail.status === 'approved') && <Button size="sm" variant="ghost" onClick={() => { setReason(''); setReasonAction({ kind: 'cancel', loan: detail }); }}>Batalkan</Button>}
            </div>
          </div>
        ) : undefined}
      >
        {detail && (
          <div className="space-y-5 text-sm">
            <div className="rounded-xl border border-base-700 bg-base-900/30 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={statusTone(detail.status)}>{STATUS_LABELS[detail.status]}</Badge>
                  <Badge tone={detailCustodyCount > 0 ? 'accent' : 'muted'}>{detailCustodyCount > 0 ? 'Custody aktif' : 'Custody tidak aktif'}</Badge>
                  {detail.isOverdue && <Badge tone="danger">Terlambat (derived)</Badge>}
                </div>
                <p className="text-xs text-ink-muted">Dibuat {formatLoanDateTime(detail.createdAt)}</p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-ink-muted">Rencana kembali</p>
                  <p className={detail.isOverdue ? 'mt-1 font-medium text-danger' : 'mt-1 text-ink-primary'}>{formatLoanDateTime(detail.requestedReturnAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Jumlah Asset</p>
                  <p className="mt-1 text-ink-primary">{detail.items.length} exact Asset</p>
                </div>
                <div>
                  <p className="text-xs text-ink-muted">Referensi peminjam</p>
                  <p className="mt-1 text-ink-primary">{detail.borrowerReference ?? '-'}</p>
                </div>
              </div>
            </div>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <UserRound className="h-4 w-4 text-ink-muted" />
                <h3 className="font-medium text-ink-primary">Informasi peminjam</h3>
              </div>
              <div className="grid gap-3 rounded-xl border border-base-700 bg-base-800/40 p-4 sm:grid-cols-2">
                <div><p className="text-xs text-ink-muted">Peminjam</p><p className="mt-1 text-ink-primary">{detail.borrowerNameSnapshot}</p></div>
                <div><p className="text-xs text-ink-muted">Unit/Kelas</p><p className="mt-1 text-ink-primary">{detail.borrowerUnitSnapshot ?? '-'}</p></div>
                <div><p className="text-xs text-ink-muted">Diminta oleh</p><p className="mt-1 text-ink-primary">{detail.requestedByNameSnapshot}</p></div>
                <div><p className="text-xs text-ink-muted">Tujuan</p><p className="mt-1 text-ink-secondary">{detail.purpose}</p></div>
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-ink-muted" />
                <h3 className="font-medium text-ink-primary">Asset & custody</h3>
              </div>
              <div className="space-y-2">
                {detail.items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-base-700 bg-base-800/45 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-ink-primary">{item.assetCodeSnapshot}</p>
                        <p className="mt-0.5 text-sm text-ink-secondary">{item.assetNameSnapshot}</p>
                      </div>
                      <Badge tone={item.custodyActive ? 'accent' : 'muted'}>{item.custodyActive ? 'Custody aktif' : 'Custody dilepas'}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-ink-muted">Kondisi</span>
                      <Badge tone={conditionTone(item.conditionOut)}>{item.conditionOut ? `Keluar: ${CONDITION_LABELS[item.conditionOut]}` : 'Keluar: belum disnapshot'}</Badge>
                      <ArrowRight className="h-3.5 w-3.5 text-ink-muted" />
                      <Badge tone={conditionTone(item.conditionReturn)}>{item.conditionReturn ? `Kembali: ${CONDITION_LABELS[item.conditionReturn]}` : 'Kembali: belum ada evidence'}</Badge>
                    </div>
                    {item.returnNotes && (
                      <div className="mt-3 rounded-lg border border-base-700/70 bg-base-900/30 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-ink-muted">Catatan pengembalian</p>
                        <p className="mt-1 text-xs text-ink-secondary">{item.returnNotes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-ink-muted" />
                <h3 className="font-medium text-ink-primary">Lifecycle Loan</h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {detailTimeline.map((step) => (
                  <div key={step.label} className="flex gap-3 rounded-lg border border-base-700/70 bg-base-800/35 p-3">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${step.at ? 'bg-success' : 'bg-base-600'}`} />
                    <div className="min-w-0">
                      <p className="font-medium text-ink-secondary">{step.label}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{formatLoanDateTime(step.at)}</p>
                      {step.actor && <p className="mt-0.5 truncate text-xs text-ink-muted">oleh {step.actor}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {detail.terminalReason && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3">
                <p className="text-xs font-medium text-warning-foreground">Alasan terminal</p>
                <p className="mt-1 text-xs text-ink-secondary">{detail.terminalReason}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal
        open={Boolean(reasonAction)}
        onClose={() => setReasonAction(null)}
        title={reasonAction?.kind === 'reject' ? 'Tolak Peminjaman' : 'Batalkan Peminjaman'}
        footer={<>
          <Button variant="ghost" onClick={() => setReasonAction(null)}>Batal</Button>
          <Button onClick={() => void submitReasonAction()}>Simpan Keputusan</Button>
        </>}
      >
        <Textarea label="Alasan" required value={reason} onChange={(event) => setReason(event.target.value)} />
      </Modal>

      <Modal
        open={Boolean(returnLoan)}
        onClose={() => setReturnLoan(null)}
        title="Pengembalian Asset"
        description="Konfirmasi evidence kondisi saat Asset kembali. Return melepas custody Loan saja."
        size="lg"
        footer={<>
          <Button variant="ghost" onClick={() => setReturnLoan(null)}>Batal</Button>
          <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => void submitReturn()}>Simpan Pengembalian</Button>
        </>}
      >
        <div className="space-y-4">
          {returnLoan && (
            <div className="grid gap-3 rounded-xl border border-base-700 bg-base-900/30 p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-ink-muted">Loan</p>
                <p className="mt-1 font-medium text-ink-primary">{returnLoan.loanNumber}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Peminjam</p>
                <p className="mt-1 text-ink-primary">{returnLoan.borrowerNameSnapshot}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Asset dalam return</p>
                <p className="mt-1 text-ink-primary">{returnLoan.items.length} exact Asset</p>
              </div>
            </div>
          )}

          {returnLoan?.items.map((loanItem) => {
            const evidence = returnItems.find((item) => item.loanItemId === loanItem.id);
            const conditionChanged = Boolean(
              loanItem.conditionOut
              && evidence?.conditionReturn
              && loanItem.conditionOut !== evidence.conditionReturn,
            );

            return (
              <div key={loanItem.id} className="rounded-xl border border-base-700 bg-base-800/45 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-ink-muted">Asset exact</p>
                    <p className="mt-1 font-medium text-ink-primary">{loanItem.assetCodeSnapshot}</p>
                    <p className="mt-0.5 text-sm text-ink-secondary">{loanItem.assetNameSnapshot}</p>
                  </div>
                  <Badge tone={loanItem.custodyActive ? 'accent' : 'muted'}>{loanItem.custodyActive ? 'Custody aktif' : 'Custody tidak aktif'}</Badge>
                </div>

                <div className="mt-4 grid items-start gap-3 md:grid-cols-[minmax(0,180px)_auto_minmax(0,220px)]">
                  <div className="rounded-lg border border-base-700/70 bg-base-900/30 p-3">
                    <p className="text-xs text-ink-muted">Kondisi saat keluar</p>
                    <div className="mt-2">
                      <Badge tone={conditionTone(loanItem.conditionOut)}>
                        {loanItem.conditionOut ? CONDITION_LABELS[loanItem.conditionOut] : 'Belum disnapshot'}
                      </Badge>
                    </div>
                  </div>

                  <ArrowRight className="mt-7 hidden h-4 w-4 text-ink-muted md:block" />

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-ink-secondary">Kondisi saat kembali</label>
                    <select
                      value={evidence?.conditionReturn ?? 'good'}
                      onChange={(event) => updateReturnItem(loanItem.id, { conditionReturn: event.target.value as AssetCondition })}
                      className="h-11 w-full rounded-lg border border-base-600 bg-base-800 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-accent-content/50"
                    >
                      {ASSET_CONDITIONS.map((condition) => <option key={condition} value={condition}>{CONDITION_LABELS[condition]}</option>)}
                    </select>
                    <p className="text-xs text-ink-muted">Evidence saja; tidak melakukan direct Asset mutation.</p>
                  </div>
                </div>

                <div className="mt-4">
                  <Textarea
                    label="Catatan Pengembalian"
                    rows={3}
                    value={evidence?.returnNotes ?? ''}
                    onChange={(event) => updateReturnItem(loanItem.id, { returnNotes: event.target.value || null })}
                  />
                </div>

                {conditionChanged && (
                  <div className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-ink-secondary">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                    <span>Kondisi kembali berbeda dari kondisi keluar. Perubahan ini tetap hanya return evidence; Incident dan perubahan kondisi Asset harus dilakukan eksplisit melalui authority masing-masing.</span>
                  </div>
                )}
              </div>
            );
          })}

          <div className="rounded-lg border border-info/30 bg-info/10 px-3 py-2.5 text-xs text-ink-secondary">
            Return melepaskan custody Loan dan menyimpan evidence. Tidak ada perubahan home Laboratory, lifecycle Asset/Device, Asset condition, atau Incident secara implisit.
          </div>
        </div>
      </Modal>
    </div>
  );
}
