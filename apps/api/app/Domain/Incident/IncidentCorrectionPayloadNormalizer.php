<?php

namespace App\Domain\Incident;

use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Normalizer;

final class IncidentCorrectionPayloadNormalizer
{
    /** @param array<string, mixed> $payload @return array<string, mixed> */
    public function normalize(array $payload, DateTimeInterface $receiptTime): array
    {
        $normalized = [];

        foreach ($payload as $field => $value) {
            $normalized[$field] = match ($field) {
                'laboratoryId' => $this->ulid($value, $field),
                'deviceId' => $this->nullableUlid($value, $field),
                'category' => $this->enum($value, IncidentCategory::values(), $field),
                'priority' => $this->enum($value, IncidentPriority::values(), $field),
                'title' => $this->text($value, 5, 200, $field),
                'description' => $this->text($value, 10, 4000, $field),
                'impact', 'stepsTaken' => $this->nullableText($value, 2000, $field),
                'blocksLaboratoryOperation' => $this->boolean($value, $field),
                'occurredAt' => $this->occurredAt($value, $receiptTime),
                default => throw new InvalidArgumentException("{$field} is not a legal Incident correction field."),
            };
        }

        return $normalized;
    }

    private function ulid(mixed $value, string $field): string
    {
        $value = strtolower($this->string($value, $field));
        if (! Str::isUlid($value)) {
            throw new InvalidArgumentException("{$field} must be a valid ULID.");
        }

        return $value;
    }

    private function nullableUlid(mixed $value, string $field): ?string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return null;
        }

        return $this->ulid($value, $field);
    }

    /** @param list<string> $values */
    private function enum(mixed $value, array $values, string $field): string
    {
        $canonical = strtolower($this->string($value, $field));
        if (! in_array($canonical, $values, true)) {
            throw new InvalidArgumentException("{$field} has an invalid value.");
        }

        return $canonical;
    }

    private function text(mixed $value, int $minimum, int $maximum, string $field): string
    {
        $canonical = $this->string($value, $field);
        $length = mb_strlen($canonical);
        if ($length < $minimum || $length > $maximum) {
            throw new InvalidArgumentException("{$field} has an invalid length.");
        }

        return $canonical;
    }

    private function nullableText(mixed $value, int $maximum, string $field): ?string
    {
        if ($value === null) {
            return null;
        }

        $canonical = $this->string($value, $field);
        if ($canonical === '') {
            return null;
        }
        if (mb_strlen($canonical) > $maximum) {
            throw new InvalidArgumentException("{$field} has an invalid length.");
        }

        return $canonical;
    }

    private function boolean(mixed $value, string $field): bool
    {
        if (! is_bool($value)) {
            throw new InvalidArgumentException("{$field} must be a boolean.");
        }

        return $value;
    }

    private function occurredAt(mixed $value, DateTimeInterface $receiptTime): string
    {
        $canonical = IncidentTimestamp::canonicalize($this->string($value, 'occurredAt'));
        if (CarbonImmutable::parse($canonical)->greaterThan(CarbonImmutable::instance($receiptTime)->utc()->addMinutes(5))) {
            throw new InvalidArgumentException('occurredAt cannot be more than five minutes after server receipt time.');
        }

        return $canonical;
    }

    private function string(mixed $value, string $field): string
    {
        if (! is_string($value)) {
            throw new InvalidArgumentException("{$field} must be a string.");
        }

        $normalized = Normalizer::normalize(trim($value), Normalizer::FORM_C);
        if ($normalized === false) {
            throw new InvalidArgumentException("{$field} could not be normalized.");
        }

        return $normalized;
    }
}
