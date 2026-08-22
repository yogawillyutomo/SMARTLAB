<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeviceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'deviceCode' => $this->device_code,
            'qrPublicId' => $this->qr_public_id,
            'deviceType' => $this->device_type,
            'lifecycleStatus' => $this->lifecycle_status,
            'homeLaboratoryId' => $this->home_laboratory_id,
            'serialNumber' => $this->serial_number,
            'hostname' => $this->hostname,
            'brand' => $this->brand,
            'model' => $this->model,
            'technicalProfileVersion' => $this->technical_profile_version,
            'technicalProfile' => $this->technical_profile === [] ? (object) [] : $this->technical_profile,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
