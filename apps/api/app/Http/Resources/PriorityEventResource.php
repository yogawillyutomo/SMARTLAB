<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PriorityEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'eventNumber' => $this->event_number,
            'laboratory' => [
                'id' => $this->laboratory_id,
                'code' => $this->laboratory?->code,
                'name' => $this->laboratory?->name,
                'capacity' => $this->laboratory?->capacity,
                'status' => $this->laboratory?->status,
            ],
            'requester' => [
                'userId' => $this->requester_user_id,
                'membershipId' => $this->requester_membership_id,
                'name' => $this->requester_name_snapshot,
                'email' => $this->requester_email_snapshot,
            ],
            'date' => $this->event_date?->format('Y-m-d'),
            'startsAt' => substr((string) $this->starts_at, 0, 8),
            'endsAt' => substr((string) $this->ends_at, 0, 8),
            'category' => $this->category,
            'title' => $this->title,
            'participants' => $this->participants,
            'description' => $this->description,
            'picName' => $this->pic_name,
            'status' => $this->status,
            'rejectionReason' => $this->rejection_reason,
            'version' => $this->version,
            'decidedAt' => $this->decided_at?->toISOString(),
            'cancelledAt' => $this->cancelled_at?->toISOString(),
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
