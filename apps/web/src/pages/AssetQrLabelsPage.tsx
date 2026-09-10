import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Filter, QrCode, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import {
  ASSET_QR_LABEL_TEMPLATES,
  assetQrGateway,
  type AssetQrLabelBatch,
  type AssetQrLabelCandidate,
  type AssetQrLabelSelection,
  type AssetQrLabelTemplate,
} from '@/services/assetQrApi';
import { laboratoryGateway, type LaboratoryDto } from '@/services/laboratoryApi';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { toast } from '@/stores/toastStore';

const CONDITION_LABELS: Record<AssetQrLabelCandidate['condition'], string> = {
  good: 'Baik',
  minor_damage: 'Rusak Ringan',
  moderate_damage: 'Rusak Sedang',
  major_damage: 'Rusak Berat',
  unknown: 'Tidak Diketahui',
};

const LIFECYCLE_LABELS: Record<AssetQrLabelCandidate['lifecycleStatus'], string> = {
  active: 'Aktif',
  retired: 'Pensiun',
  disposed: 'Dihapuskan',
};

const TEMPLATE_LABELS: Record<AssetQrLabelTemplate, string> = {
  '40x25': '40 × 25 mm',
  '50x30': '50 × 30 mm · Default',
  '70x40': '70 × 40 mm',
};

const TEMPLATE_PREVIEW: Record<AssetQrLabelTemplate, string> = {
  '40x25': 'aspect-[8/5] max-w-[320px]',
  '50x30': 'aspect-[5/3] max-w-[360px]',
  '70x40': 'aspect-[7/4] max-w-[400px]',
};

type FilterState = {
  search: string;
  category: string;
  condition: 'all' | AssetQrLabelCandidate['condition'];
  lifecycleStatus: 'all' | AssetQrLabelCandidate['lifecycleStatus'];
  linkStatus: 'all' | 'linked' | 'unlinked';
  qrStatus: 'all' | 'active' | 'missing';
  printedStatus: 'all' | 'printed' | 'unprinted';
};

const EMPTY_FILTERS: FilterState = {
  search: '',
  category: '',
  condition: 'all',
  lifecycleStatus: 'all',
  linkStatus: 'all',
  qrStatus: 'all',
  printedStatus: 'all',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Operasi Asset QR/Label gagal.';
}

function conditionTone(condition: AssetQrLabelCandidate['condition']): 'success' | 'warning' | 'danger' {
  if (condition === 'good') return 'success';
  if (condition === 'minor_damage' || condition === 'unknown') return 'warning';
  return 'danger';
}

