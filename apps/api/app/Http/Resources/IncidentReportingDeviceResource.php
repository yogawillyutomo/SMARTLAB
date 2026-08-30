<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentReportingDeviceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return ['id' => $this->id, 'deviceCode' => $this->device_code, 'deviceType' => $this->device_type];
    }
}
