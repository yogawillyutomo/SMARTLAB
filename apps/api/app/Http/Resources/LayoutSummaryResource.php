<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LayoutSummaryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'laboratoryId' => $this->laboratory_id,
            'name' => $this->name,
            'templateKey' => $this->template_key,
            'rows' => $this->rows,
            'columns' => $this->columns,
            'status' => $this->status,
            'version' => $this->version,
            'activatedAt' => $this->activated_at?->toISOString(),
            'archivedAt' => $this->archived_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
