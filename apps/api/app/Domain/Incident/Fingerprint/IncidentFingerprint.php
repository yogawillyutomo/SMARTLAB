<?php

namespace App\Domain\Incident\Fingerprint;

interface IncidentFingerprint
{
    public function version(): int;

    /** @param array<string, mixed> $payload */
    public function fingerprint(array $payload): string;

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    public function canonicalize(array $payload): array;

    /** @param array<string, mixed> $payload */
    public function canonicalJson(array $payload): string;
}
