<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentEventPayloadValidator;
use App\Domain\Incident\IncidentEventType;
use App\Models\Incident;
use App\Models\IncidentEvent;
use DateTimeInterface;
use InvalidArgumentException;

final class IncidentEventRecorder
{
    public function __construct(private readonly IncidentEventPayloadValidator $payloadValidator) {}

    /** @param array<string, mixed> $payload */
    public function record(
        Incident $incident,
        CurrentMembershipContext $context,
        IncidentEventType $type,
        int $versionBefore,
        int $versionAfter,
        array $payload,
        ?DateTimeInterface $createdAt = null,
    ): IncidentEvent {
        if ($versionAfter !== $versionBefore + 1) {
            throw new InvalidArgumentException('Incident event versions must be consecutive.');
        }
        if ($type === IncidentEventType::Reported && ($versionBefore !== 0 || $versionAfter !== 1)) {
            throw new InvalidArgumentException('The reported event must be version 0 -> 1.');
        }
        if ($type !== IncidentEventType::Reported && $versionBefore < 1) {
            throw new InvalidArgumentException('Post-create Incident events must start at version 1 or later.');
        }
        if ((int) $incident->version !== $versionAfter) {
            throw new InvalidArgumentException('Incident event version must match the persisted Incident aggregate version.');
        }

        $context->membership->loadMissing('user');
        $actor = $context->membership->user;

        return IncidentEvent::query()->create([
            'school_id' => $incident->school_id,
            'incident_id' => $incident->id,
            'incident_id_snapshot' => $incident->id,
            'ticket_number_snapshot' => $incident->ticket_number,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $type,
            'incident_version_before' => $versionBefore,
            'incident_version_after' => $versionAfter,
            'payload' => $this->payloadValidator->validate($type, $payload),
            'created_at' => $createdAt ?? now(),
        ]);
    }
}
