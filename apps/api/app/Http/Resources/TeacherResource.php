<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TeacherResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'code' => $this->code,
            'personnelNumber' => $this->personnel_number,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'academicUnitId' => $this->academic_unit_id,
            'membershipId' => $this->membership_id,
            'status' => $this->status,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
