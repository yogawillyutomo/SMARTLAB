<?php

namespace App\Domain\Incident;

enum IncidentStatus: string
{
    case Reported = 'reported';
    case Triaged = 'triaged';
    case Assigned = 'assigned';
    case InProgress = 'in_progress';
    case Resolved = 'resolved';
    case Verified = 'verified';
    case Closed = 'closed';
    case Rejected = 'rejected';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }

    public function isTerminal(): bool
    {
        return $this === self::Closed || $this === self::Rejected;
    }
}
