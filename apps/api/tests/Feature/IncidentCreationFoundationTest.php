<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentStatus;
use App\Models\Device;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use LogicException;
use Tests\Concerns\ManagesIncidentDatabaseTestFailures;
use Tests\TestCase;

class IncidentCreationFoundationTest extends TestCase
{
    use ManagesIncidentDatabaseTestFailures;
    use RefreshDatabase;

    public function test_create_foundation_commits_reported_incident_submission_and_typed_event_atomically(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $device = Device::factory()->create([
            'school_id' => $laboratory->school_id,
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-UAT-001',
            'device_type' => 'desktop_pc',
            'lifecycle_status' => 'in_service',
        ]);

        $result = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory, ['deviceId' => $device->id]),
        );

        $incident = $result->incident->fresh();
        $this->assertFalse($result->wasExistingSubmission);
        $this->assertSame(1, $incident->version);
        $this->assertSame(IncidentStatus::Reported, $incident->status);
        $this->assertSame($context->membership->user_id, $incident->reporter_user_id_snapshot);
        $this->assertSame($context->membership->id, $incident->reporter_membership_id_snapshot);
        $this->assertSame($laboratory->id, $incident->laboratory_id_snapshot);
        $this->assertSame($laboratory->code, $incident->laboratory_code_snapshot);
        $this->assertSame($device->id, $incident->device_id_snapshot);
        $this->assertMatchesRegularExpression('/^INC-\d{4}-000001$/', $incident->ticket_number);

        $event = IncidentEvent::query()->sole();
        $this->assertSame(IncidentEventType::Reported, $event->event_type);
        $this->assertSame(0, $event->incident_version_before);
        $this->assertSame(1, $event->incident_version_after);
        $this->assertSame($context->membership->user->name, $event->actor_name_snapshot);
        $this->assertSame($device->device_code, $event->payload['device']['deviceCode']);
        $this->assertDatabaseCount('incident_submissions', 1);
        $this->assertDatabaseHas('incident_submissions', [
            'incident_id' => $incident->id,
            'payload_fingerprint_version' => 1,
        ]);
    }

    public function test_laboratory_only_incident_uses_all_null_device_snapshot(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();

        $incident = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory),
        )->incident;

        $this->assertNull($incident->device_id);
        $this->assertNull($incident->device_id_snapshot);
        $this->assertNull($incident->device_code_snapshot);
        $this->assertNull($incident->device_type_snapshot);
        $this->assertNull(IncidentEvent::query()->sole()->payload['device']);
    }

    public function test_equivalent_duplicate_returns_same_incident_without_second_ticket_or_event(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $submissionId = strtolower((string) Str::uuid());
        $implicit = $this->payload($laboratory);
        $occurredAt = now()->subMinute()->startOfSecond();
        $implicit['occurredAt'] = $occurredAt->utc()->format('Y-m-d\TH:i:s.u\Z');
        unset($implicit['priority'], $implicit['blocksLaboratoryOperation']);
        $implicit['impact'] = '';
        $explicit = array_reverse($this->payload($laboratory), true);
        $explicit['occurredAt'] = $occurredAt->setTimezone('Asia/Jakarta')->format('Y-m-d\TH:i:sP');

        $first = app(IncidentCreationService::class)->create($context, $submissionId, $implicit);
        $second = app(IncidentCreationService::class)->create($context, $submissionId, $explicit);

        $this->assertFalse($first->wasExistingSubmission);
        $this->assertTrue($second->wasExistingSubmission);
        $this->assertSame($first->incident->id, $second->incident->id);
        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertSame(1, DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_reused_submission_with_material_change_returns_stable_conflict_without_consuming_ticket(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $submissionId = strtolower((string) Str::uuid());
        $service = app(IncidentCreationService::class);
        $service->create($context, $submissionId, $this->payload($laboratory));

        try {
            $service->create($context, $submissionId, $this->payload($laboratory, ['priority' => 'critical']));
            $this->fail('Expected submission conflict.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_SUBMISSION_CONFLICT', $exception->errorCode);
        }

        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertSame(1, DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_same_submission_uuid_is_independent_for_another_reporter_and_school(): void
    {
        [$firstContext, $firstLaboratory] = $this->contextAndLaboratory();
        $sameSchoolContext = $this->context($firstLaboratory->school);
        [$otherSchoolContext, $otherLaboratory] = $this->contextAndLaboratory();
        $submissionId = strtolower((string) Str::uuid());
        $service = app(IncidentCreationService::class);

        $a = $service->create($firstContext, $submissionId, $this->payload($firstLaboratory));
        $b = $service->create($sameSchoolContext, $submissionId, $this->payload($firstLaboratory));
        $c = $service->create($otherSchoolContext, $submissionId, $this->payload($otherLaboratory));

        $this->assertNotSame($a->incident->id, $b->incident->id);
        $this->assertNotSame($a->incident->id, $c->incident->id);
        $this->assertDatabaseCount('incidents', 3);
        $this->assertDatabaseCount('incident_events', 3);
        $this->assertDatabaseCount('incident_submissions', 3);
    }

    public function test_device_with_a_different_home_laboratory_is_rejected(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $wrongHome = Laboratory::factory()->create(['school_id' => $laboratory->school_id]);
        $device = Device::factory()->create([
            'school_id' => $laboratory->school_id,
            'home_laboratory_id' => $wrongHome->id,
        ]);
        $submissionId = strtolower((string) Str::uuid());

        try {
            app(IncidentCreationService::class)->create(
                $context,
                $submissionId,
                $this->payload($laboratory, ['deviceId' => $device->id]),
            );
            $this->fail('Expected Device eligibility failure.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_DEVICE_NOT_ELIGIBLE', $exception->errorCode);
        }

        $this->assertNoIncidentCreationArtifacts($submissionId);
    }

    public function test_inactive_laboratory_does_not_commit_incident_artifacts(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $laboratory->update(['status' => 'inactive']);
        $submissionId = strtolower((string) Str::uuid());

        try {
            app(IncidentCreationService::class)->create(
                $context,
                $submissionId,
                $this->payload($laboratory),
            );
            $this->fail('Expected Laboratory eligibility failure.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_LABORATORY_INELIGIBLE', $exception->errorCode);
        }

        $this->assertNoIncidentCreationArtifacts($submissionId);
    }

    public function test_cross_school_laboratory_is_rejected_without_committing_incident_artifacts(): void
    {
        [$context] = $this->contextAndLaboratory();
        $otherSchool = School::factory()->create();
        $crossSchoolLaboratory = Laboratory::factory()->create([
            'school_id' => $otherSchool->id,
            'status' => 'active',
        ]);
        $submissionId = strtolower((string) Str::uuid());

        try {
            app(IncidentCreationService::class)->create(
                $context,
                $submissionId,
                $this->payload($crossSchoolLaboratory),
            );
            $this->fail('Expected cross-School Laboratory rejection.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_LABORATORY_INELIGIBLE', $exception->errorCode);
        }

        $this->assertNoIncidentCreationArtifacts($submissionId);
    }

    public function test_cross_school_device_is_rejected_without_committing_incident_artifacts(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $otherSchool = School::factory()->create();
        $otherLaboratory = Laboratory::factory()->create([
            'school_id' => $otherSchool->id,
            'status' => 'active',
        ]);
        $crossSchoolDevice = Device::factory()->create([
            'school_id' => $otherSchool->id,
            'home_laboratory_id' => $otherLaboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $submissionId = strtolower((string) Str::uuid());

        try {
            app(IncidentCreationService::class)->create(
                $context,
                $submissionId,
                $this->payload($laboratory, ['deviceId' => $crossSchoolDevice->id]),
            );
            $this->fail('Expected cross-School Device rejection.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_DEVICE_NOT_ELIGIBLE', $exception->errorCode);
        }

        $this->assertNoIncidentCreationArtifacts($submissionId);
    }

    public function test_retired_device_is_rejected_without_committing_incident_artifacts(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $device = Device::factory()->create([
            'school_id' => $laboratory->school_id,
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'retired',
        ]);
        $submissionId = strtolower((string) Str::uuid());

        try {
            app(IncidentCreationService::class)->create(
                $context,
                $submissionId,
                $this->payload($laboratory, ['deviceId' => $device->id]),
            );
            $this->fail('Expected retired Device rejection.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_DEVICE_NOT_ELIGIBLE', $exception->errorCode);
        }

        $this->assertNoIncidentCreationArtifacts($submissionId);
    }

    public function test_spare_device_with_matching_home_laboratory_is_eligible(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $device = Device::factory()->create([
            'school_id' => $laboratory->school_id,
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'spare',
        ]);

        $incident = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory, ['deviceId' => $device->id]),
        )->incident;

        $this->assertSame($device->id, $incident->device_id_snapshot);
        $this->assertSame($device->device_code, IncidentEvent::query()->sole()->payload['device']['deviceCode']);
    }

    public function test_primitive_rejects_forged_authority_fields_and_noncanonical_submission_id(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $payload = $this->payload($laboratory, ['schoolId' => strtolower((string) Str::ulid())]);

        try {
            app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $payload);
            $this->fail('Expected forged authority field rejection.');
        } catch (InvalidArgumentException) {
            $this->assertDatabaseCount('incident_submissions', 0);
        }

        $this->expectException(InvalidArgumentException::class);
        app(IncidentCreationService::class)->create(
            $context,
            strtoupper((string) Str::uuid()),
            $this->payload($laboratory),
        );
    }

    public function test_failure_after_ticket_allocation_rolls_back_submission_sequence_incident_and_event(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();

        try {
            $this->installIncidentEventInsertFailureTrigger();
            $this->assertIncidentEventInsertFailureIsRejected(
                fn () => app(IncidentCreationService::class)->create(
                    $context,
                    strtolower((string) Str::uuid()),
                    $this->payload($laboratory),
                ),
                'Expected forced persistence failure.',
            );
            $this->assertDatabaseCount('incident_submissions', 0);
            $this->assertDatabaseCount('incident_number_sequences', 0);
            $this->assertDatabaseCount('incidents', 0);
            $this->assertDatabaseCount('incident_events', 0);
        } finally {
            $this->removeIncidentEventInsertFailureTrigger();
        }
    }

    public function test_incident_event_model_rejects_update_and_delete(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();

        try {
            $event->update(['actor_name_snapshot' => 'Changed']);
            $this->fail('Expected immutable update rejection.');
        } catch (LogicException) {
            $this->assertSame(1, IncidentEvent::query()->count());
        }

        $this->expectException(LogicException::class);
        $event->delete();
    }

    public function test_database_rejects_partial_device_snapshot_and_arbitrary_event_type(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $incident = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory),
        )->incident;

        $this->assertDatabaseOperationIsRejected(
            fn () => DB::table('incidents')->where('id', $incident->id)->update(['device_id_snapshot' => strtolower((string) Str::ulid())]),
            'Expected partial Device snapshot rejection.',
        );
        $this->assertNull($incident->fresh()->device_id_snapshot);

        $event = IncidentEvent::query()->sole()->getAttributes();
        $event['id'] = strtolower((string) Str::ulid());
        $event['event_type'] = 'incident.arbitrary';
        unset($event['updated_at']);
        $this->expectException(QueryException::class);
        DB::table('incident_events')->insert($event);
    }

    /** @return array{CurrentMembershipContext, Laboratory} */
    private function contextAndLaboratory(): array
    {
        $school = School::factory()->create();
        $context = $this->context($school);
        $laboratory = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'active']);

        return [$context, $laboratory];
    }

    private function context(School $school): CurrentMembershipContext
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->setRelation('user', $user);

        return new CurrentMembershipContext($membership, collect());
    }

    private function assertNoIncidentCreationArtifacts(string $submissionId): void
    {
        $this->assertDatabaseMissing('incident_submissions', ['submission_id' => $submissionId]);
        $this->assertDatabaseCount('incident_submissions', 0);
        $this->assertDatabaseCount('incident_number_sequences', 0);
        $this->assertDatabaseCount('incidents', 0);
        $this->assertDatabaseCount('incident_events', 0);
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function payload(Laboratory $laboratory, array $overrides = []): array
    {
        return array_replace([
            'laboratoryId' => $laboratory->id,
            'deviceId' => null,
            'category' => 'hardware',
            'priority' => 'normal',
            'title' => 'Desktop gagal menyala',
            'description' => 'Desktop berhenti sebelum sistem operasi dimuat.',
            'impact' => null,
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => null,
            'occurredAt' => now()->subMinute()->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ], $overrides);
    }
}
