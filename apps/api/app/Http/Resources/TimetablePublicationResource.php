<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TimetablePublicationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'sourceSystem' => $this->source_system,
            'sourcePublicationId' => $this->source_publication_id,
            'sourceVersion' => $this->source_version,
            'schemaVersion' => $this->schema_version,
            'academicReferenceSource' => $this->academic_reference_source,
            'sourceSchoolId' => $this->source_school_id,
            'sourceAcademicYearId' => $this->source_academic_year_id,
            'sourceSemesterId' => $this->source_semester_id,
            'academicYearId' => $this->academic_year_id,
            'semesterId' => $this->semester_id,
            'publishedAt' => $this->published_at?->toISOString(),
            'effectiveFrom' => $this->effective_from?->format('Y-m-d'),
            'effectiveTo' => $this->effective_to?->format('Y-m-d'),
            'payloadSha256' => $this->payload_sha256,
            'status' => $this->status,
            'validationSummary' => $this->validation_summary,
            'validatedAt' => $this->validated_at?->toISOString(),
            'activatedAt' => $this->activated_at?->toISOString(),
            'supersededAt' => $this->superseded_at?->toISOString(),
            'supersededById' => $this->superseded_by_id,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
