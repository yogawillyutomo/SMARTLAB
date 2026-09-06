<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AssetResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'assetCode' => $this->asset_code,
            'name' => $this->name,
            'category' => $this->category,
            'brand' => $this->brand,
            'model' => $this->model,
            'serialNumber' => $this->serial_number,
            'homeLaboratoryId' => $this->home_laboratory_id,
            'condition' => $this->condition,
            'lifecycleStatus' => $this->lifecycle_status,
            'acquisitionDate' => $this->acquisition_date?->format('Y-m-d'),
            'acquisitionYear' => $this->acquisition_year,
            'fundingSource' => $this->funding_source,
            'purchasePrice' => $this->purchase_price === null ? null : (float) $this->purchase_price,
            'supplierName' => $this->supplier_name,
            'warrantyUntil' => $this->warranty_until?->format('Y-m-d'),
            'notes' => $this->notes,
            'linkedDeviceId' => $this->linked_device_id,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
