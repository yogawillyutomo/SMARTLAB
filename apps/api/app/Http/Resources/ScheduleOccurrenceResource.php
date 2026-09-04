<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ScheduleOccurrenceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $snapshots = is_array($this->entry?->source_snapshots)
            ? $this->entry->source_snapshots
            : [];

        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'publicationId' => $this->publication_id,
            'sourcePublicationId' => $this->publication?->source_publication_id,
            'sourceVersion' => $this->publication?->source_version,
            'sourceScheduleId' => $this->entry?->source_schedule_id,
            'occursOn' => $this->occurs_on?->format('Y-m-d'),
            'activityType' => $this->activity_type,
            'teacher' => [
                'id' => $this->teacher_id,
                'code' => $this->snapshot($snapshots, 'teacherCode', $this->teacher?->code),
                'name' => $this->snapshot($snapshots, 'teacherName', $this->teacher?->name),
            ],
            'academicClass' => [
                'id' => $this->academic_class_id,
                'code' => $this->snapshot($snapshots, 'classCode', $this->academicClass?->code),
                'name' => $this->snapshot($snapshots, 'className', $this->academicClass?->name),
            ],
            'subject' => [
                'id' => $this->subject_id,
                'code' => $this->snapshot($snapshots, 'subjectCode', $this->subject?->code),
                'name' => $this->snapshot($snapshots, 'subjectName', $this->subject?->name),
            ],
            'plannedLaboratory' => $this->planned_laboratory_id === null ? null : [
                'id' => $this->planned_laboratory_id,
                'code' => $this->snapshot($snapshots, 'laboratoryCode', $this->plannedLaboratory?->code),
                'name' => $this->snapshot($snapshots, 'laboratoryName', $this->plannedLaboratory?->name),
            ],
            'lessonPeriodSetId' => $this->lesson_period_set_id,
            'startLessonPeriodId' => $this->start_lesson_period_id,
            'endLessonPeriodId' => $this->end_lesson_period_id,
            'startTime' => substr((string) $this->start_time_snapshot, 0, 8),
            'endTime' => substr((string) $this->end_time_snapshot, 0, 8),
            'instructionPeriodCount' => $this->entry?->instruction_period_count,
        ];
    }

    /**
     * @param array<string, mixed> $snapshots
     */
    private function snapshot(array $snapshots, string $key, ?string $fallback): string
    {
        $value = $snapshots[$key] ?? null;

        return is_string($value) && trim($value) !== ''
            ? $value
            : (string) $fallback;
    }
}
