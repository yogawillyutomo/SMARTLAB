<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentAggregateValidator;
use App\Domain\Incident\IncidentAssignmentPayloadValidationException;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentStatus;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\SchoolMembership;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

final class IncidentAssignmentService
{
    public function __construct(
        private readonly IncidentVisibility $visibility,
        private readonly IncidentEventRecorder $events,
        private readonly IncidentAggregateValidator $aggregateValidator,
    ) {}

    /** @param array{assigneeMembershipId: string, reason?: ?string} $payload */
    public function assign(
        CurrentMembershipContext $context,
        string $incidentId,
        int $expectedVersion,
        array $payload,
    ): Incident {
        return DB::transaction(function () use ($context, $incidentId, $expectedVersion, $payload): Incident {
            $visible = $this->visibility->query($context)
                ->select(['id'])
                ->whereKey($incidentId)
                ->first();
            if ($visible === null) {
                throw IncidentDomainException::incidentNotFound();
            }

            $schoolId = (string) $context->membership->school_id;
            $candidateId = $payload['assigneeMembershipId'];
            $candidateRouting = SchoolMembership::query()
                ->where('school_id', $schoolId)
                ->whereKey($candidateId)
                ->first(['id', 'user_id']);
            if ($candidateRouting === null) {
                throw IncidentDomainException::assigneeNotFound();
            }

            $candidateUser = User::query()
                ->whereKey($candidateRouting->user_id)
                ->lockForUpdate()
                ->first(['id', 'name', 'status']);
            $candidateMembership = SchoolMembership::query()
                ->where('school_id', $schoolId)
                ->whereKey($candidateId)
                ->lockForUpdate()
                ->first(['id', 'school_id', 'user_id', 'status']);
            if ($candidateMembership === null) {
                throw IncidentDomainException::assigneeNotFound();
            }
            if ($candidateUser === null || $candidateMembership->user_id !== $candidateRouting->user_id) {
                throw IncidentDomainException::assigneeIneligible();
            }

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

            $isInitialAssignment = $incident->status === IncidentStatus::Triaged;
            $hasAssigneeSnapshots = $incident->assignee_user_id_snapshot !== null
                && $incident->assignee_name_snapshot !== null;
            $isResolvedRecovery = $incident->status === IncidentStatus::Resolved
                && $hasAssigneeSnapshots;
            $isReassignment = in_array(
                $incident->status,
                [IncidentStatus::Assigned, IncidentStatus::InProgress],
                true,
            ) || $isResolvedRecovery;
            if (! $isInitialAssignment && ! $isReassignment) {
                throw IncidentDomainException::statusConflict();
            }

            if ($isReassignment && $incident->assignee_membership_id === $candidateMembership->id) {
                return $incident;
            }

            if ($candidateMembership->status !== 'active'
                || $candidateUser->status !== 'active'
                || ! $candidateMembership->hasPermission('incidents.update')) {
                throw IncidentDomainException::assigneeIneligible();
            }

            $reason = $payload['reason'] ?? null;
            $effectiveAt = CarbonImmutable::now('UTC');
            $versionBefore = (int) $incident->version;
            $eventType = IncidentEventType::Assigned;
            $eventPayload = [
                'assignee' => $this->assigneeSnapshot($candidateMembership, $candidateUser),
                'reason' => $reason,
            ];

            if ($isInitialAssignment) {
                $incident->status = IncidentStatus::Assigned;
                $incident->assigned_at = $effectiveAt;
            } else {
                $this->assertReassignmentReason($reason);
                $eventType = IncidentEventType::Reassigned;
                $eventPayload = [
                    'previousAssignee' => [
                        'membershipId' => $this->previousAssigneeMembershipId($incident),
                        'userId' => (string) $incident->assignee_user_id_snapshot,
                        'name' => (string) $incident->assignee_name_snapshot,
                    ],
                    'newAssignee' => $this->assigneeSnapshot($candidateMembership, $candidateUser),
                    'reason' => $reason,
                ];
            }

            $incident->assignee_membership_id = $candidateMembership->id;
            $incident->assignee_user_id_snapshot = $candidateUser->id;
            $incident->assignee_name_snapshot = $candidateUser->name;
            $incident->version = $versionBefore + 1;
            $this->aggregateValidator->validate($incident->getAttributes());
            $incident->save();

            $this->events->record(
                $incident,
                $context,
                $eventType,
                $versionBefore,
                (int) $incident->version,
                $eventPayload,
                $effectiveAt,
            );

            return $incident;
        });
    }

    private function previousAssigneeMembershipId(Incident $incident): string
    {
        if ($incident->assignee_membership_id !== null) {
            return (string) $incident->assignee_membership_id;
        }

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
            throw new LogicException('Current Incident assignee membership cannot be reconstructed.');
        }

        return $membershipId;
    }

    /** @return array{membershipId: string, userId: string, name: string} */
    private function assigneeSnapshot(SchoolMembership $membership, User $user): array
    {
        return [
            'membershipId' => (string) $membership->id,
            'userId' => (string) $user->id,
            'name' => (string) $user->name,
        ];
    }

    private function assertReassignmentReason(?string $reason): void
    {
        if ($reason === null || mb_strlen($reason) < 5 || mb_strlen($reason) > 1000) {
            throw new IncidentAssignmentPayloadValidationException('A reassignment reason between 5 and 1000 characters is required.');
        }
    }
}
