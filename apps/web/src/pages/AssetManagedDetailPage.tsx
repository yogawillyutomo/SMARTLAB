import { useParams } from 'react-router-dom';
import { AssetQrIdentityPanel } from '@/components/asset/AssetQrIdentityPanel';
import { hasServerPermission } from '@/lib/authIdentity';
import { AssetDetailPage } from '@/pages/AssetsPage';
import { useAuthStore } from '@/stores/authStore';

export function AssetManagedDetailPage() {
  const { id } = useParams();
  const user = useAuthStore((state) => state.user);
  const canManageQr = hasServerPermission(user, 'assets.manage-qr');

  return (
    <div className="space-y-6">
      <AssetDetailPage />
      {id && canManageQr ? <AssetQrIdentityPanel assetId={id} /> : null}
    </div>
  );
}
