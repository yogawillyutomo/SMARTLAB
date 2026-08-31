<?php

namespace App\Application\Incident;

use App\Domain\Incident\IncidentDomainException;
use App\Models\Incident;

final readonly class IncidentRoutingEvidence
{
    public function __construct(
        public string $laboratoryId,
        public ?string $deviceId,
        public int $version,
    ) {}

    public function assertUnchanged(Incident $incident): void
    {
        if ((int) $incident->version !== $this->version
            || $incident->laboratory_id_snapshot !== $this->laboratoryId
            || $incident->device_id_snapshot !== $this->deviceId) {
            throw IncidentDomainException::versionConflict();
        }
    }
}
