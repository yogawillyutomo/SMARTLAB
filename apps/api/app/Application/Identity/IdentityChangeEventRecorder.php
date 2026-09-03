<?php

namespace App\Application\Identity;

use App\Domain\Identity\IdentityChangeEventPayloadValidator;
use App\Models\IdentityChangeEvent;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Support\Carbon;

class IdentityChangeEventRecorder
{
    public function __construct(
        private readonly IdentityChangeEventPayloadValidator $payloadValidator,
    ) {}

    /** @param array<string, mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        SchoolMembership $target,
        string $eventType,
        array $payload,
        ?Carbon $createdAt = null,
    ): IdentityChangeEvent {
        $this->payloadValidator->validate($eventType, $payload);
        $target->loadMissing('user:id,name');

        return IdentityChangeEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'target_user_id' => $target->user_id,
            'target_membership_id' => $target->id,
            'target_user_id_snapshot' => $target->user_id,
            'target_membership_id_snapshot' => $target->id,
            'target_name_snapshot' => $target->user->name,
            'event_type' => $eventType,
            'payload' => $payload,
            'created_at' => $createdAt ?? now(),
        ]);
    }
}
