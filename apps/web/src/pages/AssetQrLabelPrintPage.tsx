import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileDown, Printer, RefreshCw, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { AssetQrCode } from '@/components/asset/AssetQrCode';
import { AssetQrPrintSheet, assetQrLabelsPerA4 } from '@/components/asset/AssetQrPrintSheet';
import { PageHeader } from '@/components/common/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { ApiClientError } from '@/lib/apiClient';
import { downloadAssetQrLabelPdf } from '@/lib/assetQrPdf';
import { assetQrGateway, type AssetQrLabelBatch } from '@/services/assetQrApi';
import { toast } from '@/stores/toastStore';

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Batch label tidak dapat diproses.';
}

export function AssetQrLabelPrintPage() {
  const navigate = useNavigate();
  const { batchId = '' } = useParams();
  const [batch, setBatch] = useState<AssetQrLabelBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [reprinting, setReprinting] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setBatch(await assetQrGateway.showBatch(batchId));
    } catch (nextError) {
      setBatch(null);
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [batchId]);

  const pageCount = useMemo(() => {
    if (!batch) return 0;
    return Math.ceil(batch.assetCount / assetQrLabelsPerA4(batch.templateKey));
  }, [batch]);

  function ensurePrintableBatch(): AssetQrLabelBatch | null {
    if (!batch?.items?.length || batch.items.length !== batch.assetCount) {
      toast('Immutable label snapshot belum lengkap.', 'error');
      return null;
    }
    return batch;
  }

  function downloadGeneratedBatch() {
    const printableBatch = ensurePrintableBatch();
    if (!printableBatch) return;
    try {
      downloadAssetQrLabelPdf(printableBatch);
      toast('PDF A4 dibuat lokal dari immutable batch snapshot.', 'success');
    } catch (nextError) {
      toast(errorMessage(nextError), 'error');
    }
  }

  function printGeneratedBatch() {
    if (!ensurePrintableBatch()) return;
    window.print();
  }

  async function requestReprint() {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      toast('Alasan reprint minimal 3 karakter.', 'error');
      return;
    }
    setReprinting(true);
    try {
      const refreshed = await assetQrGateway.reprintBatch(batchId, trimmedReason);
      setBatch(refreshed);
      setReason('');
      toast('Permintaan reprint dicatat sebagai append-only evidence. Dialog cetak akan dibuka.', 'success');
      window.print();
    } catch (nextError) {
      toast(errorMessage(nextError), 'error');
    } finally {
      setReprinting(false);
    }
  }

  if (loading) {
    return <Card><CardContent><p className="text-sm text-ink-muted">Memuat immutable label batch...</p></CardContent></Card>;
  }
  if (error || !batch) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <p className="font-semibold text-danger">Batch label tidak dapat dibuka</p>
          <p className="text-sm text-ink-muted">{error || 'Batch tidak tersedia.'}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void load()} icon={<RefreshCw className="h-4 w-4" />}>Coba Lagi</Button>
            <Button size="sm" variant="secondary" onClick={() => navigate('/assets/qr-labels')}>Kembali</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="A4 Asset QR Labels"
        description="Render lokal dari immutable batch snapshot. Unduh PDF A4 deterministik atau gunakan dialog cetak browser untuk printer fisik."
        icon={<Printer className="h-5 w-5" />}
        actions={
          <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/assets/qr-labels')}>
            Kembali ke Label Batch
          </Button>
        }
      />

      <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
        File PDF atau dialog cetak yang terbuka <strong>bukan bukti printer fisik berhasil mencetak</strong>. Physical print + phone scan tetap harus dibuktikan pada UAT. Saat mencetak, pilih skala 100% / Actual Size dan jangan aktifkan fit-to-page.
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap gap-2">
                <Badge tone="accent">{batch.templateKey.replace('x', ' × ')} mm</Badge>
                <Badge tone="success">ECC H</Badge>
                <Badge tone="neutral">{batch.assetCount} label</Badge>
                <Badge tone="neutral">{pageCount} halaman A4</Badge>
              </div>
              <p className="text-xs text-ink-muted">Batch {batch.id} · {batch.generatedByName}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<FileDown className="h-4 w-4" />} onClick={downloadGeneratedBatch}>
                Download PDF
              </Button>
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={printGeneratedBatch}>
                Print
              </Button>
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            QR dan PDF dibentuk sepenuhnya di browser dari immutable batch snapshot. Tidak ada request QR ke CDN atau layanan pihak ketiga.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent-content" />
            <h2 className="font-semibold text-ink-primary">Explicit reprint evidence</h2>
          </div>
          <p className="text-xs text-ink-muted">
            Gunakan ini hanya untuk cetak ulang batch lama. Server akan revalidate Asset + QR snapshot dahulu; batch stale gagal tertutup dan tidak dicetak diam-diam.
          </p>
          <Textarea
            label="Alasan reprint"
            value={reason}
            placeholder="Contoh: label rusak saat pemasangan"
            onChange={(event) => setReason(event.target.value)}
          />
          <Button variant="secondary" loading={reprinting} icon={<Printer className="h-4 w-4" />} onClick={() => void requestReprint()}>
            Catat Reprint & Buka Dialog Cetak
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          <div>
            <h2 className="font-semibold text-ink-primary">Preview label aktual</h2>
            <p className="text-xs text-ink-muted">Menampilkan maksimal 12 dari immutable snapshot. QR di bawah adalah QR aktual yang juga dipakai pada lembar A4 dan PDF download.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(batch.items ?? []).slice(0, 12).map((item) => (
              <div key={item.ordinal} className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 rounded-xl border border-base-600 bg-white p-3 text-slate-950">
                <AssetQrCode publicId={item.publicId} className="h-auto w-full" showBpMark />
                <div className="min-w-0 self-center">
                  <p className="text-xs font-black tracking-wide">SMARTLAB · BP</p>
                  <p className="mt-1 truncate text-base font-black">{item.assetCode}</p>
                  <p className="line-clamp-2 text-xs font-semibold">{item.assetName}</p>
                  <p className="mt-2 text-[10px] font-semibold">{item.laboratory?.code ?? 'NO HOME LAB'}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <AssetQrPrintSheet batch={batch} />
    </div>
  );
}
