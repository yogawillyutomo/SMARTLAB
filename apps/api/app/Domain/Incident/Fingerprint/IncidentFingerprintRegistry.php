<?php

namespace App\Domain\Incident\Fingerprint;

use InvalidArgumentException;

final class IncidentFingerprintRegistry
{
    /** @var array<int, IncidentFingerprint> */
    private array $algorithms = [];

    /** @param iterable<IncidentFingerprint>|null $algorithms */
    public function __construct(?iterable $algorithms = null)
    {
        $algorithms ??= [new IncidentFingerprintV1];
        foreach ($algorithms as $algorithm) {
            $this->algorithms[$algorithm->version()] = $algorithm;
        }
        ksort($this->algorithms);
    }

    public function current(): IncidentFingerprint
    {
        return $this->algorithms[max(array_keys($this->algorithms))];
    }

    public function forVersion(int $version): IncidentFingerprint
    {
        return $this->algorithms[$version]
            ?? throw new InvalidArgumentException("Unsupported Incident fingerprint version: {$version}");
    }

    /** @return list<int> */
    public function supportedVersions(): array
    {
        return array_keys($this->algorithms);
    }
}
