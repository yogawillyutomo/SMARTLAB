<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentEventType;
use App\Models\Incident;
use App\Models\IncidentEvent;
use LogicException;

final class IncidentQueryService
{
    public function __construct(private readonly IncidentVisibility $visibility) {}

    public function find(CurrentMembershipContext $context, string $incidentId): Incident
    {
        $incident = $this->visibility->find($context, $incidentId);

        if ($incident->assignee_user_id_snapshot !== null && $incident->assignee_membership_id === null) {
            $incident->setAttribute(
                'assignee_membership_id_projection',
                $this->historicalAssigneeMembershipId($incident),
            );
        }

        return $incident;
    }

    private function historicalAssigneeMembershipId(Incident $incident): string
    {
        $event = IncidentEvent::query()
            ->where('school_id', $incident->school_id)
            ->where('incident_id_snapshot', $incident->id)
            ->whereIn('event_type', [
                IncidentEventType::Assigned->value,
                IncidentEventType::Reassigned->value,
            ])
            ->orderByDesc('incident_version_after')
            ->orderByDesc('id')
            ->first();

        $payloadKey = $event?->event_type === IncidentEventType::Reassigned
            ? 'newAssignee'
            : 'assignee';
        $membershipId = $event?->payload[$payloadKey]['membershipId'] ?? null;

        if (! is_string($membershipId) || $membershipId === '') {
            throw new LogicException('Current Incident assignee snapshot cannot be reconstructed.');
        }

        return $membershipId;
    }
}
