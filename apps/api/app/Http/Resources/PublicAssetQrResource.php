<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PublicAssetQrResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $asset = $this->asset;
        $school = $asset->school;
        $laboratory = $asset->homeLaboratory;

        return [
            'school' => [
                'code' => $school->code,
                'name' => $school->name,
            ],
            'asset' => [
                'assetCode' => $asset->asset_code,
                'name' => $asset->name,
                'category' => $asset->category,
                'condition' => $asset->condition,
                'lifecycleStatus' => $asset->lifecycle_status,
                'homeLaboratory' => $laboratory === null ? null : [
                    'code' => $laboratory->code,
                    'name' => $laboratory->name,
                ],
            ],
        ];
    }
}
