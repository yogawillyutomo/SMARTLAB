<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentAssigneeCandidateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'membershipId' => $this->id,
            'user' => [
                'id' => $this->user_id,
                'name' => $this->user_name,
            ],
        ];
    }
}
