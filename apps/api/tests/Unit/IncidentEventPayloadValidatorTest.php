<?php

namespace Tests\Unit;

use App\Domain\Incident\IncidentEventPayloadValidator;
use App\Domain\Incident\IncidentEventType;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class IncidentEventPayloadValidatorTest extends TestCase
{
    #[DataProvider('validPayloads')]
    public function test_each_event_type_accepts_only_its_typed_payload(IncidentEventType $type, array $payload): void
    {
        $this->assertSame($payload, (new IncidentEventPayloadValidator)->validate($type, $payload));
    }

    public static function validPayloads(): array
    {
        return [
            [IncidentEventType::Reported, [
                'reporter' => ['userId' => 'u', 'membershipId' => 'm', 'name' => 'Reporter'],
                'laboratory' => ['id' => 'l', 'code' => 'LAB', 'name' => 'Laboratory'],
                'device' => null,
                'category' => 'hardware',
                'priority' => 'normal',
                'title' => 'A title',
                'description' => 'A description',
                'impact' => null,
                'blocksLaboratoryOperation' => false,
                'stepsTaken' => null,
                'occurredAt' => '2026-08-29T03:00:00.000000Z',
                'reportedAt' => '2026-08-29T03:01:00.000000Z',
            ]],
            [IncidentEventType::Updated, [
                'changedFields' => ['priority', 'title'],
                'before' => ['priority' => 'normal', 'title' => 'Before'],
                'after' => ['priority' => 'high', 'title' => 'After'],
            ]],
            [IncidentEventType::Triaged, ['triageSummary' => 'Needs work', 'priority' => 'high', 'impact' => null, 'blocksLaboratoryOperation' => false]],
            [IncidentEventType::Assigned, ['assignee' => ['membershipId' => 'm', 'userId' => 'u', 'name' => 'Tech'], 'reason' => null]],
            [IncidentEventType::Reassigned, ['previousAssignee' => ['membershipId' => 'm1', 'userId' => 'u1', 'name' => 'Old'], 'newAssignee' => ['membershipId' => 'm2', 'userId' => 'u2', 'name' => 'New'], 'reason' => 'Shift changed']],
            [IncidentEventType::Started, ['previousStatus' => 'assigned', 'newStatus' => 'in_progress']],
            [IncidentEventType::Resolved, ['resolutionSummary' => 'Cable replaced']],
            [IncidentEventType::Reopened, ['previousStatus' => 'resolved', 'newStatus' => 'in_progress', 'reason' => 'Problem returned', 'assigneePresent' => true, 'clearedFields' => ['resolutionSummary', 'resolvedAt'], 'clearedValues' => ['resolutionSummary' => 'Done again', 'resolvedAt' => '2026-08-29T04:00:00.000000Z'], 'startedAtInitialized' => false, 'startedAt' => null]],
            [IncidentEventType::Verified, ['verificationNote' => 'Verified in class']],
            [IncidentEventType::Closed, ['previousStatus' => 'verified', 'newStatus' => 'closed']],
            [IncidentEventType::Rejected, ['rejectionReason' => 'Duplicate report']],
            [IncidentEventType::CommentAdded, ['text' => 'Additional evidence']],
        ];
    }

    public function test_unknown_payload_keys_are_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentEventPayloadValidator)->validate(IncidentEventType::CommentAdded, [
            'text' => 'Safe comment',
            'private' => true,
        ]);
    }

    public function test_updated_fields_must_be_sorted_unique_and_match_before_after(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentEventPayloadValidator)->validate(IncidentEventType::Updated, [
            'changedFields' => ['title', 'priority'],
            'before' => ['title' => 'Before'],
            'after' => ['title' => 'After'],
        ]);
    }

    public function test_reopen_evidence_must_match_cleared_fields(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentEventPayloadValidator)->validate(IncidentEventType::Reopened, [
            'previousStatus' => 'resolved',
            'newStatus' => 'triaged',
            'reason' => 'Needs review',
            'assigneePresent' => false,
            'clearedFields' => ['resolutionSummary'],
            'clearedValues' => [],
            'startedAtInitialized' => false,
            'startedAt' => null,
        ]);
    }
}
