<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentAggregateValidator;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentLifecyclePolicy;
use App\Domain\Incident\IncidentPriority;
use App\Domain\Incident\IncidentStatus;
use App\Domain\Incident\IncidentTransitionEdge;
use App\Domain\Incident\IncidentTransitionPayloadValidationException;
use App\Models\Incident;
use App\Models\SchoolMembership;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use LogicException;

final class IncidentTransitionService
{
    public function __construct(
        private readonly IncidentVisibility $visibility,
        private readonly IncidentLifecyclePolicy $lifecycle,
        private readonly IncidentEventRecorder $events,
        private readonly IncidentAggregateValidator $aggregateValidator,
    ) {}

    /** @param array<string, mixed> $payload */
    public function transition(
        CurrentMembershipContext $context,
        string $incidentId,
        int $expectedVersion,
        array $payload,
    ): Incident {
        return DB::transaction(function () use ($context, $incidentId, $expectedVersion, $payload): Incident {
            $visible = $this->visibility->query($context)
                ->select([
                    'id',
                    'status',
                    'assignee_membership_id',
                    'assignee_user_id_snapshot',
                    'assignee_name_snapshot',
                ])
                ->whereKey($incidentId)
                ->first();
            if ($visible === null) {
                throw IncidentDomainException::incidentNotFound();
            }

            $to = IncidentStatus::from((string) $payload['toStatus']);
            $progressRouting = $this->lockProgressAssigneeRouting($context, $visible, $to);

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

            $hasAssigneeSnapshots = $incident->assignee_user_id_snapshot !== null
                && $incident->assignee_name_snapshot !== null;
            $edge = $this->lifecycle->resolve($incident->status, $to, $hasAssigneeSnapshots);
            if ($edge->command !== 'transition') {
                throw IncidentDomainException::invalidTransition();
            }

            $this->requirePermission($context, $edge->permission);
            $this->validateEdgePayload($edge, $payload);
            $this->assertProgressAuthority($context, $incident, $edge);
            if ($edge->to === IncidentStatus::InProgress) {
                $this->assertProgressEligibleAssignee($incident, $progressRouting);
            }

            $effectiveAt = CarbonImmutable::now('UTC');
            $versionBefore = (int) $incident->version;
            $eventPayload = $this->applyTransition($incident, $edge, $payload, $effectiveAt);
            $incident->version = $versionBefore + 1;
            $this->aggregateValidator->validate($incident->getAttributes());
            $incident->save();

            if ($edge->eventType === null) {
                throw new LogicException('Incident transition edge is missing its event type.');
            }

            $this->events->record(
                $incident,
                $context,
                $edge->eventType,
                $versionBefore,
                (int) $incident->version,
                $eventPayload,
                $effectiveAt,
            );

            return $incident;
        });
    }

    /**
     * @return array{
     *     expectedMembershipId: ?string,
     *     routingUserId: ?string,
     *     user: ?User,
     *     membership: ?SchoolMembership
     * }
     */
    private function lockProgressAssigneeRouting(
        CurrentMembershipContext $context,
        Incident $visible,
        IncidentStatus $to,
    ): array {
        $membershipId = $visible->assignee_membership_id === null
            ? null
            : (string) $visible->assignee_membership_id;
        if ($to !== IncidentStatus::InProgress || $membershipId === null) {
            return [
                'expectedMembershipId' => $membershipId,
                'routingUserId' => null,
                'user' => null,
                'membership' => null,
            ];
        }

        $schoolId = (string) $context->membership->school_id;
        $routing = SchoolMembership::query()
            ->where('school_id', $schoolId)
            ->whereKey($membershipId)
            ->first(['id', 'user_id']);
        if ($routing === null) {
            return [
                'expectedMembershipId' => $membershipId,
                'routingUserId' => null,
                'user' => null,
                'membership' => null,
            ];
        }

        $routingUserId = (string) $routing->user_id;
        $user = User::query()
            ->whereKey($routingUserId)
            ->lockForUpdate()
            ->first(['id', 'status']);
        $membership = SchoolMembership::query()
            ->where('school_id', $schoolId)
            ->whereKey($membershipId)
            ->lockForUpdate()
            ->first(['id', 'school_id', 'user_id', 'status']);

        return [
            'expectedMembershipId' => $membershipId,
            'routingUserId' => $routingUserId,
            'user' => $user,
            'membership' => $membership,
        ];
    }

    private function requirePermission(CurrentMembershipContext $context, string $permission): void
    {
        if (! $context->permissions->contains($permission)) {
            throw IncidentDomainException::forbidden();
        }
    }

