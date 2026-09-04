<?php

namespace App\Domain\Schedule;

use Illuminate\Support\Carbon;
use Normalizer;

class PublishedTimetableCanonicalizer
{
    /** @param array<string, mixed> $payload */
    public function hash(array $payload): string
    {
        if (isset($payload['publishedAt']) && is_string($payload['publishedAt'])) {
            $payload['publishedAt'] = Carbon::parse($payload['publishedAt'])->utc()->toIso8601String();
        }

        if (isset($payload['entries']) && is_array($payload['entries'])) {
            usort(
                $payload['entries'],
                fn (mixed $left, mixed $right): int => strcmp(
                    (string) ($left['sourceScheduleId'] ?? ''),
                    (string) ($right['sourceScheduleId'] ?? ''),
                ),
            );
        }

        $canonical = $this->normalize($payload);

        return hash(
            'sha256',
            json_encode(
                $canonical,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION,
            ),
        );
    }

    private function normalize(mixed $value): mixed
    {
        if (is_string($value)) {
            $normalized = Normalizer::normalize($value, Normalizer::FORM_C);

            return $normalized === false ? $value : $normalized;
        }

        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->normalize($item), $value);
        }

        ksort($value, SORT_STRING);

        foreach ($value as $key => $item) {
            $value[$key] = $this->normalize($item);
        }

        return $value;
    }
}