function selectionFrom(activeLabId: string, filters: FilterState): AssetQrLabelSelection {
  const selection: AssetQrLabelSelection = {};
  if (activeLabId) selection.laboratoryId = activeLabId;
  if (filters.category.trim()) selection.category = filters.category.trim();
  if (filters.condition !== 'all') selection.condition = filters.condition;
  if (filters.lifecycleStatus !== 'all') selection.lifecycleStatus = filters.lifecycleStatus;
  if (filters.linkStatus !== 'all') selection.linkStatus = filters.linkStatus;
  if (filters.qrStatus !== 'all') selection.qrStatus = filters.qrStatus;
  if (filters.printedStatus !== 'all') selection.printedStatus = filters.printedStatus;
  if (filters.search.trim()) selection.search = filters.search.trim();
  return selection;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

export function AssetQrLabelsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const activeLabId = useUIStore((state) => state.activeLabId);
  const setActiveLab = useUIStore((state) => state.setActiveLab);
  const canManageQr = hasServerPermission(user, 'assets.manage-qr');

  const [labs, setLabs] = useState<LaboratoryDto[]>([]);
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState<AssetQrLabelCandidate[]>([]);
  const [candidateMeta, setCandidateMeta] = useState({ page: 1, perPage: 50, total: 0, lastPage: 1 });
  const [candidateLoading, setCandidateLoading] = useState(true);
  const [candidateError, setCandidateError] = useState('');
  const [selected, setSelected] = useState<Map<string, AssetQrLabelCandidate>>(new Map());
  const [templateKey, setTemplateKey] = useState<AssetQrLabelTemplate>('50x30');
  const [generating, setGenerating] = useState(false);
  const [generatedBatch, setGeneratedBatch] = useState<AssetQrLabelBatch | null>(null);
  const [batches, setBatches] = useState<AssetQrLabelBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const candidateFilters = useMemo(() => ({
    ...selectionFrom(activeLabId, appliedFilters),
    page,
    perPage: 50,
  }), [activeLabId, appliedFilters, page]);

  useEffect(() => {
    void laboratoryGateway.list()
      .then((nextLabs) => setLabs(nextLabs))
      .catch((error) => toast(errorMessage(error), 'error'));
  }, []);

  useEffect(() => {
    setPage(1);
    setSelected(new Map());
  }, [activeLabId]);

  useEffect(() => {
    let cancelled = false;
    setCandidateLoading(true);
    setCandidateError('');
    void assetQrGateway.candidates(candidateFilters)
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.data);
        setCandidateMeta(result.meta);
      })
      .catch((error) => {
        if (cancelled) return;
        setCandidateError(errorMessage(error));
        setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setCandidateLoading(false);
      });
    return () => { cancelled = true; };
  }, [candidateFilters, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    setBatchLoading(true);
    void assetQrGateway.listBatches({
      ...(activeLabId ? { laboratoryId: activeLabId } : {}),
      page: 1,
      perPage: 10,
    })
      .then((result) => {
        if (!cancelled) setBatches(result.data);
      })
      .catch((error) => {
        if (!cancelled) toast(errorMessage(error), 'error');
      })
      .finally(() => {
        if (!cancelled) setBatchLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeLabId, refreshKey]);

  const selectedItems = useMemo(
    () => Array.from(selected.values()).sort((a, b) => a.assetCode.localeCompare(b.assetCode) || a.id.localeCompare(b.id)),
    [selected],
  );
  const allPageSelected = candidates.length > 0 && candidates.every((candidate) => selected.has(candidate.id));
  const missingQrCount = selectedItems.filter((candidate) => candidate.qr.status === 'missing').length;

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
    setPage(1);
    setSelected(new Map());
    setGeneratedBatch(null);
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    setSelected(new Map());
    setGeneratedBatch(null);
  }

  function toggleCandidate(candidate: AssetQrLabelCandidate) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.set(candidate.id, candidate);
      return next;
    });
  }

  function toggleCurrentPage() {
    setSelected((current) => {
      const next = new Map(current);
      if (allPageSelected) candidates.forEach((candidate) => next.delete(candidate.id));
      else candidates.forEach((candidate) => next.set(candidate.id, candidate));
      return next;
    });
  }

  async function generateBatch() {
    if (!canManageQr) {
      toast('Generate batch membutuhkan permission assets.manage-qr karena QR yang belum ada dapat diterbitkan atomik.', 'error');
      return;
    }
    if (selectedItems.length === 0) {
      toast('Pilih minimal satu Asset.', 'error');
      return;
    }

    setGenerating(true);
    try {
      const batch = await assetQrGateway.generateBatch({
        templateKey,
        assetIds: selectedItems.map((candidate) => candidate.id),
        selection: selectionFrom(activeLabId, appliedFilters),
      });
      setGeneratedBatch(batch);
      setSelected(new Map());
      setRefreshKey((value) => value + 1);
      toast(`Batch ${batch.assetCount} label berhasil dibekukan sebagai evidence.`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function openBatch(batchId: string) {
    try {
      setGeneratedBatch(await assetQrGateway.showBatch(batchId));
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset QR & Label Batch"
        description="Pilih exact Asset dari authority server, bekukan snapshot label, lalu render output fisik pada tranche PDF berikutnya."
        icon={<QrCode className="h-5 w-5" />}
        actions={
          <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/assets')}>
            Kembali ke Asset
          </Button>
        }
      />

      <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
        Preview di halaman ini <strong>bukan QR final untuk dicetak atau dipindai</strong>. QR high-error-correction, BP-logo composition, A4 PDF, dan physical phone scan UAT tetap gate S5.6.3/S5.6.4.
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink-primary">1. Filter kandidat</h2>
              <p className="text-xs text-ink-muted">Laboratorium mengikuti Global Laboratory Context. Mengganti Lab atau menerapkan filter baru mengosongkan selection agar snapshot tidak ambigu.</p>
            </div>
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setRefreshKey((value) => value + 1)}>
              Refresh
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Select
              label="Laboratorium"
              value={activeLabId || 'all'}
              onChange={(event) => setActiveLab(event.target.value === 'all' ? '' : event.target.value)}
              options={[
                { value: 'all', label: 'Semua Laboratorium' },
                ...labs.filter((lab) => lab.status === 'active').map((lab) => ({ value: lab.id, label: `${lab.code} · ${lab.name}` })),
              ]}
            />
            <Input
              label="Search"
              icon={<Search className="h-4 w-4" />}
              value={draftFilters.search}
              placeholder="Kode / nama / kategori..."
              onChange={(event) => setDraftFilters((current) => ({ ...current, search: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
            />
            <Input
              label="Kategori exact"
              value={draftFilters.category}
              placeholder="mis. Komputer"
              onChange={(event) => setDraftFilters((current) => ({ ...current, category: event.target.value }))}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
            />
            <Select
              label="Kondisi"
              value={draftFilters.condition}
              onChange={(event) => setDraftFilters((current) => ({ ...current, condition: event.target.value as FilterState['condition'] }))}
              options={[{ value: 'all', label: 'Semua' }, ...Object.entries(CONDITION_LABELS).map(([value, label]) => ({ value, label }))]}
            />
            <Select
              label="Lifecycle"
              value={draftFilters.lifecycleStatus}
              onChange={(event) => setDraftFilters((current) => ({ ...current, lifecycleStatus: event.target.value as FilterState['lifecycleStatus'] }))}
              options={[{ value: 'all', label: 'Semua' }, ...Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label }))]}
            />
            <Select
              label="Device"
              value={draftFilters.linkStatus}
              onChange={(event) => setDraftFilters((current) => ({ ...current, linkStatus: event.target.value as FilterState['linkStatus'] }))}
              options={[{ value: 'all', label: 'Semua' }, { value: 'linked', label: 'Tertaut Device' }, { value: 'unlinked', label: 'Tidak tertaut' }]}
            />
            <Select
              label="QR"
              value={draftFilters.qrStatus}
              onChange={(event) => setDraftFilters((current) => ({ ...current, qrStatus: event.target.value as FilterState['qrStatus'] }))}
              options={[{ value: 'all', label: 'Semua' }, { value: 'active', label: 'QR aktif' }, { value: 'missing', label: 'Belum punya QR' }]}
            />
            <Select
              label="Riwayat label"
              value={draftFilters.printedStatus}
              onChange={(event) => setDraftFilters((current) => ({ ...current, printedStatus: event.target.value as FilterState['printedStatus'] }))}
              options={[{ value: 'all', label: 'Semua' }, { value: 'printed', label: 'Pernah dibatch' }, { value: 'unprinted', label: 'Belum pernah dibatch' }]}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Filter className="h-4 w-4" />} onClick={applyFilters}>Terapkan Filter</Button>
            <Button size="sm" variant="secondary" onClick={resetFilters}>Reset</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink-primary">2. Pilih exact Asset</h2>
              <p className="text-xs text-ink-muted">{candidateMeta.total} kandidat · {selectedItems.length} dipilih{missingQrCount > 0 ? ` · ${missingQrCount} QR akan diterbitkan atomik saat generate` : ''}</p>
            </div>
            <div className="flex items-end gap-2">
              <Select
                label="Template"
                value={templateKey}
                onChange={(event) => setTemplateKey(event.target.value as AssetQrLabelTemplate)}
                options={ASSET_QR_LABEL_TEMPLATES.map((value) => ({ value, label: TEMPLATE_LABELS[value] }))}
              />
              <Button loading={generating} disabled={selectedItems.length === 0 || !canManageQr} onClick={() => void generateBatch()}>
                Generate Batch
              </Button>
            </div>
          </div>

          {!canManageQr && (
            <div className="rounded-lg border border-base-600 bg-base-800/60 px-3 py-2 text-xs text-ink-muted">
              Akun ini dapat melihat candidate/batch tetapi tidak dapat generate karena tidak memiliki <code>assets.manage-qr</code>.
            </div>
          )}

          {candidateError ? (
            <div className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
              {candidateError}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-base-700/70">
              <table className="w-full text-sm">
                <thead className="bg-base-800/80 text-left text-ink-secondary">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <input type="checkbox" aria-label="Pilih semua kandidat di halaman ini" checked={allPageSelected} onChange={toggleCurrentPage} />
                    </th>
                    <th className="px-4 py-3">Asset</th>
                    <th className="px-4 py-3">Lab</th>
                    <th className="px-4 py-3">Kondisi</th>
                    <th className="px-4 py-3">Lifecycle</th>
                    <th className="px-4 py-3">Device</th>
                    <th className="px-4 py-3">QR</th>
                    <th className="px-4 py-3">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {candidateLoading ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-muted">Memuat kandidat canonical...</td></tr>
                  ) : candidates.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-muted">Tidak ada Asset yang sesuai filter.</td></tr>
                  ) : candidates.map((candidate) => (
                    <tr key={candidate.id} className="border-t border-base-700/50">
                      <td className="px-4 py-3">
                        <input type="checkbox" aria-label={`Pilih ${candidate.assetCode}`} checked={selected.has(candidate.id)} onChange={() => toggleCandidate(candidate)} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink-primary">{candidate.assetCode}</div>
                        <div className="text-xs text-ink-muted">{candidate.name} · {candidate.category}</div>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{candidate.laboratory ? `${candidate.laboratory.code} · ${candidate.laboratory.name}` : 'Belum ditetapkan'}</td>
                      <td className="px-4 py-3"><Badge tone={conditionTone(candidate.condition)}>{CONDITION_LABELS[candidate.condition]}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={candidate.lifecycleStatus === 'active' ? 'success' : 'muted'}>{LIFECYCLE_LABELS[candidate.lifecycleStatus]}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={candidate.linked ? 'accent' : 'muted'}>{candidate.linked ? 'Tertaut' : 'Tidak'}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={candidate.qr.status === 'active' ? 'success' : 'warning'}>{candidate.qr.status === 'active' ? `Aktif v${candidate.qr.tokenVersion}` : 'Belum ada'}</Badge></td>
                      <td className="px-4 py-3"><Badge tone={candidate.qr.printed ? 'accent' : 'muted'}>{candidate.qr.printed ? 'Pernah dibatch' : 'Belum'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>Halaman {candidateMeta.page} / {candidateMeta.lastPage}</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label="Halaman kandidat sebelumnya" disabled={page <= 1 || candidateLoading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label="Halaman kandidat berikutnya" disabled={page >= candidateMeta.lastPage || candidateLoading} onClick={() => setPage((value) => Math.min(candidateMeta.lastPage, value + 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-semibold text-ink-primary">3. Preview snapshot label</h2>
            <p className="text-xs text-ink-muted">
              {generatedBatch
                ? `Batch ${generatedBatch.id} · immutable snapshot ${generatedBatch.assetCount} Asset · ${TEMPLATE_LABELS[generatedBatch.templateKey]}`
                : selectedItems.length > 0
                  ? `Draft preview ${selectedItems.length} Asset terpilih. Public QR identifier baru tersedia setelah server membekukan batch.`
                  : 'Pilih Asset untuk draft preview, atau buka batch historis di bawah.'}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {generatedBatch?.items?.map((item) => (
              <LabelPreview
                key={`${generatedBatch.id}-${item.ordinal}`}
                templateKey={generatedBatch.templateKey}
                assetCode={item.assetCode}
                assetName={item.assetName}
                lab={item.laboratory?.code ?? null}
                publicId={item.publicId}
                frozen
              />
            ))}
            {!generatedBatch && selectedItems.slice(0, 12).map((candidate) => (
              <LabelPreview
                key={candidate.id}
                templateKey={templateKey}
                assetCode={candidate.assetCode}
                assetName={candidate.name}
                lab={candidate.laboratory?.code ?? null}
                publicId={null}
                frozen={false}
              />
            ))}
          </div>
          {!generatedBatch && selectedItems.length > 12 && <p className="text-xs text-ink-muted">Preview dibatasi 12 label; seluruh exact selection tetap dikirim ke server saat Generate Batch.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent-content" />
            <h2 className="font-semibold text-ink-primary">Immutable batch history</h2>
          </div>
          <p className="text-xs text-ink-muted">History read-only pada tranche ini. Event reprint baru akan diekspos bersama pipeline render/print nyata agar audit tidak mencatat aksi yang belum terjadi.</p>
          {batchLoading ? <p className="text-sm text-ink-muted">Memuat batch...</p> : batches.length === 0 ? <p className="text-sm text-ink-muted">Belum ada batch pada scope ini.</p> : (
            <div className="overflow-x-auto rounded-xl border border-base-700/70">
              <table className="w-full text-sm">
                <thead className="bg-base-800/80 text-left text-ink-secondary"><tr><th className="px-4 py-3">Waktu</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">Asset</th><th className="px-4 py-3">Generator</th><th className="px-4 py-3">Aksi</th></tr></thead>
                <tbody>{batches.map((batch) => (
                  <tr key={batch.id} className="border-t border-base-700/50">
                    <td className="px-4 py-3 text-ink-secondary">{formatDateTime(batch.generatedAt)}</td>
                    <td className="px-4 py-3">{TEMPLATE_LABELS[batch.templateKey]}</td>
                    <td className="px-4 py-3">{batch.assetCount}</td>
                    <td className="px-4 py-3 text-ink-secondary">{batch.generatedByName}</td>
                    <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => void openBatch(batch.id)}>Lihat Snapshot</Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LabelPreview({ templateKey, assetCode, assetName, lab, publicId, frozen }: {
  templateKey: AssetQrLabelTemplate;
  assetCode: string;
  assetName: string;
  lab: string | null;
  publicId: string | null;
  frozen: boolean;
}) {
  return (
    <div className={`w-full ${TEMPLATE_PREVIEW[templateKey]} rounded-lg border border-base-500 bg-white p-2 text-slate-950 shadow-sm`}>
      <div className="grid h-full grid-cols-[34%_1fr] gap-2">
        <div className="flex min-w-0 flex-col items-center justify-center rounded border-2 border-slate-900 bg-white p-1 text-center">
          <QrCode className="h-10 w-10" />
          <span className="mt-1 max-w-full truncate text-[8px] font-semibold">{publicId ? publicId.slice(0, 13) : 'QR SETELAH GENERATE'}</span>
          <span className="text-[7px] text-slate-500">preview only</span>
        </div>
        <div className="flex min-w-0 flex-col justify-between py-0.5">
          <div>
            <div className="text-[9px] font-black tracking-wide">SMARTLAB · BP</div>
            <div className="mt-1 truncate text-sm font-black">{assetCode}</div>
            <div className="line-clamp-2 text-[10px] font-semibold leading-tight">{assetName}</div>
          </div>
          <div className="flex items-end justify-between gap-2 text-[8px]">
            <span>{lab ?? 'NO HOME LAB'}</span>
            <span className="font-semibold">{frozen ? 'FROZEN' : 'DRAFT'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
