<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentEventType;
use App\Models\IncidentEvent;
use Illuminate\Pagination\LengthAwarePaginator;

final class IncidentCommentQueryService
{
    public function __construct(private readonly IncidentVisibility $visibility) {}

    /** @param array<string, mixed> $filters */
    public function list(
        CurrentMembershipContext $context,
        string $incidentId,
        array $filters,
    ): LengthAwarePaginator {
        $incident = $this->visibility->find($context, $incidentId);

        return IncidentEvent::query()
            ->where('school_id', $context->membership->school_id)
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::CommentAdded->value)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(
                (int) ($filters['perPage'] ?? 25),
                [
                    'id', 'incident_id_snapshot', 'actor_user_id_snapshot',
                    'actor_name_snapshot', 'payload', 'created_at',
                ],
                'page',
                (int) ($filters['page'] ?? 1),
            );
    }
}
