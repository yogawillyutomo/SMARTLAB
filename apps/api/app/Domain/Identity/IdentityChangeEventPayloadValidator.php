<?php

namespace App\Domain\Identity;

use InvalidArgumentException;

final class IdentityChangeEventPayloadValidator
{
    private const UPDATE_FIELDS = [
        'name',
        'email',
        'nip',
        'nis',
        'phone',
        'userStatus',
        'membershipStatus',
        'roleKeys',
    ];

    /** @param array<string, mixed> $payload */
    public function validate(string $eventType, array $payload): void
    {
        if (! in_array($eventType, IdentityChangeEventType::ALL, true)) {
            throw new InvalidArgumentException('Unsupported identity change event type.');
        }

        if ($eventType === IdentityChangeEventType::MembershipCreated) {
            $this->validateCreated($payload);

            return;
        }

        $this->validateUpdated($payload);
    }

    /** @param array<string, mixed> $payload */
    private function validateCreated(array $payload): void
    {
        $this->assertExactKeys($payload, ['userStatus', 'membershipStatus', 'roleKeys']);
        $this->assertStatus($payload['userStatus'] ?? null);
        $this->assertStatus($payload['membershipStatus'] ?? null);
        $this->assertRoleKeys($payload['roleKeys'] ?? null);
    }

    /** @param array<string, mixed> $payload */
    private function validateUpdated(array $payload): void
    {
        $this->assertExactKeys($payload, ['before', 'after']);

        $before = $payload['before'] ?? null;
        $after = $payload['after'] ?? null;

        if (! is_array($before) || ! is_array($after) || $before === [] || $after === []) {
            throw new InvalidArgumentException('Identity update audit payload requires non-empty before and after maps.');
        }

        if (array_keys($before) !== array_keys($after)) {
            throw new InvalidArgumentException('Identity update audit before/after keys must match exactly.');
        }

        foreach (array_keys($before) as $field) {
            if (! is_string($field) || ! in_array($field, self::UPDATE_FIELDS, true)) {
                throw new InvalidArgumentException('Identity update audit payload contains an unsupported field.');
            }

            if ($field === 'userStatus' || $field === 'membershipStatus') {
                $this->assertStatus($before[$field]);
                $this->assertStatus($after[$field]);
            }

            if ($field === 'roleKeys') {
                $this->assertRoleKeys($before[$field]);
                $this->assertRoleKeys($after[$field]);
            }
        }
    }

    /** @param array<string, mixed> $payload */
    private function assertExactKeys(array $payload, array $expected): void
    {
        $actual = array_keys($payload);
        sort($actual);
        sort($expected);

        if ($actual !== $expected) {
            throw new InvalidArgumentException('Identity change audit payload shape is invalid.');
        }
    }

    private function assertStatus(mixed $value): void
    {
        if (! is_string($value) || ! in_array($value, IdentityCatalog::STATUSES, true)) {
            throw new InvalidArgumentException('Identity change audit status is invalid.');
        }
    }

    private function assertRoleKeys(mixed $value): void
    {
        if (! is_array($value) || $value === []) {
            throw new InvalidArgumentException('Identity change audit role keys are invalid.');
        }

        $keys = array_values($value);
        $sorted = $keys;
        sort($sorted);

        if ($keys !== $sorted || count(array_unique($keys)) !== count($keys)) {
            throw new InvalidArgumentException('Identity change audit role keys must be unique and sorted.');
        }

        foreach ($keys as $key) {
            if (! is_string($key) || ! in_array($key, IdentityCatalog::roleKeys(), true)) {
                throw new InvalidArgumentException('Identity change audit role key is invalid.');
            }
        }
    }
}
