<?php

namespace App\Domain\Incident;

use InvalidArgumentException;

final class IncidentAggregateValidator
{
    /** @param array<string, mixed> $attributes */
    public function validate(array $attributes): void
    {
        if ((int) ($attributes['version'] ?? 0) < 1) {
            throw new InvalidArgumentException('Incident version must be positive.');
        }

        $deviceValues = [
            $attributes['device_id_snapshot'] ?? null,
            $attributes['device_code_snapshot'] ?? null,
            $attributes['device_type_snapshot'] ?? null,
        ];
        $this->assertAllNullOrPresent($deviceValues, 'Device snapshot');

        $assigneeSnapshotValues = [
            $attributes['assignee_user_id_snapshot'] ?? null,
            $attributes['assignee_name_snapshot'] ?? null,
        ];
        $this->assertAllNullOrPresent($assigneeSnapshotValues, 'Assignee snapshot');

        $statusValue = $attributes['status'] ?? '';
        $status = $statusValue instanceof IncidentStatus
            ? $statusValue
            : IncidentStatus::from((string) $statusValue);
        $hasAssignee = ($attributes['assignee_membership_id'] ?? null) !== null;
        $hasAssigneeSnapshot = $assigneeSnapshotValues[0] !== null;
        if ($hasAssignee && ! $hasAssigneeSnapshot) {
            throw new InvalidArgumentException('A live assignee requires immutable assignee snapshots.');
        }
        if ($hasAssigneeSnapshot && ($attributes['assigned_at'] ?? null) === null) {
            throw new InvalidArgumentException('An assignee snapshot requires assigned_at.');
        }
        if (in_array($status, [IncidentStatus::Reported, IncidentStatus::Triaged, IncidentStatus::Rejected], true)
            && ($hasAssignee || $hasAssigneeSnapshot)) {
            throw new InvalidArgumentException("{$status->value} cannot have a current assignee.");
        }
        if (in_array($status, [IncidentStatus::Assigned, IncidentStatus::InProgress], true)
            && ! $hasAssigneeSnapshot) {
            throw new InvalidArgumentException("{$status->value} requires current assignee snapshots.");
        }
        if ($status === IncidentStatus::InProgress && ($attributes['started_at'] ?? null) === null) {
            throw new InvalidArgumentException('in_progress requires started_at.');
        }
        if (in_array($status, [
            IncidentStatus::Triaged,
            IncidentStatus::Assigned,
            IncidentStatus::InProgress,
            IncidentStatus::Resolved,
            IncidentStatus::Verified,
            IncidentStatus::Closed,
        ], true) && (($attributes['triage_summary'] ?? null) === null || ($attributes['triaged_at'] ?? null) === null)) {
            throw new InvalidArgumentException("{$status->value} requires triage evidence.");
        }
        if (in_array($status, [IncidentStatus::Resolved, IncidentStatus::Verified, IncidentStatus::Closed], true)
            && (($attributes['resolution_summary'] ?? null) === null || ($attributes['resolved_at'] ?? null) === null)) {
            throw new InvalidArgumentException("{$status->value} requires resolution evidence.");
        }
        if (in_array($status, [IncidentStatus::Verified, IncidentStatus::Closed], true)
            && (($attributes['verification_note'] ?? null) === null || ($attributes['verified_at'] ?? null) === null)) {
            throw new InvalidArgumentException("{$status->value} requires verification evidence.");
        }
        if ($status === IncidentStatus::Closed && ($attributes['closed_at'] ?? null) === null) {
            throw new InvalidArgumentException('closed requires closed_at.');
        }
        if ($status === IncidentStatus::Rejected
            && (($attributes['rejection_reason'] ?? null) === null || ($attributes['rejected_at'] ?? null) === null)) {
            throw new InvalidArgumentException('rejected requires rejection evidence.');
        }

        $terminalEvidence = [
            'resolution_summary', 'resolved_at', 'verification_note', 'verified_at',
            'closed_at', 'rejection_reason', 'rejected_at',
        ];
        if (in_array($status, [IncidentStatus::Reported, IncidentStatus::Triaged, IncidentStatus::Assigned, IncidentStatus::InProgress], true)) {
            $this->assertNull($attributes, $terminalEvidence, "{$status->value} terminal evidence");
        }
        if ($status === IncidentStatus::Reported) {
            $this->assertNull($attributes, ['triage_summary', 'triaged_at', 'assigned_at', 'started_at'], 'reported lifecycle evidence');
        }
        if ($status === IncidentStatus::Triaged) {
            $this->assertNull($attributes, ['assigned_at', 'started_at'], 'triaged assignment evidence');
        }
        if ($status === IncidentStatus::Assigned) {
            $this->assertNull($attributes, ['started_at'], 'assigned start evidence');
        }
        if ($status === IncidentStatus::Resolved) {
            $this->assertNull($attributes, ['verification_note', 'verified_at', 'closed_at', 'rejection_reason', 'rejected_at'], 'resolved later evidence');
        }
        if ($status === IncidentStatus::Verified) {
            $this->assertNull($attributes, ['closed_at', 'rejection_reason', 'rejected_at'], 'verified terminal evidence');
        }
        if ($status === IncidentStatus::Closed) {
            $this->assertNull($attributes, ['rejection_reason', 'rejected_at'], 'closed rejection evidence');
        }
        if ($status === IncidentStatus::Rejected) {
            $this->assertNull($attributes, [
                'triage_summary', 'triaged_at', 'assigned_at', 'started_at',
                'resolution_summary', 'resolved_at', 'verification_note', 'verified_at', 'closed_at',
            ], 'rejected non-rejection evidence');
        }
    }

    /** @param list<mixed> $values */
    private function assertAllNullOrPresent(array $values, string $label): void
    {
        $present = count(array_filter($values, fn (mixed $value): bool => $value !== null));
        if ($present !== 0 && $present !== count($values)) {
            throw new InvalidArgumentException("{$label} must be all-null or all-present.");
        }
    }

    /** @param array<string, mixed> $attributes @param list<string> $fields */
    private function assertNull(array $attributes, array $fields, string $label): void
    {
        foreach ($fields as $field) {
            if (($attributes[$field] ?? null) !== null) {
                throw new InvalidArgumentException("{$label} must be null.");
            }
        }
    }
}
