<?php

namespace App\Domain\Incident;

use Carbon\CarbonImmutable;
use DateTimeImmutable;
use InvalidArgumentException;

final class IncidentTimestamp
{
    public static function canonicalize(string $value): string
    {
        $value = trim($value);
        if (preg_match(
            '/^(?<local>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d{1,6}))?(?<offset>Z|[+-]\d{2}:\d{2})$/D',
            $value,
            $matches,
        ) !== 1) {
            throw new InvalidArgumentException('Timestamp must be an RFC3339 date-time.');
        }

        if ($matches['offset'] !== 'Z') {
            [$offsetHours, $offsetMinutes] = array_map('intval', explode(':', substr($matches['offset'], 1)));
            if ($offsetHours > 23 || $offsetMinutes > 59) {
                throw new InvalidArgumentException('Timestamp offset is not semantically valid RFC3339.');
            }
        }

        $offset = $matches['offset'] === 'Z' ? '+00:00' : $matches['offset'];
        $fraction = str_pad($matches['fraction'] ?? '', 6, '0');
        $normalized = "{$matches['local']}.{$fraction}{$offset}";
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s.uP', $normalized);
        $errors = DateTimeImmutable::getLastErrors();
        if ($parsed === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $parsed->format('Y-m-d\TH:i:s.uP') !== $normalized) {
            throw new InvalidArgumentException('Timestamp is not semantically valid RFC3339.');
        }

        return CarbonImmutable::instance($parsed)->utc()->format('Y-m-d\TH:i:s.u\Z');
    }

    public static function assertCanonical(string $value): void
    {
        if ($value !== self::canonicalize($value)) {
            throw new InvalidArgumentException('Timestamp must use canonical UTC RFC3339 microsecond format.');
        }
    }
}
