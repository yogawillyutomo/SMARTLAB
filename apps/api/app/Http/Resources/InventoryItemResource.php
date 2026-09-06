<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InventoryItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'itemCode' => $this->item_code,
            'name' => $this->name,
            'category' => $this->category,
            'unit' => $this->unit,
            'minimumStock' => (float) $this->minimum_stock,
            'storageLocation' => $this->storage_location,
            'supplierName' => $this->supplier_name,
            'unitPriceSnapshot' => $this->unit_price_snapshot === null ? null : (float) $this->unit_price_snapshot,
            'onHandQuantity' => (float) $this->on_hand_quantity,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
