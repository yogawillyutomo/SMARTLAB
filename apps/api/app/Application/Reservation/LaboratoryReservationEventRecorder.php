<?php

namespace App\Application\Reservation;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\LaboratoryReservation;
use App\Models\LaboratoryReservationEvent;
use App\Models\User;

class LaboratoryReservationEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        LaboratoryReservation $reservation,
        string $eventType,
        array $payload,
        int $before,
        int $after,
    ): void {
        LaboratoryReservationEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'reservation_id' => $reservation->id,
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
