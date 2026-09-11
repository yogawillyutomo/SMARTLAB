<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssetQrLabelCandidateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $identity = $this->qrIdentities->first();
        $laboratory = $this->homeLaboratory;

        return [
            'id' => $this->id,
            'assetCode' => $this->asset_code,
            'name' => $this->name,
            'category' => $this->category,
            'condition' => $this->condition,
            'lifecycleStatus' => $this->lifecycle_status,
            'linked' => $this->linked_device_id !== null,
            'laboratory' => $laboratory === null ? null : [
                'id' => $laboratory->id,
                'code' => $laboratory->code,
                'name' => $laboratory->name,
            ],
            'qr' => [
                'status' => $identity === null ? 'missing' : 'active',
                'tokenVersion' => $identity?->token_version,
                'printed' => $identity === null
                    ? false
                    : ((int) ($identity->label_batch_items_count ?? 0)) > 0,
            ],
        ];
    }
}
