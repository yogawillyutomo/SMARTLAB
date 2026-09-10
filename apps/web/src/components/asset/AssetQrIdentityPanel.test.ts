import { describe, expect, it } from 'vitest';
import {
  countActiveAssetQrIdentities,
  currentAssetQrIdentity,
} from '@/components/asset/AssetQrIdentityPanel';
import type { AssetQrIdentity } from '@/services/assetQrApi';

function identity(tokenVersion: number, status: AssetQrIdentity['status']): AssetQrIdentity {
  return {
    id: `identity-${tokenVersion}`,
    assetId: 'asset-1',
    publicId: `00000000-0000-4000-8000-${String(tokenVersion).padStart(12, '0')}`,
    tokenVersion,
    status,
    issuedAt: '2026-09-11T00:00:00Z',
    revokedReason: status === 'revoked' ? 'Rotated.' : null,
    revokedAt: status === 'revoked' ? '2026-09-11T01:00:00Z' : null,
  };
}

describe('Asset QR identity lifecycle UI invariant', () => {
  it('accepts no active identity as an issuable state', () => {
    const identities = [identity(1, 'revoked')];

    expect(countActiveAssetQrIdentities(identities)).toBe(0);
    expect(currentAssetQrIdentity(identities)).toBeNull();
  });

  it('selects exactly one active identity for rotate/revoke precondition', () => {
    const active = identity(2, 'active');
    const identities = [active, identity(1, 'revoked')];

    expect(countActiveAssetQrIdentities(identities)).toBe(1);
    expect(currentAssetQrIdentity(identities)).toEqual(active);
  });

  it('fails closed when more than one active identity is returned', () => {
    const identities = [identity(2, 'active'), identity(3, 'active')];

    expect(countActiveAssetQrIdentities(identities)).toBe(2);
    expect(currentAssetQrIdentity(identities)).toBeNull();
  });
});
