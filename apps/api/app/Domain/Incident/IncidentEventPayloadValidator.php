<?php

namespace App\Domain\Incident;

use Illuminate\Support\Str;
use InvalidArgumentException;
use Normalizer;

final class IncidentEventPayloadValidator
{
    private const REOPEN_RESOLUTION_CLEAR_ORDER = ['resolutionSummary', 'resolvedAt'];

    private const REOPEN_VERIFICATION_CLEAR_ORDER = ['verificationNote', 'verifiedAt'];

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    public function validate(IncidentEventType $type, array $payload): array
    {
        $expected = match ($type) {
            IncidentEventType::Reported => [
                'reporter', 'laboratory', 'device', 'category', 'priority', 'title', 'description',
                'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt', 'reportedAt',
            ],
            IncidentEventType::Updated => ['changedFields', 'before', 'after'],
            IncidentEventType::Triaged => ['triageSummary', 'priority', 'impact', 'blocksLaboratoryOperation'],
            IncidentEventType::Assigned => ['assignee', 'reason'],
            IncidentEventType::Reassigned => ['previousAssignee', 'newAssignee', 'reason'],
            IncidentEventType::Started, IncidentEventType::Closed => ['previousStatus', 'newStatus'],
            IncidentEventType::Resolved => ['resolutionSummary'],
            IncidentEventType::Reopened => [
                'previousStatus', 'newStatus', 'reason', 'assigneePresent', 'clearedFields',
                'clearedValues', 'startedAtInitialized', 'startedAt',
            ],
            IncidentEventType::Verified => ['verificationNote'],
            IncidentEventType::Rejected => ['rejectionReason'],
            IncidentEventType::CommentAdded => ['text'],
        };

        $actual = array_keys($payload);
        sort($expected);
        sort($actual);
        if ($actual !== $expected) {
            throw new InvalidArgumentException("Invalid payload shape for {$type->value}.");
        }

        switch ($type) {
            case IncidentEventType::Reported:
                $this->validateReported($payload);
                break;
            case IncidentEventType::Updated:
                $this->validateUpdated($payload);
                break;
            case IncidentEventType::Triaged:
                $this->bounded($payload['triageSummary'], 1, 2000, 'triageSummary');
                IncidentPriority::from((string) $payload['priority']);
                $this->nullableBounded($payload['impact'], 2000, 'impact');
                if (! is_bool($payload['blocksLaboratoryOperation'])) {
                    throw new InvalidArgumentException('blocksLaboratoryOperation must be boolean.');
                }
                break;
            case IncidentEventType::Assigned:
                $this->validateAssignee($payload['assignee'], 'assignee');
                $this->nullableBounded($payload['reason'], 1000, 'reason');
                break;
            case IncidentEventType::Reassigned:
                $this->validateReassignment($payload);
                break;
            case IncidentEventType::Started:
                $this->validateStatuses($payload);
                if ($payload['previousStatus'] !== IncidentStatus::Assigned->value
                    || $payload['newStatus'] !== IncidentStatus::InProgress->value) {
                    throw new InvalidArgumentException('incident.started must be assigned -> in_progress.');
                }
                break;
            case IncidentEventType::Closed:
                $this->validateStatuses($payload);
                if ($payload['previousStatus'] !== IncidentStatus::Verified->value
                    || $payload['newStatus'] !== IncidentStatus::Closed->value) {
                    throw new InvalidArgumentException('incident.closed must be verified -> closed.');
                }
                break;
            case IncidentEventType::Resolved:
                $this->bounded($payload['resolutionSummary'], 5, 4000, 'resolutionSummary');
                break;
            case IncidentEventType::Reopened:
                $this->validateReopened($payload);
                break;
            case IncidentEventType::Verified:
                $this->bounded($payload['verificationNote'], 1, 2000, 'verificationNote');
                break;
            case IncidentEventType::Rejected:
                $this->bounded($payload['rejectionReason'], 5, 1000, 'rejectionReason');
                break;
            case IncidentEventType::CommentAdded:
                $this->bounded($payload['text'], 1, 2000, 'text');
                break;
        }

        return $payload;
    }

