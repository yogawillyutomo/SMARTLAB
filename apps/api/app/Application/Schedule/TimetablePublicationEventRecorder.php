<?php

namespace App\Application\Schedule;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\TimetablePublication;
use App\Models\TimetablePublicationEvent;
use App\Models\User;

class TimetablePublicationEventRecorder
{
    /** @param array<string, mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        TimetablePublication $publication,
        string $eventType,
        array $payload = [],
    ): TimetablePublicationEvent {
        return TimetablePublicationEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'publication_id' => $publication->id,
            'source_system' => $publication->source_system,
            'source_publication_id' => $publication->source_publication_id,
            'source_version' => $publication->source_version,
            'payload_sha256' => $publication->payload_sha256,
            'actor_type' => 'user',
            'actor_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }
}
