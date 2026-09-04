<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LessonPeriodResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'lessonPeriodSetId' => $this->lesson_period_set_id,
            'code' => $this->code,
            'sequence' => $this->sequence,
            'startsAt' => $this->starts_at,
            'endsAt' => $this->ends_at,
            'kind' => $this->kind,
            'status' => $this->status,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
