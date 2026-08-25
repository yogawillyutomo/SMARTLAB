<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeviceTransferResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'deviceId' => $this->device_id_snapshot,
            'deviceCode' => $this->device_code_snapshot,
            'sourceLaboratory' => [
                'id' => $this->source_laboratory_id_snapshot,
                'code' => $this->source_laboratory_code_snapshot,
                'name' => $this->source_laboratory_name_snapshot,
            ],
            'destinationLaboratory' => [
                'id' => $this->destination_laboratory_id_snapshot,
                'code' => $this->destination_laboratory_code_snapshot,
                'name' => $this->destination_laboratory_name_snapshot,
            ],
            'reason' => $this->reason,
            'actor' => [
                'id' => $this->actor_user_id_snapshot,
                'name' => $this->actor_name_snapshot,
            ],
            'deviceVersionBefore' => $this->device_version_before,
            'deviceVersionAfter' => $this->device_version_after,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
