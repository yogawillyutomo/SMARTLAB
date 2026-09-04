<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterEventPayloadValidator;
use App\Models\AcademicMasterEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

class AcademicMasterEventRecorder
{
    public function __construct(
        private readonly AcademicMasterEventPayloadValidator $payloadValidator,
    ) {}

    /** @param array<string, mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        Model $entity,
        string $entityType,
        string $eventType,
        array $payload,
        int $versionBefore,
        int $versionAfter,
        ?Carbon $createdAt = null,
    ): AcademicMasterEvent {
        $this->payloadValidator->validate($entityType, $eventType, $payload);

        $entityId = (string) $entity->getKey();
        $entityCode = (string) $entity->getAttribute('code');
        if ($entityId === '' || $entityCode === '') {
            throw new \LogicException('Academic Master event target must expose stable id and code attributes.');
        }

        return AcademicMasterEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'entity_type' => $entityType,
            'entity_id_snapshot' => $entityId,
            'entity_code_snapshot' => $entityCode,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'payload' => $payload,
            'entity_version_before' => $versionBefore,
            'entity_version_after' => $versionAfter,
            'created_at' => $createdAt ?? now(),
        ]);
    }
}
