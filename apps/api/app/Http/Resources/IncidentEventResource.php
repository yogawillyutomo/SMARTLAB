<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentEventResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'incidentId' => $this->incident_id_snapshot,
            'ticketNumber' => $this->ticket_number_snapshot,
            'actor' => [
                'userId' => $this->actor_user_id_snapshot,
                'membershipId' => $this->actor_membership_id_snapshot,
                'name' => $this->actor_name_snapshot,
            ],
            'eventType' => $this->event_type->value,
            'incidentVersionBefore' => $this->incident_version_before,
            'incidentVersionAfter' => $this->incident_version_after,
            'payload' => $this->payload,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
