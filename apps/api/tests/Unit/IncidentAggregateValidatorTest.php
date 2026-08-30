<?php

namespace Tests\Unit;

use App\Domain\Incident\IncidentAggregateValidator;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class IncidentAggregateValidatorTest extends TestCase
{
    public function test_reported_and_resolved_path_invariants_are_accepted(): void
    {
        $validator = new IncidentAggregateValidator;
        $validator->validate(['version' => 1, 'status' => 'reported']);
        $validator->validate([
            'version' => 4,
            'status' => 'resolved',
            'triage_summary' => 'Reviewed.',
            'triaged_at' => '2026-08-29T03:30:00Z',
            'resolution_summary' => 'Resolved during triage.',
            'resolved_at' => '2026-08-29T04:00:00Z',
        ]);

        $this->addToAssertionCount(2);
    }

    #[DataProvider('invalidAggregates')]
    public function test_impossible_aggregate_states_are_rejected(array $attributes): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentAggregateValidator)->validate($attributes);
    }

    public static function invalidAggregates(): array
    {
        return [
            [['version' => 0, 'status' => 'reported']],
            [['version' => 1, 'status' => 'reported', 'device_id_snapshot' => 'd']],
            [['version' => 2, 'status' => 'assigned']],
            [['version' => 3, 'status' => 'in_progress', 'assignee_membership_id' => 'm', 'assignee_user_id_snapshot' => 'u', 'assignee_name_snapshot' => 'Tech']],
            [['version' => 4, 'status' => 'resolved']],
            [['version' => 5, 'status' => 'verified', 'resolution_summary' => 'Done', 'resolved_at' => 'now']],
            [['version' => 6, 'status' => 'closed', 'resolution_summary' => 'Done', 'resolved_at' => 'now', 'verification_note' => 'OK', 'verified_at' => 'now']],
            [['version' => 2, 'status' => 'rejected']],
        ];
    }
}
