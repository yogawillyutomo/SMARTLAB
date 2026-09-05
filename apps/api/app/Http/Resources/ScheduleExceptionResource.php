<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ScheduleExceptionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'occurrenceId' => $this->occurrence_id,
            'publicationId' => $this->publication_id,
            'sourcePublicationId' => $this->source_publication_id_snapshot,
            'sourceVersion' => $this->source_version_snapshot,
            'sourceScheduleId' => $this->source_schedule_id_snapshot,
            'occursOn' => $this->occurs_on?->format('Y-m-d'),
            'resolution' => $this->resolution,
            'status' => $this->status,
            'originalLaboratory' => $this->laboratory($this->originalLaboratory),
            'replacementLaboratory' => $this->laboratory($this->replacementLaboratory),
            'reason' => $this->reason,
            'approvedBy' => [
                'userId' => $this->approved_by_user_id,
                'membershipId' => $this->approved_by_membership_id,
                'name' => $this->approved_by_name_snapshot,
            ],
            'version' => $this->version,
            'cancelledAt' => $this->cancelled_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
            'sourceOccurrence' => $this->whenLoaded('occurrence', fn (): array => [
                'id' => $this->occurrence?->id,
                'date' => $this->occurrence?->occurs_on?->format('Y-m-d'),
                'startsAt' => substr((string) $this->occurrence?->start_time_snapshot, 0, 8),
                'endsAt' => substr((string) $this->occurrence?->end_time_snapshot, 0, 8),
                'activityType' => $this->occurrence?->activity_type,
                'teacher' => $this->reference($this->occurrence?->teacher),
                'academicClass' => $this->reference($this->occurrence?->academicClass),
                'subject' => $this->reference($this->occurrence?->subject),
            ]),
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

    private function laboratory($laboratory): ?array
    {
        if ($laboratory === null) {
            return null;
        }

        return [
            'id' => $laboratory->id,
            'code' => $laboratory->code,
            'name' => $laboratory->name,
            'capacity' => $laboratory->capacity,
            'status' => $laboratory->status,
        ];
    }

    private function reference($reference): ?array
    {
        if ($reference === null) {
            return null;
        }

        return [
            'id' => $reference->id,
            'code' => $reference->code,
            'name' => $reference->name,
        ];
    }
}
