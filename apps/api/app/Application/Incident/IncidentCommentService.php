<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentAggregateValidator;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentStatus;
use App\Models\IncidentEvent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

final class IncidentCommentService
{
    public function __construct(
        private readonly IncidentVisibility $visibility,
        private readonly IncidentEventRecorder $events,
        private readonly IncidentAggregateValidator $aggregateValidator,
    ) {}

    public function add(
        CurrentMembershipContext $context,
        string $incidentId,
        int $expectedVersion,
        string $text,
    ): IncidentEvent {
        return DB::transaction(function () use ($context, $incidentId, $expectedVersion, $text): IncidentEvent {
            $incident = $this->visibility->query($context)
                ->whereKey($incidentId)
                ->lockForUpdate()
                ->first();
            if ($incident === null) {
                throw IncidentDomainException::incidentNotFound();
            }
            if ((int) $incident->version !== $expectedVersion) {
                throw IncidentDomainException::versionConflict();
            }
            if (in_array($incident->status, [IncidentStatus::Closed, IncidentStatus::Rejected], true)) {
                throw IncidentDomainException::statusConflict();
            }

            $effectiveAt = CarbonImmutable::now('UTC');
            $versionBefore = (int) $incident->version;
            $incident->version = $versionBefore + 1;
            $this->aggregateValidator->validate($incident->getAttributes());
            $incident->save();

            return $this->events->record(
                $incident,
                $context,
                IncidentEventType::CommentAdded,
                $versionBefore,
                (int) $incident->version,
                ['text' => $text],
                $effectiveAt,
            );
        });
    }
}
