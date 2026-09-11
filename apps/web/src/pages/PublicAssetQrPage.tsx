import { useEffect, useState } from 'react';
import { Building2, FlaskConical, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { APP_BRAND } from '@/config/brand';
import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { assetQrPublicGateway, type PublicAssetQrView } from '@/services/assetQrPublicApi';
import { useAuthStore } from '@/stores/authStore';

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 404) {
    return 'QR Asset tidak ditemukan atau sudah tidak berlaku.';
  }
  if (error instanceof Error) return error.message;
  return 'Informasi QR Asset tidak dapat dimuat.';
}

export function PublicAssetQrPage() {
  const { publicId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const authStatus = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const [data, setData] = useState<PublicAssetQrView | null>(null);
  const [loading, setLoading] = useState(true);
  const [openingDetail, setOpeningDetail] = useState(false);
  const [error, setError] = useState('');
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void assetQrPublicGateway.resolvePublic(publicId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((nextError) => {
        if (!active) return;
        setData(null);
        setError(errorMessage(nextError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [publicId]);

  const authenticated = authStatus === 'authenticated';
  const canViewAsset = authenticated && hasServerPermission(user, 'assets.view');

  async function openCanonicalAsset() {
    if (!canViewAsset || openingDetail) return;
    setOpeningDetail(true);
    setAccessError('');
    try {
      const target = await assetQrPublicGateway.resolveAuthenticated(publicId);
      navigate(`/assets/${target.assetId}`);
    } catch (nextError) {
      if (nextError instanceof ApiClientError && nextError.status === 404) {
        setAccessError('Asset ini tidak tersedia pada konteks sekolah aktif Anda.');
      } else {
        setAccessError(errorMessage(nextError));
      }
    } finally {
      setOpeningDetail(false);
    }
  }

  function goToLogin() {
    navigate('/login', { state: { from: location } });
  }

  return (
    <div className="min-h-screen bg-base-900 px-4 py-8 text-ink-primary sm:px-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-blue to-brand-cyan text-white shadow-elevated">
            <FlaskConical className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{APP_BRAND.name}</h1>
            <p className="text-sm text-ink-muted">Public Asset Verification</p>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-5">
            {loading && <p className="text-sm text-ink-muted">Memuat informasi Asset...</p>}

            {!loading && error && (
              <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger" role="alert">
                {error}
              </div>
            )}

            {!loading && data && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-ink-muted">
                      <Building2 className="h-4 w-4" />
                      <span>{data.school.name}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{data.school.code}</p>
                  </div>
                  <Badge tone="success">QR AKTIF</Badge>
                </div>

                <div className="rounded-xl border border-base-700 bg-base-800/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Asset</p>
                  <p className="mt-1 text-lg font-bold text-ink-primary">{data.asset.name}</p>
                  <p className="text-sm font-semibold text-accent-content">{data.asset.assetCode}</p>

                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-ink-muted">Kategori</dt>
                      <dd className="text-sm font-medium">{data.asset.category}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Kondisi</dt>
                      <dd className="text-sm font-medium">{data.asset.condition}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Lifecycle</dt>
                      <dd className="text-sm font-medium">{data.asset.lifecycleStatus}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-muted">Home Laboratory</dt>
                      <dd className="text-sm font-medium">
                        {data.asset.homeLaboratory
                          ? `${data.asset.homeLaboratory.code} · ${data.asset.homeLaboratory.name}`
                          : 'Belum ditetapkan'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-base-700 bg-base-800/30 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent-content" />
                    <div>
                      <p className="text-sm font-semibold">Informasi publik dibatasi</p>
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        Serial number, harga dan data pengadaan, sumber dana, supplier, catatan internal, spesifikasi Device,
                        peminjam/custody, riwayat Incident/Work Order/Maintenance, serta audit tidak ditampilkan pada halaman publik.
                      </p>
                    </div>
                  </div>
                </div>

                {accessError && (
                  <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                    {accessError}
                  </div>
                )}

                {authStatus === 'bootstrapping' && (
                  <Button className="w-full" disabled icon={<LockKeyhole className="h-4 w-4" />}>
                    Memeriksa akses {APP_BRAND.name}...
                  </Button>
                )}

                {!authenticated && authStatus !== 'bootstrapping' && (
                  <Button className="w-full" onClick={goToLogin} icon={<LogIn className="h-4 w-4" />}>
                    Masuk {APP_BRAND.name} untuk detail lengkap
                  </Button>
                )}

                {canViewAsset && (
                  <Button className="w-full" loading={openingDetail} onClick={() => void openCanonicalAsset()} icon={<LockKeyhole className="h-4 w-4" />}>
                    Buka detail Asset di {APP_BRAND.name}
                  </Button>
                )}

                {authenticated && !canViewAsset && (
                  <div className="rounded-lg border border-base-700 bg-base-800/50 px-3 py-2 text-sm text-ink-muted">
                    Anda sudah login, tetapi akun/konteks sekolah aktif tidak memiliki permission <code>assets.view</code>.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-ink-muted">
          QR publik hanya menjadi pintu masuk ke data Asset yang aman. Login {APP_BRAND.name} tidak menghapus batas SchoolMembership atau RBAC.
        </p>
      </div>
    </div>
  );
}
