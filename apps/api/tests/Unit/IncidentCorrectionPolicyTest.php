<?php

namespace Tests\Unit;

use App\Domain\Incident\IncidentCatalog;
use App\Domain\Incident\IncidentCreatePayloadValidator;
use App\Domain\Incident\IncidentEventPayloadValidator;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentTimestamp;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class IncidentCorrectionPolicyTest extends TestCase
{
    public function test_timestamp_canonicalization_rejects_semantically_impossible_values(): void
    {
        $this->assertSame(
            '2026-08-29T03:00:00.123000Z',
            IncidentTimestamp::canonicalize('2026-08-29T10:00:00.123+07:00'),
        );

        foreach ([
            '2026-02-30T10:00:00Z',
            '2026-08-29T24:00:00Z',
            '2026-08-29T10:00:00+24:00',
            '2026-08-29 10:00:00Z',
        ] as $invalid) {
            try {
                IncidentTimestamp::canonicalize($invalid);
                $this->fail("Expected {$invalid} to be rejected.");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_receipt_time_is_the_boundary_for_occurred_at_validation(): void
    {
        $validator = new IncidentCreatePayloadValidator;
        $receipt = new CarbonImmutable('2026-08-29T03:00:00.000000Z');
        $payload = $this->createPayload('2026-08-29T03:05:00.000000Z');

        $validator->validate($payload, $payload, $receipt);

        $this->expectException(InvalidArgumentException::class);
        $validator->validate($this->createPayload('2026-08-29T03:05:00.000001Z'), $this->createPayload('2026-08-29T03:05:00.000001Z'), $receipt);
    }

    public function test_updated_event_has_a_closed_reported_state_field_allowlist_and_exact_shapes(): void
    {
        $validator = new IncidentEventPayloadValidator;
        $labId = strtolower((string) Str::ulid());
        $newLabId = strtolower((string) Str::ulid());
        $valid = [
            'changedFields' => ['laboratoryId', 'title'],
            'before' => ['laboratoryId' => $labId, 'title' => 'Before title'],
            'after' => ['laboratoryId' => $newLabId, 'title' => 'After title'],
        ];

        $this->assertSame($valid, $validator->validate(IncidentEventType::Updated, $valid));

        foreach (['status', 'version', 'ticketNumber', 'reporter', 'assignee', 'reportedAt', 'schoolId'] as $forbidden) {
            try {
                $validator->validate(IncidentEventType::Updated, [
                    'changedFields' => [$forbidden],
                    'before' => [$forbidden => 'value'],
                    'after' => [$forbidden => 'changed'],
                ]);
                $this->fail("Expected {$forbidden} to be rejected.");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }

        $this->expectException(InvalidArgumentException::class);
        $validator->validate(IncidentEventType::Updated, [
            'changedFields' => ['blocksLaboratoryOperation'],
            'before' => ['blocksLaboratoryOperation' => false],
            'after' => ['blocksLaboratoryOperation' => 'true'],
        ]);
    }

    public function test_updated_event_rejects_uncanonical_text_and_identical_values(): void
    {
        $validator = new IncidentEventPayloadValidator;

        foreach ([
            $this->updatedPayload('title', 'Before title', ' After title '),
            $this->updatedPayload('description', 'Canonical description', "Cafe\u{0301} description"),
            $this->updatedPayload('impact', null, '   '),
            $this->updatedPayload('title', 'Same title', 'Same title'),
        ] as $payload) {
            try {
                $validator->validate(IncidentEventType::Updated, $payload);
                $this->fail('Expected uncanonical or unchanged Incident evidence to be rejected.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_updated_event_accepts_only_actual_canonical_text_changes(): void
    {
        $validator = new IncidentEventPayloadValidator;

        foreach ([
            $this->updatedPayload('title', 'Before title', 'After title'),
            $this->updatedPayload('impact', null, 'Kegiatan praktikum tertunda'),
            $this->updatedPayload('impact', 'Kegiatan praktikum tertunda', null),
        ] as $payload) {
            $this->assertSame($payload, $validator->validate(IncidentEventType::Updated, $payload));
        }
    }

    public function test_started_closed_and_reopened_event_semantics_are_exact(): void
    {
        $validator = new IncidentEventPayloadValidator;

        foreach ([
            [IncidentEventType::Started, ['previousStatus' => 'assigned', 'newStatus' => 'in_progress']],
            [IncidentEventType::Closed, ['previousStatus' => 'verified', 'newStatus' => 'closed']],
        ] as [$eventType, $payload]) {
            $this->assertSame($payload, $validator->validate($eventType, $payload));
        }

        foreach ([
            [IncidentEventType::Started, ['previousStatus' => 'triaged', 'newStatus' => 'in_progress']],
            [IncidentEventType::Closed, ['previousStatus' => 'in_progress', 'newStatus' => 'closed']],
        ] as [$eventType, $payload]) {
            try {
                $validator->validate($eventType, $payload);
                $this->fail("Expected {$eventType->value} status transition to be rejected.");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_reopened_requires_resolution_evidence_and_paired_verification_evidence(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new IncidentEventPayloadValidator)->validate(IncidentEventType::Reopened, [
            'previousStatus' => 'resolved',
            'newStatus' => 'triaged',
            'reason' => 'Needs review again',
            'assigneePresent' => false,
            'clearedFields' => ['resolvedAt', 'verificationNote'],
            'clearedValues' => [
                'resolvedAt' => '2026-08-29T03:00:00.000000Z',
                'verificationNote' => 'Checked',
            ],
            'startedAtInitialized' => false,
            'startedAt' => null,
        ]);
    }

    public function test_reopened_event_rejects_noncanonical_or_incomplete_clear_evidence(): void
    {
        $validator = new IncidentEventPayloadValidator;
        $resolvedAt = '2026-08-29T03:00:00.000000Z';
        $verificationNote = 'Verified before reopen';
        $verifiedAt = '2026-08-29T03:05:00.000000Z';

        foreach ([
            $this->reopenPayload([], []),
            $this->reopenPayload(['resolutionSummary'], ['resolutionSummary' => 'Resolved previously']),
            $this->reopenPayload(['resolvedAt'], ['resolvedAt' => $resolvedAt]),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt', 'verificationNote'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt, 'verificationNote' => $verificationNote],
            ),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt', 'verifiedAt'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt, 'verifiedAt' => $verifiedAt],
            ),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => '2026-02-30T03:00:00.000000Z'],
            ),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt],
                assigneePresent: true,
                startedAtInitialized: true,
                startedAt: '2026-08-29 03:10:00Z',
            ),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt', 'resolvedAt'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt],
            ),
            $this->reopenPayload(
                ['resolutionSummary', 'resolvedAt', 'unknown'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt, 'unknown' => 'value'],
            ),
            $this->reopenPayload(
                ['resolvedAt', 'resolutionSummary'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt],
            ),
            $this->reopenPayload(
                ['first' => 'resolutionSummary', 'second' => 'resolvedAt'],
                ['resolutionSummary' => 'Resolved previously', 'resolvedAt' => $resolvedAt],
            ),
        ] as $payload) {
            try {
                $validator->validate(IncidentEventType::Reopened, $payload);
                $this->fail('Expected invalid reopen clear evidence to be rejected.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_reopened_event_accepts_each_canonical_path(): void
    {
        $validator = new IncidentEventPayloadValidator;
        $fields = ['resolutionSummary', 'resolvedAt'];
        $values = [
            'resolutionSummary' => 'Resolved previously',
            'resolvedAt' => '2026-08-29T03:00:00.000000Z',
        ];

        foreach ([
            $this->reopenPayload($fields, $values),
            $this->reopenPayload($fields, $values, assigneePresent: true),
            $this->reopenPayload(
                $fields,
                $values,
                assigneePresent: true,
                startedAtInitialized: true,
                startedAt: '2026-08-29T03:10:00.000000Z',
            ),
        ] as $payload) {
            $this->assertSame($payload, $validator->validate(IncidentEventType::Reopened, $payload));
        }
    }

    public function test_incident_specific_reporting_device_lifecycle_catalog_is_closed(): void
    {
        $this->assertSame(['in_service', 'spare'], IncidentCatalog::REPORTING_DEVICE_LIFECYCLE_STATUSES);
    }

    /** @return array<string, mixed> */
    private function createPayload(string $occurredAt): array
    {
        return [
            'laboratoryId' => strtolower((string) Str::ulid()),
            'deviceId' => null,
            'category' => 'hardware',
            'priority' => 'normal',
            'title' => 'Desktop gagal menyala',
            'description' => 'Desktop berhenti sebelum sistem operasi dimuat.',
            'impact' => null,
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => null,
            'occurredAt' => $occurredAt,
        ];
    }

    /** @return array<string, mixed> */
    private function updatedPayload(string $field, mixed $before, mixed $after): array
    {
        return [
            'changedFields' => [$field],
            'before' => [$field => $before],
            'after' => [$field => $after],
        ];
    }

    /** @param array<array-key, string> $clearedFields @param array<string, mixed> $clearedValues @return array<string, mixed> */
    private function reopenPayload(
        array $clearedFields,
        array $clearedValues,
        bool $assigneePresent = false,
        bool $startedAtInitialized = false,
        ?string $startedAt = null,
    ): array {
        return [
            'previousStatus' => 'resolved',
            'newStatus' => $assigneePresent ? 'in_progress' : 'triaged',
            'reason' => 'Problem returned after resolution',
            'assigneePresent' => $assigneePresent,
            'clearedFields' => $clearedFields,
            'clearedValues' => $clearedValues,
            'startedAtInitialized' => $startedAtInitialized,
            'startedAt' => $startedAt,
        ];
    }
}
