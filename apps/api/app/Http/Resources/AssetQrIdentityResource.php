<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssetQrIdentityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'assetId' => $this->asset_id,
            'publicId' => $this->public_id,
            'tokenVersion' => $this->token_version,
            'status' => $this->status,
            'issuedAt' => $this->issued_at?->toISOString(),
            'revokedReason' => $this->revoked_reason,
            'revokedAt' => $this->revoked_at?->toISOString(),
        ];
    }
}
