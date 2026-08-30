<?php

namespace App\Domain\Incident;

enum IncidentEventType: string
{
    case Reported = 'incident.reported';
    case Updated = 'incident.updated';
    case Triaged = 'incident.triaged';
    case Assigned = 'incident.assigned';
    case Reassigned = 'incident.reassigned';
    case Started = 'incident.started';
    case Resolved = 'incident.resolved';
    case Reopened = 'incident.reopened';
    case Verified = 'incident.verified';
    case Closed = 'incident.closed';
    case Rejected = 'incident.rejected';
    case CommentAdded = 'incident.comment_added';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
