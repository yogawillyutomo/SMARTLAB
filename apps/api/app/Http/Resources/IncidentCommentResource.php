<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentCommentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'incidentId' => $this->incident_id_snapshot,
            'actor' => [
                'userId' => $this->actor_user_id_snapshot,
                'name' => $this->actor_name_snapshot,
            ],
            'text' => $this->payload['text'],
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
