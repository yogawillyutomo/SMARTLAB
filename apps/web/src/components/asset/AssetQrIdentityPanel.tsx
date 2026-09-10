import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, QrCode, RefreshCw, RotateCcw } from 'lucide-react';
import { AssetQrCode } from '@/components/asset/AssetQrCode';
import { FormDialog } from '@/components/forms/FormDialog';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { ApiClientError } from '@/lib/apiClient';
import { assetQrGateway, type AssetQrIdentity } from '@/services/assetQrApi';
import { toast } from '@/stores/toastStore';

type LifecycleAction = 'rotate' | 'revoke';

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'QR Asset tidak dapat diproses.';
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}

export function countActiveAssetQrIdentities(identities: readonly AssetQrIdentity[]): number {
  return identities.filter((identity) => identity.status === 'active').length;
}

export function currentAssetQrIdentity(identities: readonly AssetQrIdentity[]): AssetQrIdentity | null {
  const active = identities.filter((identity) => identity.status === 'active');
  if (active.length !== 1) return null;
  return active[0];
}

export function AssetQrIdentityPanel({ assetId }: { assetId: string }) {
  const [identities, setIdentities] = useState<AssetQrIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<LifecycleAction | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setIdentities(await assetQrGateway.history(assetId));
    } catch (nextError) {
      setIdentities([]);
      setError(errorMessage(nextError));
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(() => countActiveAssetQrIdentities(identities), [identities]);
  const active = useMemo(() => currentAssetQrIdentity(identities), [identities]);
  const invariantViolation = activeCount > 1;

  async function issue() {
    if (busy || active || invariantViolation) return;
    setBusy(true);
    try {
      await assetQrGateway.issue(assetId);
      toast('QR identity Asset diterbitkan.', 'success');
      await load();
    } catch (nextError) {
      toast(errorMessage(nextError), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openAction(nextAction: LifecycleAction) {
    if (!active || invariantViolation) return;
    setReason('');
    setAction(nextAction);
  }

  async function submitLifecycleAction() {
    if (!active || !action || invariantViolation) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      toast('Alasan minimal 3 karakter.', 'error');
      return;
    }

    setBusy(true);
    try {
      if (action === 'rotate') {
        await assetQrGateway.rotate(assetId, active.tokenVersion, trimmedReason);
        toast('QR Asset dirotasi. Token lama sekarang tidak berlaku.', 'success');
      } else {
        await assetQrGateway.revoke(assetId, active.tokenVersion, trimmedReason);
        toast('QR Asset dicabut. Token publik lama sekarang tidak berlaku.', 'success');
      }
      setAction(null);
      setReason('');
      await load();
    } catch (nextError) {
      toast(errorMessage(nextError), 'error');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <Card><CardContent><p className="text-sm text-ink-muted">Memuat QR identity Asset...</p></CardContent></Card>;
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-accent-content" />
                <h3 className="text-sm font-semibold text-ink-primary">QR identity Asset</h3>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Identity ini milik Asset administratif, bukan Device. Rotate/revoke memakai QR token version sendiri dan tidak mengubah Asset version.
              </p>
            </div>
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void load()}>
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          {invariantViolation && (
            <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              Invariant QR dilanggar: server mengembalikan lebih dari satu identity aktif. Aksi lifecycle dikunci sampai data canonical diperbaiki.
            </div>
          )}

          {!error && !invariantViolation && active ? (
            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
              <div className="rounded-xl bg-white p-3">
                <AssetQrCode publicId={active.publicId} className="h-auto w-full" showBpMark />
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge tone="success">ACTIVE</Badge>
                  <Badge tone="accent">Token v{active.tokenVersion}</Badge>
                </div>
                <p className="text-xs text-ink-muted">Terbit {formatDateTime(active.issuedAt)}</p>
                <p className="text-xs text-ink-muted">Public UUID sengaja tidak ditampilkan sebagai teks. QR di atas adalah identity publik aktif yang sama.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" icon={<RotateCcw className="h-4 w-4" />} onClick={() => openAction('rotate')}>
                    Rotate QR
                  </Button>
                  <Button variant="secondary" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => openAction('revoke')}>
                    Revoke QR
                  </Button>
                </div>
              </div>
            </div>
          ) : !error && !invariantViolation ? (
            <div className="rounded-xl border border-base-700 bg-base-800/40 p-4">
              <p className="text-sm font-medium text-ink-primary">Belum ada QR identity aktif.</p>
              <p className="mt-1 text-xs text-ink-muted">Issue pertama tidak memakai If-Match; server tetap mengunci Asset dan menjamin maksimal satu identity aktif.</p>
              <Button className="mt-3" size="sm" loading={busy} icon={<QrCode className="h-4 w-4" />} onClick={() => void issue()}>
                Issue QR
              </Button>
            </div>
          ) : null}

          {identities.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Riwayat identity</h4>
              <div className="space-y-2">
                {identities.map((identity) => (
                  <div key={identity.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-base-700 px-3 py-2 text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge tone={identity.status === 'active' ? 'success' : 'muted'}>{identity.status.toUpperCase()}</Badge>
                        <span className="font-semibold text-ink-primary">Token v{identity.tokenVersion}</span>
                      </div>
                      <p className="mt-1 text-ink-muted">Terbit {formatDateTime(identity.issuedAt)}</p>
                    </div>
                    {identity.status === 'revoked' && (
                      <div className="max-w-md text-right text-ink-muted">
                        <p>Dicabut {formatDateTime(identity.revokedAt)}</p>
                        <p className="mt-1">{identity.revokedReason ?? '-'}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={Boolean(action)}
        onClose={() => { if (!busy) setAction(null); }}
        title={action === 'rotate' ? 'Rotate QR Asset' : 'Revoke QR Asset'}
        description={active ? `Token v${active.tokenVersion}` : undefined}
        onSubmit={() => void submitLifecycleAction()}
        submitLabel={action === 'rotate' ? 'Rotate' : 'Revoke'}
        loading={busy}
        submitDisabled={reason.trim().length < 3 || !active || invariantViolation}
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-muted">
            {action === 'rotate'
              ? 'Token aktif saat ini akan dicabut dan diganti secara atomik. Sticker lama harus dianggap tidak berlaku.'
              : 'Token aktif akan dicabut tanpa membuat pengganti. Sticker lama tidak akan resolve lagi.'}
          </p>
          <Textarea
            label="Alasan"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={action === 'rotate' ? 'Contoh: sticker lama terekspos atau rusak' : 'Contoh: label dimusnahkan atau Asset tidak lagi memakai QR'}
          />
          <p className="text-xs text-ink-muted">Jika token version sudah stale, server menolak dengan 412 dan panel memuat ulang history canonical.</p>
        </div>
      </FormDialog>
    </>
  );
}
