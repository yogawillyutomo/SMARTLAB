<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LayoutResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            ...(new LayoutSummaryResource($this->resource))->resolve($request),
            'structuralElements' => $this->structuralElements->map(fn ($element) => [
                'id' => $element->id,
                'type' => $element->element_type,
                'label' => $element->label,
                'row' => $element->row,
                'column' => $element->column,
                'rowSpan' => $element->row_span,
                'columnSpan' => $element->column_span,
                'rotation' => $element->rotation,
            ])->values()->all(),
            'devicePlacements' => $this->devicePlacements->map(fn ($placement) => [
                'id' => $placement->id,
                'deviceId' => $placement->device_id,
                'role' => $placement->role,
                'label' => $placement->label,
                'row' => $placement->row,
                'column' => $placement->column,
                'rowSpan' => $placement->row_span,
                'columnSpan' => $placement->column_span,
                'rotation' => $placement->rotation,
            ])->values()->all(),
        ];
    }
}
