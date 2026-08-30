<?php

namespace App\Domain\Incident;

final readonly class IncidentTransitionEdge
{
    public function __construct(
        public IncidentStatus $from,
        public IncidentStatus $to,
        public string $permission,
        public string $command,
        public ?IncidentEventType $eventType,
    ) {}
}
