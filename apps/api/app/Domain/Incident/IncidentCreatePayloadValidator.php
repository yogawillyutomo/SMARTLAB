<?php

namespace App\Domain\Incident;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use InvalidArgumentException;

final class IncidentCreatePayloadValidator
{
    /** @param array<string, mixed> $raw @param array<string, mixed> $normalized */
    public function validate(array $raw, array $normalized, DateTimeInterface $receiptTime): void
    {
        $allowed = [
            'laboratoryId', 'deviceId', 'category', 'priority', 'title', 'description',
            'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt',
        ];
        if (array_diff(array_keys($raw), $allowed) !== []) {
            throw new InvalidArgumentException('Incident create business payload contains unsupported fields.');
        }

        $this->length($normalized['title'], 5, 200, 'title');
        $this->length($normalized['description'], 10, 4000, 'description');
        $this->nullableLength($normalized['impact'], 2000, 'impact');
        $this->nullableLength($normalized['stepsTaken'], 2000, 'stepsTaken');
        IncidentTimestamp::assertCanonical($normalized['occurredAt']);

        $occurredAt = CarbonImmutable::parse($normalized['occurredAt']);
        $receipt = CarbonImmutable::instance($receiptTime)->utc();
        if ($occurredAt->greaterThan($receipt->addMinutes(5))) {
            throw new InvalidArgumentException('occurredAt cannot be more than five minutes after server receipt time.');
        }
    }

    private function length(string $value, int $min, int $max, string $field): void
    {
        $length = mb_strlen($value);
        if ($length < $min || $length > $max) {
            throw new InvalidArgumentException("{$field} has an invalid length.");
        }
    }

    private function nullableLength(?string $value, int $max, string $field): void
    {
        if ($value !== null && mb_strlen($value) > $max) {
            throw new InvalidArgumentException("{$field} has an invalid length.");
        }
    }
}
