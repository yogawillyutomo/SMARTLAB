<?php

namespace App\Application\Asset;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AssetQrIdentityService
{
    /** @return Collection<int,AssetQrIdentity> */
    public function history(CurrentMembershipContext $context, string $assetId): Collection
    {
        $this->asset($context, $assetId);

        return AssetQrIdentity::query()
            ->where('school_id', $context->membership->school_id)
            ->where('asset_id', $assetId)
            ->orderByDesc('token_version')
            ->get();
    }

    public function issue(
        CurrentMembershipContext $context,
        User $actor,
        string $assetId,
    ): AssetQrIdentity {
        return DB::transaction(function () use ($context, $actor, $assetId): AssetQrIdentity {
            $asset = $this->lockAsset($context, $assetId);
            $active = $this->activeForUpdate($asset);

            if ($active !== null) {
                throw new AssetDomainException(
                    'Asset already has an active QR identity.',
                    'ASSET_QR_ALREADY_ACTIVE',
                    409,
                );
            }

            return $this->createIdentity($context, $actor, $asset);
        });
    }

    public function rotate(
        CurrentMembershipContext $context,
        User $actor,
        string $assetId,
        int $expectedTokenVersion,
        string $reason,
    ): AssetQrIdentity {
        return DB::transaction(function () use ($context, $actor, $assetId, $expectedTokenVersion, $reason): AssetQrIdentity {
            $asset = $this->lockAsset($context, $assetId);
            $active = $this->activeForUpdate($asset);

            if ($active === null) {
                throw new AssetDomainException(
                    'Asset has no active QR identity to rotate.',
                    'ASSET_QR_NOT_ACTIVE',
                    409,
                );
            }

            $this->assertTokenVersion($active, $expectedTokenVersion);
            $this->revokeIdentity($context, $actor, $active, $reason);

            return $this->createIdentity($context, $actor, $asset);
        });
    }

    public function revoke(
        CurrentMembershipContext $context,
        User $actor,
        string $assetId,
        int $expectedTokenVersion,
        string $reason,
    ): AssetQrIdentity {
        return DB::transaction(function () use ($context, $actor, $assetId, $expectedTokenVersion, $reason): AssetQrIdentity {
            $asset = $this->lockAsset($context, $assetId);
            $active = $this->activeForUpdate($asset);

            if ($active === null) {
                throw new AssetDomainException(
                    'Asset has no active QR identity to revoke.',
                    'ASSET_QR_NOT_ACTIVE',
                    409,
                );
            }

            $this->assertTokenVersion($active, $expectedTokenVersion);

            return $this->revokeIdentity($context, $actor, $active, $reason);
        });
    }

    public function resolvePublic(string $publicId): AssetQrIdentity
    {
        if (! Str::isUuid($publicId)) {
            throw $this->publicNotFound();
        }

        $identity = AssetQrIdentity::query()
            ->where('public_id', mb_strtolower($publicId))
            ->where('status', 'active')
            ->with([
                'asset.school',
                'asset.homeLaboratory',
            ])
            ->first();

        if ($identity === null || $identity->asset === null) {
            throw $this->publicNotFound();
        }

        return $identity;
    }

    private function asset(CurrentMembershipContext $context, string $assetId): Asset
    {
        $asset = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($assetId)
            ->first();

        if ($asset === null) {
            throw new AssetDomainException('Asset not found.', 'ASSET_NOT_FOUND', 404);
        }

        return $asset;
    }

    private function lockAsset(CurrentMembershipContext $context, string $assetId): Asset
    {
        $asset = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($assetId)
            ->lockForUpdate()
            ->first();

        if ($asset === null) {
            throw new AssetDomainException('Asset not found.', 'ASSET_NOT_FOUND', 404);
        }

        return $asset;
    }

    private function activeForUpdate(Asset $asset): ?AssetQrIdentity
    {
        return AssetQrIdentity::query()
            ->where('school_id', $asset->school_id)
            ->where('asset_id', $asset->id)
            ->where('status', 'active')
            ->lockForUpdate()
            ->first();
    }

    private function createIdentity(
        CurrentMembershipContext $context,
        User $actor,
        Asset $asset,
    ): AssetQrIdentity {
        $lastVersion = (int) AssetQrIdentity::query()
            ->where('school_id', $asset->school_id)
            ->where('asset_id', $asset->id)
            ->max('token_version');

        return AssetQrIdentity::query()->create([
            'school_id' => $asset->school_id,
            'asset_id' => $asset->id,
            'public_id' => (string) Str::uuid(),
            'token_version' => $lastVersion + 1,
            'status' => 'active',
            'issued_by_user_id' => $actor->id,
            'issued_by_membership_id' => $context->membership->id,
            'issued_by_user_id_snapshot' => $actor->id,
            'issued_by_membership_id_snapshot' => $context->membership->id,
            'issued_by_name_snapshot' => $actor->name,
            'issued_at' => now(),
        ])->refresh();
    }

    private function revokeIdentity(
        CurrentMembershipContext $context,
        User $actor,
        AssetQrIdentity $identity,
        string $reason,
    ): AssetQrIdentity {
        $identity->status = 'revoked';
        $identity->revoked_by_user_id = $actor->id;
        $identity->revoked_by_membership_id = $context->membership->id;
        $identity->revoked_by_user_id_snapshot = $actor->id;
        $identity->revoked_by_membership_id_snapshot = $context->membership->id;
        $identity->revoked_by_name_snapshot = $actor->name;
        $identity->revoked_reason = trim($reason);
        $identity->revoked_at = now();
        $identity->save();

        return $identity->refresh();
    }

    private function assertTokenVersion(AssetQrIdentity $identity, int $expectedTokenVersion): void
    {
        if ($identity->token_version !== $expectedTokenVersion) {
            throw new AssetDomainException(
                'Asset QR identity has changed since it was loaded.',
                'ASSET_QR_VERSION_CONFLICT',
                412,
            );
        }
    }

    private function publicNotFound(): AssetDomainException
    {
        return new AssetDomainException('Asset QR not found.', 'ASSET_QR_NOT_FOUND', 404);
    }
}
