<?php

namespace App\Domain\Incident\Fingerprint;

use App\Domain\Incident\IncidentCategory;
use App\Domain\Incident\IncidentPriority;
use App\Domain\Incident\IncidentTimestamp;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Normalizer;

final class IncidentFingerprintV1 implements IncidentFingerprint
{
    public const VERSION = 1;

    public const FIELD_ORDER = [
        'laboratoryId',
        'deviceId',
        'category',
        'priority',
        'title',
        'description',
        'impact',
        'blocksLaboratoryOperation',
        'stepsTaken',
        'occurredAt',
    ];

    public function version(): int
    {
        return self::VERSION;
    }

    public function fingerprint(array $payload): string
    {
        return hash('sha256', $this->canonicalJson($payload));
    }

    public function canonicalize(array $payload): array
    {
        foreach (['laboratoryId', 'category', 'title', 'description', 'occurredAt'] as $required) {
            if (! array_key_exists($required, $payload)) {
                throw new InvalidArgumentException("Missing Incident fingerprint field: {$required}");
            }
        }

        $laboratoryId = $this->ulid($payload['laboratoryId'], 'laboratoryId');
        $deviceId = $this->nullableUlid($payload['deviceId'] ?? null, 'deviceId');
        $category = strtolower($this->string($payload['category'], 'category'));
        $priority = strtolower($this->string($payload['priority'] ?? 'normal', 'priority'));

        if (! in_array($category, IncidentCategory::values(), true)) {
            throw new InvalidArgumentException('Invalid Incident category.');
        }
        if (! in_array($priority, IncidentPriority::values(), true)) {
            throw new InvalidArgumentException('Invalid Incident priority.');
        }

        $blocking = $payload['blocksLaboratoryOperation'] ?? false;
        if (! is_bool($blocking)) {
            throw new InvalidArgumentException('blocksLaboratoryOperation must be a boolean.');
        }

        $occurredAt = IncidentTimestamp::canonicalize($this->string($payload['occurredAt'], 'occurredAt'));

        return [
            'laboratoryId' => $laboratoryId,
            'deviceId' => $deviceId,
            'category' => $category,
            'priority' => $priority,
            'title' => $this->string($payload['title'], 'title'),
            'description' => $this->string($payload['description'], 'description'),
            'impact' => $this->nullableString($payload['impact'] ?? null),
            'blocksLaboratoryOperation' => $blocking,
            'stepsTaken' => $this->nullableString($payload['stepsTaken'] ?? null),
            'occurredAt' => $occurredAt,
        ];
    }

    public function canonicalJson(array $payload): string
    {
        return json_encode(
            $this->canonicalize($payload),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
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

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = $this->string($value, 'nullable string');

        return $value === '' ? null : $value;
    }
}
