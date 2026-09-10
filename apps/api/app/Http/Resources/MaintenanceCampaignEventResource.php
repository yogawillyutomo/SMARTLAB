<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceCampaignEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'campaignId' => $this->maintenance_campaign_id,
            'actorUserIdSnapshot' => $this->actor_user_id_snapshot,
            'actorMembershipIdSnapshot' => $this->actor_membership_id_snapshot,
            'actorNameSnapshot' => $this->actor_name_snapshot,
            'eventType' => $this->event_type,
            'beforeStatus' => $this->before_status,
            'afterStatus' => $this->after_status,
            'payload' => $this->payload,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
