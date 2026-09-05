<?php

namespace App\Application\PriorityEvent;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\PriorityEvent;
use App\Models\PriorityEventEvent;
use App\Models\User;

class PriorityEventEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        PriorityEvent $event,
        string $eventType,
        array $payload,
        int $before,
        int $after,
    ): void {
        PriorityEventEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'priority_event_id' => $event->id,
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
