<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LaboratorySessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'sessionNumber' => $this->session_number,
            'source' => [
                'type' => $this->source_type,
                'id' => $this->sourceId(),
                'versionEvidence' => $this->source_version_evidence,
                'fingerprint' => $this->source_fingerprint,
                'publicationId' => $this->source_publication_id,
                'evidence' => $this->source_evidence,
                'ownerMembershipId' => $this->source_owner_membership_id,
                'date' => $this->source_date?->format('Y-m-d'),
                'startsAt' => substr((string) $this->source_starts_at, 0, 8),
                'endsAt' => substr((string) $this->source_ends_at, 0, 8),
            ],
            'laboratory' => [
                'id' => $this->laboratory_id,
                'code' => $this->laboratory?->code,
                'name' => $this->laboratory?->name,
                'capacity' => $this->laboratory?->capacity,
                'status' => $this->laboratory?->status,
            ],
            'activityKind' => $this->activity_kind,
            'responsibility' => [
                'teacherId' => $this->responsible_teacher_id,
                'name' => $this->responsible_name_snapshot,
                'teacherCode' => $this->responsibleTeacher?->code,
                'academicClass' => $this->academic_class_id === null ? null : [
                    'id' => $this->academic_class_id,
                    'code' => $this->academicClass?->code,
                    'name' => $this->academicClass?->name,
                    'studentCount' => $this->academicClass?->student_count,
                ],
                'subject' => $this->subject_id === null ? null : [
                    'id' => $this->subject_id,
                    'code' => $this->subject?->code,
                    'name' => $this->subject?->name,
                ],
                'plannedParticipantCount' => $this->planned_participant_count,
            ],
            'status' => $this->status,
            'openingCondition' => $this->opening_condition,
            'closingCondition' => $this->closing_condition,
            'endOutcome' => $this->end_outcome,
            'operationalNotes' => $this->operational_notes,
            'actualStartedAt' => $this->actual_started_at?->toISOString(),
            'actualEndedAt' => $this->actual_ended_at?->toISOString(),
            'cancelledAt' => $this->cancelled_at?->toISOString(),
            'cancellationReason' => $this->cancellation_reason,
            'activityReport' => $this->whenLoaded('activityReport', fn () => $this->activityReport === null ? null : [
                'id' => $this->activityReport->id,
                'reportNumber' => $this->activityReport->report_number,
                'reportType' => $this->activityReport->report_type,
                'status' => $this->activityReport->status,
                'version' => $this->activityReport->version,
            ]),
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
