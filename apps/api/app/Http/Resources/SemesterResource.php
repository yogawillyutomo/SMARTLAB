<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SemesterResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'academicYearId' => $this->academic_year_id,
            'code' => $this->code,
            'name' => $this->name,
            'startsOn' => $this->starts_on->format('Y-m-d'),
            'endsOn' => $this->ends_on->format('Y-m-d'),
            'status' => $this->status,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
