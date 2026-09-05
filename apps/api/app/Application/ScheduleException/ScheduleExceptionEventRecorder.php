<?php

namespace App\Application\ScheduleException;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\ScheduleException;
use App\Models\ScheduleExceptionEvent;
use App\Models\User;

class ScheduleExceptionEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        ScheduleException $exception,
        string $eventType,
        array $payload,
        int $before,
        int $after,
    ): void {
        ScheduleExceptionEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'schedule_exception_id' => $exception->id,
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
