<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Models\Device;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\ManagesIncidentDatabaseTestFailures;
use Tests\TestCase;

class IncidentPersistenceSchemaTest extends TestCase
{
    use ManagesIncidentDatabaseTestFailures;
    use RefreshDatabase;

    public function test_stage_a_creates_only_the_four_locked_incident_tables_with_required_columns(): void
    {
        foreach (['incidents', 'incident_events', 'incident_number_sequences', 'incident_submissions'] as $table) {
            $this->assertTrue(Schema::hasTable($table));
        }
        $this->assertTrue(Schema::hasColumns('incidents', [
            'ticket_number', 'reporter_user_id_snapshot', 'laboratory_id_snapshot',
            'device_id_snapshot', 'assignee_user_id_snapshot', 'version', 'reported_at',
        ]));
        $this->assertTrue(Schema::hasColumns('incident_events', [
            'incident_id_snapshot', 'actor_membership_id_snapshot', 'event_type',
            'incident_version_before', 'incident_version_after', 'payload',
        ]));
        $this->assertFalse(Schema::hasColumn('incidents', 'work_order_id'));
        $this->assertFalse(Schema::hasColumn('incidents', 'asset_id'));
        $this->assertFalse(Schema::hasColumn('incidents', 'waiting_spare_part'));
    }

    public function test_database_rejects_invalid_fingerprint_shape_and_event_version_pair(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $incident = $this->createIncident($context, $laboratory);

        $this->assertDatabaseOperationIsRejected(
            function () use ($context, $laboratory): void {
                DB::table('incident_submissions')->insert([
                    'school_id' => $laboratory->school_id,
                    'reporter_user_id_snapshot' => $context->membership->user_id,
                    'submission_id' => strtolower((string) Str::uuid()),
                    'payload_fingerprint' => str_repeat('G', 64),
                    'payload_fingerprint_version' => 1,
                    'incident_id' => null,
                    'created_at' => now(),
                ]);
            },
            'Expected invalid fingerprint rejection.',
        );
        $this->assertDatabaseCount('incident_submissions', 1);

        $event = IncidentEvent::query()->sole()->getAttributes();
        $event['id'] = strtolower((string) Str::ulid());
        $event['incident_version_before'] = 1;
        $event['incident_version_after'] = 3;
        $event['event_type'] = 'incident.updated';
        $event['payload'] = json_encode(['changedFields' => ['title'], 'before' => ['title' => 'A'], 'after' => ['title' => 'B']], JSON_THROW_ON_ERROR);

        $this->expectException(QueryException::class);
        DB::table('incident_events')->insert($event);
    }

    public function test_live_device_delete_nulls_reference_but_preserves_historical_snapshots(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $device = Device::factory()->create([
            'school_id' => $laboratory->school_id,
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-HISTORY-01',
        ]);
        $incident = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory, $device),
        )->incident;

        $device->delete();
        $incident->refresh();

        $this->assertNull($incident->device_id);
        $this->assertSame($device->id, $incident->device_id_snapshot);
        $this->assertSame('PC-HISTORY-01', $incident->device_code_snapshot);
    }

    #[DataProvider('degradedAssigneeStatusProvider')]
    public function test_live_assignee_delete_allows_snapshot_backed_degraded_operational_state(
        string $status,
        bool $inProgress,
    ): void {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $incident = $this->createIncident($context, $laboratory);
        $assigneeUser = User::factory()->create(['name' => 'Teknisi Snapshot']);
        $assignee = SchoolMembership::factory()->create([
            'school_id' => $laboratory->school_id,
            'user_id' => $assigneeUser->id,
            'status' => 'active',
        ]);
        $effectiveAt = now()->subMinute();

        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => $status,
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => $effectiveAt,
            'assignee_membership_id' => $assignee->id,
            'assignee_user_id_snapshot' => $assigneeUser->id,
            'assignee_name_snapshot' => $assigneeUser->name,
            'assigned_at' => $effectiveAt,
            'started_at' => $inProgress ? $effectiveAt : null,
        ]);

        $assigneeId = $assignee->id;
        $assignee->delete();

        $incident->refresh();
        $this->assertSame($status, $incident->status->value);
        $this->assertNull($incident->assignee_membership_id);
        $this->assertSame($assigneeUser->id, $incident->assignee_user_id_snapshot);
        $this->assertSame('Teknisi Snapshot', $incident->assignee_name_snapshot);
        $this->assertNotNull($incident->assigned_at);
        $this->assertSame($inProgress, $incident->started_at !== null);
        $this->assertDatabaseMissing('school_memberships', ['id' => $assigneeId]);
    }

    public static function degradedAssigneeStatusProvider(): array
    {
        return [
            'assigned' => ['assigned', false],
            'in_progress' => ['in_progress', true],
        ];
    }

    public function test_school_delete_and_incident_delete_are_restricted(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $incident = $this->createIncident($context, $laboratory);

        $this->assertDatabaseOperationIsRejected(
            fn () => $laboratory->school->forceDelete(),
            'Expected School deletion to be restricted.',
        );
        $this->assertDatabaseCount('incidents', 1);

        $this->expectException(\LogicException::class);
        $incident->delete();
    }

    /** @return array{CurrentMembershipContext, Laboratory} */
    private function contextAndLaboratory(): array
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->setRelation('user', $user);
        $context = new CurrentMembershipContext($membership, collect());
        $laboratory = Laboratory::factory()->create(['school_id' => $school->id]);
        $laboratory->setRelation('school', $school);

        return [$context, $laboratory];
    }

    private function createIncident(CurrentMembershipContext $context, Laboratory $laboratory): Incident
    {
        return app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory),
        )->incident;
    }

    /** @return array<string, mixed> */
    private function payload(Laboratory $laboratory, ?Device $device = null): array
    {
        return [
            'laboratoryId' => $laboratory->id,
            'deviceId' => $device?->id,
            'category' => 'hardware',
            'priority' => 'normal',
            'title' => 'Desktop gagal menyala',
            'description' => 'Desktop berhenti sebelum sistem operasi dimuat.',
            'impact' => null,
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => null,
            'occurredAt' => now()->subMinute()->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ];
    }
}