    /** @param array<string, mixed> $payload */
    private function validateEdgePayload(IncidentTransitionEdge $edge, array $payload): void
    {
        $key = $edge->from->value.'->'.$edge->to->value;
        $allowed = match ($key) {
            'reported->triaged' => ['toStatus', 'triageSummary', 'priority', 'impact', 'blocksLaboratoryOperation'],
            'reported->rejected' => ['toStatus', 'reason'],
            'triaged->resolved', 'assigned->resolved', 'in_progress->resolved' => ['toStatus', 'resolutionSummary'],
            'assigned->in_progress', 'verified->closed' => ['toStatus'],
            'resolved->verified' => ['toStatus', 'verificationNote'],
            'resolved->in_progress', 'resolved->triaged' => ['toStatus', 'reason'],
            default => throw IncidentDomainException::invalidTransition(),
        };

        foreach (array_keys($payload) as $field) {
            if (! in_array($field, $allowed, true)) {
                throw new IncidentTransitionPayloadValidationException(
                    $field,
                    "{$field} is not allowed for the requested Incident transition.",
                );
            }
        }

        match ($key) {
            'reported->triaged' => $this->requireBounded($payload, 'triageSummary', 1, 2000),
            'reported->rejected', 'resolved->in_progress', 'resolved->triaged' => $this->requireBounded($payload, 'reason', 5, 1000),
            'triaged->resolved', 'assigned->resolved', 'in_progress->resolved' => $this->requireBounded($payload, 'resolutionSummary', 5, 4000),
            'resolved->verified' => $this->requireBounded($payload, 'verificationNote', 1, 2000),
            default => null,
        };
    }

    /** @param array<string, mixed> $payload */
    private function requireBounded(array $payload, string $field, int $min, int $max): void
    {
        $value = $payload[$field] ?? null;
        if (! is_string($value) || mb_strlen($value) < $min || mb_strlen($value) > $max) {
            throw new IncidentTransitionPayloadValidationException(
                $field,
                "{$field} must contain between {$min} and {$max} characters for the requested Incident transition.",
            );
        }
    }

    private function assertProgressAuthority(
        CurrentMembershipContext $context,
        Incident $incident,
        IncidentTransitionEdge $edge,
    ): void {
        if ($edge->permission !== 'incidents.update') {
            return;
        }

        $isCurrentAssignee = $incident->assignee_membership_id !== null
            && (string) $incident->assignee_membership_id === (string) $context->membership->id;
        if (! $isCurrentAssignee && ! $context->permissions->contains('incidents.assign')) {
            throw IncidentDomainException::forbidden();
        }
    }