    /** @param array<string, mixed> $payload */
    private function validateReported(array $payload): void
    {
        $this->exactObject($payload['reporter'], ['membershipId', 'name', 'userId'], 'reporter');
        $this->exactObject($payload['laboratory'], ['code', 'id', 'name'], 'laboratory');
        if ($payload['device'] !== null) {
            $this->exactObject($payload['device'], ['deviceCode', 'deviceType', 'id'], 'device');
        }
        IncidentCategory::from((string) $payload['category']);
        IncidentPriority::from((string) $payload['priority']);
        $this->bounded($payload['title'], 5, 200, 'title');
        $this->bounded($payload['description'], 10, 4000, 'description');
        $this->nullableBounded($payload['impact'], 2000, 'impact');
        $this->nullableBounded($payload['stepsTaken'], 2000, 'stepsTaken');
        $this->canonicalTimestamp($payload['occurredAt'], 'occurredAt');
        $this->canonicalTimestamp($payload['reportedAt'], 'reportedAt');
        if (! is_bool($payload['blocksLaboratoryOperation'])) {
            throw new InvalidArgumentException('blocksLaboratoryOperation must be boolean.');
        }
    }

    /** @param array<string, mixed> $payload */
    private function validateUpdated(array $payload): void
    {
        if (! is_array($payload['changedFields']) || $payload['changedFields'] === []) {
            throw new InvalidArgumentException('changedFields must be a non-empty list.');
        }
        $fields = array_values($payload['changedFields']);
        $sorted = $fields;
        sort($sorted, SORT_STRING);
        if ($fields !== $sorted || count($fields) !== count(array_unique($fields))) {
            throw new InvalidArgumentException('changedFields must be sorted and unique.');
        }
        if (! is_array($payload['before']) || ! is_array($payload['after'])) {
            throw new InvalidArgumentException('before and after must be objects.');
        }
        $before = array_keys($payload['before']);
        $after = array_keys($payload['after']);
        sort($before);
        sort($after);
        if ($before !== $sorted || $after !== $sorted) {
            throw new InvalidArgumentException('before and after must contain exactly changedFields.');
        }

        foreach ($sorted as $field) {
            if (! in_array($field, IncidentCatalog::UPDATED_FIELDS, true)) {
                throw new InvalidArgumentException("{$field} is not a legal Incident correction field.");
            }
            $this->validateUpdatedField($field, $payload['before'][$field]);
            $this->validateUpdatedField($field, $payload['after'][$field]);
            if ($payload['before'][$field] === $payload['after'][$field]) {
                throw new InvalidArgumentException("{$field} must contain an actual Incident correction.");
            }
        }
    }

    /** @param array<string, mixed> $payload */
    private function validateReassignment(array $payload): void
    {
        $this->validateAssignee($payload['previousAssignee'], 'previousAssignee');
        $this->validateAssignee($payload['newAssignee'], 'newAssignee');
        $this->bounded($payload['reason'], 5, 1000, 'reason');
    }

    /** @param array<string, mixed> $payload */
    private function validateStatuses(array $payload): void
    {
        IncidentStatus::from((string) $payload['previousStatus']);
        IncidentStatus::from((string) $payload['newStatus']);
    }

    /** @param array<string, mixed> $payload */
    private function validateReopened(array $payload): void
    {
        $this->validateStatuses($payload);
        if ($payload['previousStatus'] !== IncidentStatus::Resolved->value) {
            throw new InvalidArgumentException('Reopen must start from resolved.');
        }
        $this->bounded($payload['reason'], 5, 1000, 'reason');
        if (! is_bool($payload['assigneePresent']) || ! is_bool($payload['startedAtInitialized'])) {
            throw new InvalidArgumentException('Reopen flags must be boolean.');
        }
        $expectedStatus = $payload['assigneePresent']
            ? IncidentStatus::InProgress->value
            : IncidentStatus::Triaged->value;
        if ($payload['newStatus'] !== $expectedStatus) {
            throw new InvalidArgumentException('Reopen target must match assignee presence.');
        }
        if (! is_array($payload['clearedFields']) || ! is_array($payload['clearedValues'])) {
            throw new InvalidArgumentException('Reopen cleared-field evidence must be structured.');
        }
        if (! array_is_list($payload['clearedFields'])) {
            throw new InvalidArgumentException('Reopen clearedFields must be a canonical list.');
        }
        $fields = $payload['clearedFields'];
        $withoutVerification = self::REOPEN_RESOLUTION_CLEAR_ORDER;
        $withVerification = [...self::REOPEN_RESOLUTION_CLEAR_ORDER, ...self::REOPEN_VERIFICATION_CLEAR_ORDER];
        if ($fields !== $withoutVerification && $fields !== $withVerification) {
            throw new InvalidArgumentException('Reopen clearedFields must use the canonical resolution and verification order.');
        }
        $values = array_keys($payload['clearedValues']);
        sort($values);
        $sortedFields = $fields;
        sort($sortedFields);
        if ($values !== $sortedFields) {
            throw new InvalidArgumentException('Reopen clearedValues must match clearedFields.');
        }
        $hasVerificationNote = $fields === $withVerification;
        $this->bounded($payload['clearedValues']['resolutionSummary'], 5, 4000, 'resolutionSummary');
        $this->canonicalTimestamp($payload['clearedValues']['resolvedAt'], 'resolvedAt');
        if ($hasVerificationNote) {
            $this->bounded($payload['clearedValues']['verificationNote'], 1, 2000, 'verificationNote');
            $this->canonicalTimestamp($payload['clearedValues']['verifiedAt'], 'verifiedAt');
        }
        if ($payload['startedAtInitialized'] && ! is_string($payload['startedAt'])) {
            throw new InvalidArgumentException('Initialized startedAt evidence is required.');
        }
        if ($payload['startedAtInitialized']) {
            $this->canonicalTimestamp($payload['startedAt'], 'startedAt');
        }
        if (! $payload['startedAtInitialized'] && $payload['startedAt'] !== null) {
            throw new InvalidArgumentException('startedAt must be null when it was not initialized.');
        }
    }

