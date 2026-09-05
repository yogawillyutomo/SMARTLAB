<?php

namespace App\Application\Calendar;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\OperationalCalendarEvent;
use App\Models\OperationalCalendarEventEvent;
use App\Models\User;

class OperationalCalendarEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(CurrentMembershipContext $context, User $actor, OperationalCalendarEvent $event, string $eventType, array $payload, int $before, int $after): void
    {
        OperationalCalendarEventEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'calendar_event_id' => $event->id,
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
