<?php

namespace App\Application\Session;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\LaboratorySession;
use App\Models\LaboratorySessionEvent;
use App\Models\User;

class LaboratorySessionEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        LaboratorySession $session,
        string $eventType,
        array $payload,
        int $before,
        int $after,
    ): void {
        LaboratorySessionEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'session_id' => $session->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'payload' => $payload,
            'entity_version_before' => $before,
            'entity_version_after' => $after,
            'created_at' => now(),
        ]);
    }
}
