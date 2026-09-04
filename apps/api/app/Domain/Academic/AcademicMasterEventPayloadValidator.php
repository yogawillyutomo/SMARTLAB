<?php

namespace App\Domain\Academic;

use InvalidArgumentException;

class AcademicMasterEventPayloadValidator
{
    /** @param array<string, mixed> $payload */
    public function validate(string $entityType, string $eventType, array $payload): void
    {
        if (! in_array($entityType, AcademicMasterCatalog::ENTITY_TYPES, true)) {
            throw new InvalidArgumentException('Unsupported Academic Master entity type.');
        }
        if (! in_array($eventType, AcademicMasterCatalog::EVENT_TYPES, true)) {
            throw new InvalidArgumentException('Unsupported Academic Master event type.');
        }

        if ($eventType === 'academic_master.created') {
            if (array_keys($payload) !== ['after'] || ! is_array($payload['after']) || $payload['after'] === []) {
                throw new InvalidArgumentException('Academic Master created event requires a non-empty after payload.');
            }

            return;
        }

        if (array_keys($payload) !== ['before', 'after']
            || ! is_array($payload['before'])
            || ! is_array($payload['after'])
            || $payload['before'] === []
            || array_keys($payload['before']) !== array_keys($payload['after'])) {
            throw new InvalidArgumentException('Academic Master mutation event requires matching non-empty before and after payloads.');
        }
    }
}