    private function validateAssignee(mixed $value, string $field): void
    {
        $this->exactObject($value, ['membershipId', 'name', 'userId'], $field);
    }

    /** @param list<string> $keys */
    private function exactObject(mixed $value, array $keys, string $field): void
    {
        if (! is_array($value)) {
            throw new InvalidArgumentException("{$field} must be an object.");
        }
        $actual = array_keys($value);
        sort($actual);
        sort($keys);
        if ($actual !== $keys) {
            throw new InvalidArgumentException("{$field} has an invalid shape.");
        }
        foreach ($value as $item) {
            $this->nonBlank($item, $field);
        }
    }

    private function nonBlank(mixed $value, string $field): void
    {
        if (! is_string($value) || trim($value) === '') {
            throw new InvalidArgumentException("{$field} must be a nonblank string.");
        }
    }

    private function bounded(mixed $value, int $min, int $max, string $field): void
    {
        $this->nonBlank($value, $field);
        $length = mb_strlen(trim($value));
        if ($length < $min || $length > $max) {
            throw new InvalidArgumentException("{$field} has an invalid length.");
        }
    }

    private function nullableBounded(mixed $value, int $max, string $field): void
    {
        if ($value !== null) {
            $this->bounded($value, 1, $max, $field);
        }
    }

    private function canonicalTimestamp(mixed $value, string $field): void
    {
        if (! is_string($value)) {
            throw new InvalidArgumentException("{$field} must be a timestamp string.");
        }
        IncidentTimestamp::assertCanonical($value);
    }

    private function validateUpdatedField(string $field, mixed $value): void
    {
        switch ($field) {
            case 'laboratoryId':
                $this->ulid($value, $field);
                break;
            case 'deviceId':
                $this->nullableUlid($value, $field);
                break;
            case 'category':
                IncidentCategory::from((string) $value);
                break;
            case 'priority':
                IncidentPriority::from((string) $value);
                break;
            case 'title':
                $this->canonicalText($value, 5, 200, $field);
                break;
            case 'description':
                $this->canonicalText($value, 10, 4000, $field);
                break;
            case 'impact':
            case 'stepsTaken':
                $this->nullableCanonicalText($value, 2000, $field);
                break;
            case 'blocksLaboratoryOperation':
                $this->boolean($value, $field);
                break;
            case 'occurredAt':
                $this->canonicalTimestamp($value, $field);
                break;
        }
    }

    private function ulid(mixed $value, string $field): void
    {
        if (! is_string($value) || ! Str::isUlid($value) || $value !== strtolower($value)) {
            throw new InvalidArgumentException("{$field} must be a canonical lowercase ULID.");
        }
    }

    private function nullableUlid(mixed $value, string $field): void
    {
        if ($value !== null) {
            $this->ulid($value, $field);
        }
    }

    private function boolean(mixed $value, string $field): void
    {
        if (! is_bool($value)) {
            throw new InvalidArgumentException("{$field} must be boolean.");
        }
    }

    private function canonicalText(mixed $value, int $min, int $max, string $field): void
    {
        if (! is_string($value)) {
            throw new InvalidArgumentException("{$field} must be a string.");
        }

        $canonical = Normalizer::normalize(trim($value), Normalizer::FORM_C);
        if ($canonical === false || $value !== $canonical) {
            throw new InvalidArgumentException("{$field} must be trimmed NFC text.");
        }

        $this->bounded($value, $min, $max, $field);
    }

    private function nullableCanonicalText(mixed $value, int $max, string $field): void
    {
        if ($value !== null) {
            $this->canonicalText($value, 1, $max, $field);
        }
    }
}
