<?php

namespace App\Application\Incident;

use App\Models\Incident;

final readonly class IncidentCreationResult
{
    public function __construct(
        public Incident $incident,
        public bool $wasExistingSubmission,
    ) {}
}
