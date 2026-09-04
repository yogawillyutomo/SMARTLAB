<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AcademicClassResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'code' => $this->code,
            'name' => $this->name,
            'gradeLevel' => $this->grade_level,
            'academicUnitId' => $this->academic_unit_id,
            'homeroomTeacherId' => $this->homeroom_teacher_id,
            'studentCount' => $this->student_count,
            'status' => $this->status,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
