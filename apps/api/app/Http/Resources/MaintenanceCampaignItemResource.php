<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceCampaignItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'assetId' => $this->asset_id,
            'assetCodeSnapshot' => $this->asset_code_snapshot,
            'assetNameSnapshot' => $this->asset_name_snapshot,
            'maintenancePlanId' => $this->maintenance_plan_id,
            'planCodeSnapshot' => $this->plan_code_snapshot,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
