<?php

namespace Tests\Unit;

use App\Application\Incident\IncidentRoutingEvidence;
use App\Application\Incident\IncidentSubjectLockPlan;
use App\Domain\Incident\IncidentCorrectionPayloadNormalizer;
use App\Domain\Incident\IncidentDomainException;
use App\Models\Incident;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class IncidentCorrectionPayloadNormalizerTest extends TestCase
{
    public function test_partial_payload_is_normalized_without_create_defaults(): void
    {
        $normalizer = new IncidentCorrectionPayloadNormalizer;
        $deviceId = strtolower((string) Str::ulid());

        $this->assertSame([
            'deviceId' => $deviceId,
            'priority' => 'critical',
            'impact' => null,
            'title' => 'Café perangkat gagal',
            'blocksLaboratoryOperation' => true,
            'occurredAt' => '2026-08-29T03:00:00.123000Z',
        ], $normalizer->normalize([
            'deviceId' => strtoupper($deviceId),
            'priority' => ' CRITICAL ',
            'impact' => '   ',
            'title' => " Cafe\u{0301} perangkat gagal ",
            'blocksLaboratoryOperation' => true,
            'occurredAt' => '2026-08-29T10:00:00.123+07:00',
        ], new CarbonImmutable('2026-08-29T03:00:01.000000Z')));
    }

    public function test_invalid_types_bounds_enums_and_future_timestamp_are_rejected(): void
    {
        $normalizer = new IncidentCorrectionPayloadNormalizer;
        $receipt = new CarbonImmutable('2026-08-29T03:00:00.000000Z');

        foreach ([
            ['title' => true],
            ['title' => 'tiny'],
            ['priority' => 'urgent'],
            ['blocksLaboratoryOperation' => 1],
            ['occurredAt' => '2026-08-29T03:05:00.000001Z'],
        ] as $payload) {
            try {
                $normalizer->normalize($payload, $receipt);
                $this->fail('Expected invalid correction payload to be rejected.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_subject_lock_plan_is_unique_and_sorted_for_each_entity_family(): void
    {
        $laboratories = [strtolower((string) Str::ulid()), strtolower((string) Str::ulid())];
        rsort($laboratories, SORT_STRING);
        $devices = [strtolower((string) Str::ulid()), strtolower((string) Str::ulid())];
        rsort($devices, SORT_STRING);

        $plan = (new IncidentSubjectLockPlan)->build(
            $laboratories[0],
            $laboratories[1],
            $devices[0],
            $devices[1],
        );

        $expectedLaboratories = $laboratories;
        sort($expectedLaboratories, SORT_STRING);
        $expectedDevices = $devices;
        sort($expectedDevices, SORT_STRING);
        $this->assertSame($expectedLaboratories, $plan['laboratoryIds']);
        $this->assertSame($expectedDevices, $plan['deviceIds']);

        $deduplicated = (new IncidentSubjectLockPlan)->build(
            $laboratories[0],
            $laboratories[0],
            null,
            $devices[0],
        );
        $this->assertSame([$laboratories[0]], $deduplicated['laboratoryIds']);
        $this->assertSame([$devices[0]], $deduplicated['deviceIds']);
    }

    public function test_routing_pre_read_mismatch_fails_closed_as_a_version_conflict(): void
    {
        $originalLab = strtolower((string) Str::ulid());
        $originalDevice = strtolower((string) Str::ulid());
        $incident = new Incident([
            'laboratory_id' => $originalLab,
            'device_id' => $originalDevice,
            'laboratory_id_snapshot' => strtolower((string) Str::ulid()),
            'device_id_snapshot' => $originalDevice,
            'version' => 1,
        ]);

        try {
            (new IncidentRoutingEvidence($originalLab, $originalDevice, 1))->assertUnchanged($incident);
            $this->fail('Expected stale routing evidence to fail closed.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame(412, $exception->status);
            $this->assertSame('INCIDENT_VERSION_CONFLICT', $exception->errorCode);
        }
    }

    public function test_routing_evidence_accepts_snapshot_identity_when_live_foreign_keys_are_null(): void
    {
        $laboratoryId = strtolower((string) Str::ulid());
        $deviceId = strtolower((string) Str::ulid());
        $incident = new Incident([
            'laboratory_id' => null,
            'device_id' => null,
            'laboratory_id_snapshot' => $laboratoryId,
            'device_id_snapshot' => $deviceId,
            'version' => 1,
        ]);

        (new IncidentRoutingEvidence($laboratoryId, $deviceId, 1))->assertUnchanged($incident);

        $this->addToAssertionCount(1);
    }
}