    /**
     * @param array{
     *     expectedMembershipId: ?string,
     *     routingUserId: ?string,
     *     user: ?User,
     *     membership: ?SchoolMembership
     * } $routing
     */
    private function assertProgressEligibleAssignee(Incident $incident, array $routing): void
    {
        $membershipId = $incident->assignee_membership_id === null
            ? null
            : (string) $incident->assignee_membership_id;
        $snapshotUserId = $incident->assignee_user_id_snapshot === null
            ? null
            : (string) $incident->assignee_user_id_snapshot;
        $membership = $routing['membership'];
        $user = $routing['user'];

        if ($membershipId === null
            || $snapshotUserId === null
            || $routing['expectedMembershipId'] !== $membershipId
            || $routing['routingUserId'] === null
            || $routing['routingUserId'] !== $snapshotUserId
            || $membership === null
            || $user === null
            || (string) $membership->id !== $membershipId
            || (string) $membership->user_id !== $snapshotUserId
            || (string) $user->id !== $snapshotUserId
            || $membership->status !== 'active'
            || $user->status !== 'active'
            || ! $membership->hasPermission('incidents.update')) {
            throw IncidentDomainException::assigneeIneligible();
        }
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function applyTransition(
        Incident $incident,
        IncidentTransitionEdge $edge,
        array $payload,
        CarbonImmutable $effectiveAt,
    ): array {
        $key = $edge->from->value.'->'.$edge->to->value;

        return match ($key) {
            'reported->triaged' => $this->triage($incident, $payload, $effectiveAt),
            'reported->rejected' => $this->reject($incident, (string) $payload['reason'], $effectiveAt),
            'triaged->resolved', 'assigned->resolved', 'in_progress->resolved' => $this->resolve(
                $incident,
                (string) $payload['resolutionSummary'],
                $effectiveAt,
            ),
            'assigned->in_progress' => $this->start($incident, $effectiveAt),
            'resolved->verified' => $this->verify($incident, (string) $payload['verificationNote'], $effectiveAt),
            'resolved->in_progress', 'resolved->triaged' => $this->reopen(
                $incident,
                $edge->to,
                (string) $payload['reason'],
                $effectiveAt,
            ),
            'verified->closed' => $this->close($incident, $effectiveAt),
            default => throw IncidentDomainException::invalidTransition(),
        };
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    private function triage(Incident $incident, array $payload, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::Triaged;
        $incident->triage_summary = $payload['triageSummary'];
        $incident->triaged_at = $effectiveAt;
        if (array_key_exists('priority', $payload)) {
            $incident->priority = IncidentPriority::from((string) $payload['priority']);
        }
        if (array_key_exists('impact', $payload)) {
            $incident->impact = $payload['impact'];
        }
        if (array_key_exists('blocksLaboratoryOperation', $payload)) {
            $incident->blocks_laboratory_operation = $payload['blocksLaboratoryOperation'];
        }

        return [
            'triageSummary' => $incident->triage_summary,
            'priority' => $incident->priority->value,
            'impact' => $incident->impact,
            'blocksLaboratoryOperation' => (bool) $incident->blocks_laboratory_operation,
        ];
    }

    /** @return array{rejectionReason: string} */
    private function reject(Incident $incident, string $reason, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::Rejected;
        $incident->rejection_reason = $reason;
        $incident->rejected_at = $effectiveAt;

        return ['rejectionReason' => $reason];
    }

    /** @return array{resolutionSummary: string} */
    private function resolve(Incident $incident, string $summary, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::Resolved;
        $incident->resolution_summary = $summary;
        $incident->resolved_at = $effectiveAt;

        return ['resolutionSummary' => $summary];
    }

    /** @return array{previousStatus: string, newStatus: string} */
    private function start(Incident $incident, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::InProgress;
        $incident->started_at = $effectiveAt;

        return [
            'previousStatus' => IncidentStatus::Assigned->value,
            'newStatus' => IncidentStatus::InProgress->value,
        ];
    }

    /** @return array{verificationNote: string} */
    private function verify(Incident $incident, string $note, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::Verified;
        $incident->verification_note = $note;
        $incident->verified_at = $effectiveAt;

        return ['verificationNote' => $note];
    }

    /** @return array<string, mixed> */
    private function reopen(
        Incident $incident,
        IncidentStatus $target,
        string $reason,
        CarbonImmutable $effectiveAt,
    ): array {
        $clearedFields = ['resolutionSummary', 'resolvedAt'];
        $clearedValues = [
            'resolutionSummary' => (string) $incident->resolution_summary,
            'resolvedAt' => $this->canonicalTimestamp($incident->resolved_at),
        ];
        if ($incident->verification_note !== null && $incident->verified_at !== null) {
            $clearedFields[] = 'verificationNote';
            $clearedFields[] = 'verifiedAt';
            $clearedValues['verificationNote'] = (string) $incident->verification_note;
            $clearedValues['verifiedAt'] = $this->canonicalTimestamp($incident->verified_at);
        }

        $startedAtInitialized = false;
        $startedAt = null;
        if ($target === IncidentStatus::InProgress && $incident->started_at === null) {
            $incident->started_at = $effectiveAt;
            $startedAtInitialized = true;
            $startedAt = $this->canonicalTimestamp($effectiveAt);
        }

        $incident->status = $target;
        $incident->resolution_summary = null;
        $incident->resolved_at = null;
        $incident->verification_note = null;
        $incident->verified_at = null;

        return [
            'previousStatus' => IncidentStatus::Resolved->value,
            'newStatus' => $target->value,
            'reason' => $reason,
            'assigneePresent' => $target === IncidentStatus::InProgress,
            'clearedFields' => $clearedFields,
            'clearedValues' => $clearedValues,
            'startedAtInitialized' => $startedAtInitialized,
            'startedAt' => $startedAt,
        ];
    }

    /** @return array{previousStatus: string, newStatus: string} */
    private function close(Incident $incident, CarbonImmutable $effectiveAt): array
    {
        $incident->status = IncidentStatus::Closed;
        $incident->closed_at = $effectiveAt;

        return [
            'previousStatus' => IncidentStatus::Verified->value,
            'newStatus' => IncidentStatus::Closed->value,
        ];
    }

    private function canonicalTimestamp(mixed $value): string
    {
        if (! $value instanceof CarbonImmutable) {
            throw new LogicException('Incident lifecycle timestamp is missing or invalid.');
        }

        return $value->utc()->format('Y-m-d\TH:i:s.u\Z');
    }
}
