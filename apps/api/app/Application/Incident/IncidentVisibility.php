<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentDomainException;
use App\Models\Incident;
use Illuminate\Database\Eloquent\Builder;

final class IncidentVisibility
{
    /** @return Builder<Incident> */
    public function query(CurrentMembershipContext $context): Builder
    {
        $query = Incident::query()
            ->where('school_id', $context->membership->school_id);

        if (! $context->permissions->contains('incidents.view-all')) {
            $query->where('reporter_user_id_snapshot', $context->membership->user_id);
        }

        return $query;
    }

    public function find(CurrentMembershipContext $context, string $incidentId): Incident
    {
        $incident = $this->query($context)
            ->whereKey($incidentId)
            ->first();

        if ($incident === null) {
            throw IncidentDomainException::incidentNotFound();
        }

        return $incident;
    }
}
