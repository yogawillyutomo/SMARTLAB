<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActivityReportResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'reportNumber' => $this->report_number,
            'origin' => $this->origin,
            'sessionId' => $this->session_id,
            'ownerMembershipId' => $this->owner_membership_id,
            'manualBackfillReason' => $this->manual_backfill_reason,
            'reportType' => $this->report_type,
            'status' => $this->status,
            'laboratory' => [
                'id' => $this->laboratory_id,
                'code' => $this->laboratory?->code,
                'name' => $this->laboratory?->name,
                'capacity' => $this->laboratory?->capacity,
                'status' => $this->laboratory?->status,
            ],
            'occurredOn' => $this->occurred_on?->format('Y-m-d'),
            'sourceSnapshot' => $this->source_snapshot,
            'sessionSnapshot' => $this->session_snapshot,
            'responsibility' => [
                'teacherId' => $this->responsible_teacher_id,
                'name' => $this->responsible_name_snapshot,
                'teacherCode' => $this->responsibleTeacher?->code,
                'academicClass' => $this->academic_class_id === null ? null : [
                    'id' => $this->academic_class_id,
                    'code' => $this->academicClass?->code,
                    'name' => $this->academicClass?->name,
                ],
                'subject' => $this->subject_id === null ? null : [
                    'id' => $this->subject_id,
                    'code' => $this->subject?->code,
                    'name' => $this->subject?->name,
                ],
            ],
            'attendance' => [
                'plannedParticipantCount' => $this->planned_participant_count,
                'presentCount' => $this->present_count,
                'absentCount' => $this->absent_count,
                'notes' => $this->attendance_notes,
                'externalSystem' => $this->external_attendance_system,
                'externalReferenceId' => $this->external_attendance_reference_id,
            ],
            'commonContent' => $this->common_content,
            'typeSpecificContent' => $this->type_specific_content,
            'revisionReason' => $this->revision_reason,
            'submittedAt' => $this->submitted_at?->toISOString(),
            'verifiedAt' => $this->verified_at?->toISOString(),
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
            'timeline' => $this->whenLoaded('events', fn () => $this->events->map(fn ($event): array => [
                'eventType' => $event->event_type,
                'actorName' => $event->actor_name_snapshot,
                'at' => $event->created_at?->toISOString(),
                'payload' => $event->payload,
                'versionBefore' => $event->entity_version_before,
                'versionAfter' => $event->entity_version_after,
            ])->values()->all()),
        ];
    }
}
