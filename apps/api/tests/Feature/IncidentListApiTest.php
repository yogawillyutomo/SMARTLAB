<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Models\Device;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentListApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_list_requires_authentication_and_exact_view_permission(): void
    {
        $this->getJson('/api/v1/incidents')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $this->authenticateWithPermissions([]);
        $this->getJson('/api/v1/incidents')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_visibility_is_reporter_user_based_and_view_all_stays_tenant_scoped(): void
    {
        [$viewer, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $laboratory = Laboratory::factory()->for($school)->create();
        $own = $this->createIncidentFor([$viewer, $membership], $laboratory, null, ['title' => 'Insiden milik sendiri']);
        $other = $this->createIncidentFor($this->reporter($school), $laboratory, null, ['title' => 'Insiden reporter lain']);
        $otherSchool = School::factory()->create();
        $crossSchool = $this->createIncidentFor(
            $this->reporter($otherSchool),
            Laboratory::factory()->for($otherSchool)->create(),
        );

        $response = $this->getJson('/api/v1/incidents')->assertOk();
        $this->assertSame([$own->id], array_column($response->json('data'), 'id'));
        $response->assertJsonPath('meta.total', 1);

        $this->grantPermissions($membership, ['incidents.view-all']);
        $response = $this->getJson('/api/v1/incidents')->assertOk();
        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($own->id, $ids);
        $this->assertContains($other->id, $ids);
        $this->assertNotContains($crossSchool->id, $ids);
        $response->assertJsonPath('meta.total', 2);
    }

    public function test_replacement_membership_for_same_user_preserves_own_list_visibility(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $original = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $incident = $this->createIncidentFor(
            [$user, $original],
            Laboratory::factory()->for($school)->create(),
        );
        $original->delete();
        $replacement = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($replacement, ['incidents.view']);
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/incidents')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $incident->id);
    }

    public function test_list_has_exact_narrow_snapshot_projection_and_survives_live_record_changes(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        [$reporter, $reporterMembership] = $this->reporter($school);
        $reporterName = $reporter->name;
        $laboratory = Laboratory::factory()->for($school)->create([
            'code' => 'LAB-SNAPSHOT',
            'name' => 'Laboratorium Snapshot',
        ]);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'DEV-SNAPSHOT',
            'device_type' => 'desktop_pc',
        ]);
        $incident = $this->createIncidentFor([$reporter, $reporterMembership], $laboratory, $device);
        $assignee = User::factory()->create(['name' => 'Teknisi Snapshot']);
        $assigneeMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $assignee->id,
            'status' => 'active',
        ]);
        $this->setIncidentStatus($incident, 'resolved', $assigneeMembership);
        $assigneeMembership->delete();
        $reporter->update(['name' => 'Reporter Baru']);
        $laboratory->update(['code' => 'LAB-BARU', 'name' => 'Nama Baru', 'status' => 'inactive']);
        $device->update(['device_code' => 'DEV-BARU', 'lifecycle_status' => 'retired']);
        $device->delete();
        $laboratory->delete();

        $data = $this->getJson('/api/v1/incidents')->assertOk()->json('data.0');
        $this->assertSame([
            'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority',
            'title', 'blocksLaboratoryOperation', 'status', 'assignee', 'version', 'occurredAt', 'reportedAt',
        ], array_keys($data));
        $this->assertSame(['userId', 'name'], array_keys($data['reporter']));
        $this->assertSame(['id', 'code', 'name'], array_keys($data['laboratory']));
        $this->assertSame(['id', 'deviceCode', 'deviceType'], array_keys($data['device']));
        $this->assertSame(['userId', 'name'], array_keys($data['assignee']));
        $this->assertSame($reporterName, $data['reporter']['name']);
        $this->assertSame('LAB-SNAPSHOT', $data['laboratory']['code']);
        $this->assertSame('DEV-SNAPSHOT', $data['device']['deviceCode']);
        $this->assertSame('Teknisi Snapshot', $data['assignee']['name']);
        $this->assertArrayNotHasKey('membershipId', $data['assignee']);

        $serialized = json_encode($data, JSON_THROW_ON_ERROR);
        foreach (['description', 'impact', 'stepsTaken', 'triageSummary', 'resolutionSummary', 'createdAt', 'updatedAt', 'events'] as $forbidden) {
            $this->assertStringNotContainsString('"'.$forbidden.'"', $serialized);
        }
    }

    public function test_list_emits_null_device_and_assignee_projections(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $this->createIncidentFor([$user, $membership], Laboratory::factory()->for($school)->create());

        $this->getJson('/api/v1/incidents')
            ->assertOk()
            ->assertJsonPath('data.0.device', null)
            ->assertJsonPath('data.0.assignee', null)
            ->assertJsonPath('data.0.version', 1);
    }

    public function test_all_filters_and_inclusive_reported_range_use_root_authority(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $laboratory = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $assignee = SchoolMembership::factory()->create(['school_id' => $school->id, 'status' => 'active']);
        $statuses = ['reported', 'triaged', 'assigned', 'in_progress', 'resolved', 'verified', 'closed', 'rejected'];
        $incidents = [];

        foreach ($statuses as $index => $status) {
            $incident = $this->createIncidentFor(
                $this->reporter($school),
                $laboratory,
                $index === 2 ? $device : null,
                ['priority' => $index === 2 ? 'critical' : 'normal', 'category' => $index === 2 ? 'network' : 'hardware'],
            );
            $this->setIncidentStatus($incident, $status, in_array($status, ['assigned', 'in_progress'], true) ? $assignee : null);
            $reportedAt = now()->subMinutes(20 - $index)->utc();
            DB::table('incidents')->where('id', $incident->id)->update(['reported_at' => $reportedAt]);
            $incidents[$status] = $incident->fresh();
        }

        foreach ($statuses as $status) {
            $this->getJson('/api/v1/incidents?status='.$status)
                ->assertOk()
                ->assertJsonPath('meta.total', 1)
                ->assertJsonPath('data.0.id', $incidents[$status]->id);
        }

        $target = $incidents['assigned'];
        foreach ([
            'priority=critical',
            'category=network',
            'laboratoryId='.$laboratory->id,
            'deviceId='.$device->id,
            'assigneeMembershipId='.$assignee->id,
        ] as $filter) {
            $response = $this->getJson('/api/v1/incidents?'.$filter)->assertOk();
            $this->assertContains($target->id, array_column($response->json('data'), 'id'));
        }

        $boundary = $target->reported_at->utc()->format('Y-m-d\TH:i:s.u\Z');
        $this->getJson('/api/v1/incidents?'.http_build_query(['reportedFrom' => $boundary, 'reportedTo' => $boundary]))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $target->id);
    }

    public function test_valid_cross_school_foreign_filters_return_empty_without_disclosure(): void
    {
        $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $otherSchool = School::factory()->create();
        $otherLaboratory = Laboratory::factory()->for($otherSchool)->create();
        $otherDevice = Device::factory()->for($otherSchool)->create(['home_laboratory_id' => $otherLaboratory->id]);
        $otherMembership = SchoolMembership::factory()->create(['school_id' => $otherSchool->id]);

        foreach (['laboratoryId' => $otherLaboratory->id, 'deviceId' => $otherDevice->id, 'assigneeMembershipId' => $otherMembership->id] as $field => $id) {
            $this->getJson('/api/v1/incidents?'.http_build_query([$field => $id]))
                ->assertOk()
                ->assertExactJson(['data' => [], 'meta' => ['page' => 1, 'perPage' => 25, 'total' => 0, 'lastPage' => 1]]);
        }
    }

    public function test_search_uses_only_allowed_snapshot_columns_and_escapes_wildcards(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $laboratory = Laboratory::factory()->for($school)->create(['code' => 'LAB-SEARCH']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'DEV-SEARCH',
            'hostname' => 'HOST-SECRET',
            'serial_number' => 'SERIAL-SECRET',
        ]);
        $incident = $this->createIncidentFor($this->reporter($school), $laboratory, $device, [
            'title' => 'Router unik %_\\ gagal',
            'description' => 'DESKRIPSI-RAHASIA tidak boleh menjadi hasil pencarian.',
        ]);

        foreach ([$incident->ticket_number, 'Router unik', 'LAB-SEARCH', 'DEV-SEARCH', '%_\\'] as $search) {
            $this->getJson('/api/v1/incidents?'.http_build_query(['search' => $search]))
                ->assertOk()
                ->assertJsonPath('meta.total', 1);
        }
        foreach (['DESKRIPSI-RAHASIA', 'HOST-SECRET', 'SERIAL-SECRET'] as $search) {
            $this->getJson('/api/v1/incidents?'.http_build_query(['search' => $search]))
                ->assertOk()
                ->assertJsonPath('meta.total', 0);
        }
        foreach (['%', '_', '\\'] as $search) {
            $this->getJson('/api/v1/incidents?'.http_build_query(['search' => 'XX'.$search]))
                ->assertOk()
                ->assertJsonPath('meta.total', 0);
        }
    }

    public function test_pagination_order_validation_and_scoped_metadata_are_exact(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $laboratory = Laboratory::factory()->for($school)->create();
        $sameTime = now()->subHour()->utc();
        $created = collect(range(1, 3))->map(function () use ($school, $laboratory, $sameTime): Incident {
            $incident = $this->createIncidentFor($this->reporter($school), $laboratory);
            DB::table('incidents')->where('id', $incident->id)->update(['reported_at' => $sameTime]);

            return $incident->fresh();
        });

        $response = $this->getJson('/api/v1/incidents?perPage=2&page=1')->assertOk();
        $this->assertSame($created->pluck('id')->sortDesc()->take(2)->values()->all(), array_column($response->json('data'), 'id'));
        $response->assertExactJson([
            'data' => $response->json('data'),
            'meta' => ['page' => 1, 'perPage' => 2, 'total' => 3, 'lastPage' => 2],
        ]);

        foreach (['page=0', 'perPage=0', 'perPage=101', 'search=x', 'status=unknown', 'laboratoryId=bad', 'reportedFrom=not-a-date', 'unknown=value'] as $query) {
            $this->getJson('/api/v1/incidents?'.$query)->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        }
        $this->getJson('/api/v1/incidents?'.http_build_query([
            'reportedFrom' => '2026-08-30T12:00:00Z',
            'reportedTo' => '2026-08-30T11:59:59Z',
        ]))->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_list_is_incident_event_free_bounded_and_side_effect_free(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $laboratory = Laboratory::factory()->for($school)->create();
        collect(range(1, 4))->each(fn () => $this->createIncidentFor($this->reporter($school), $laboratory));
        $before = Incident::query()->get(['id', 'version', 'updated_at'])->keyBy('id')->toArray();
        $eventCount = IncidentEvent::query()->count();
        $queries = [];
        DB::listen(function ($query) use (&$queries): void {
            $queries[] = strtolower($query->sql);
        });

        $this->getJson('/api/v1/incidents')->assertOk()->assertJsonPath('meta.total', 4);

        $incidentQueries = array_values(array_filter($queries, fn (string $sql): bool => str_contains($sql, '"incidents"') || str_contains($sql, '`incidents`')));
        $this->assertCount(2, $incidentQueries);
        $this->assertSame([], array_values(array_filter($queries, fn (string $sql): bool => str_contains($sql, 'incident_events'))));
        $this->assertSame($eventCount, IncidentEvent::query()->count());
        $this->assertSame($before, Incident::query()->get(['id', 'version', 'updated_at'])->keyBy('id')->toArray());
    }

    /** @return array{User, School, SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($membership, $permissions);
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @param list<string> $permissions */
    private function grantPermissions(SchoolMembership $membership, array $permissions): void
    {
        if ($permissions === []) {
            return;
        }
        $role = Role::factory()->create();
        $permissionIds = collect($permissions)->map(fn (string $key): string => Permission::query()->firstOrCreate(
            ['key' => $key],
            ['name' => $key],
        )->id);
        $membership->roles()->attach($role->id);
        $role->permissions()->attach($permissionIds);
    }

    /** @return array{User, SchoolMembership} */
    private function reporter(School $school): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        return [$user, $membership];
    }

    /** @param array{User, SchoolMembership} $reporter @param array<string, mixed> $overrides */
    private function createIncidentFor(array $reporter, Laboratory $laboratory, ?Device $device = null, array $overrides = []): Incident
    {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);
        $context = new CurrentMembershipContext($membership, collect());

        return app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            array_replace([
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
            ], $overrides),
        )->incident;
    }

    private function setIncidentStatus(Incident $incident, string $status, ?SchoolMembership $assignee = null): void
    {
        $attributes = ['status' => $status, 'version' => 2, 'updated_at' => now()];
        if (in_array($status, ['triaged', 'assigned', 'in_progress', 'resolved', 'verified', 'closed'], true)) {
            $attributes += ['triage_summary' => 'Triage selesai.', 'triaged_at' => now()->subMinutes(5)];
        }
        if (in_array($status, ['assigned', 'in_progress'], true) || $assignee !== null) {
            $assignee ??= SchoolMembership::factory()->create(['school_id' => $incident->school_id, 'status' => 'active']);
            $attributes += [
                'assignee_membership_id' => $assignee->id,
                'assignee_user_id_snapshot' => $assignee->user_id,
                'assignee_name_snapshot' => $assignee->user->name,
                'assigned_at' => now()->subMinutes(4),
            ];
        }
        if ($status === 'in_progress') {
            $attributes['started_at'] = now()->subMinutes(3);
        }
        if (in_array($status, ['resolved', 'verified', 'closed'], true)) {
            $attributes += ['resolution_summary' => 'Masalah sudah diselesaikan.', 'resolved_at' => now()->subMinutes(2)];
        }
        if (in_array($status, ['verified', 'closed'], true)) {
            $attributes += ['verification_note' => 'Hasil telah diverifikasi.', 'verified_at' => now()->subMinute()];
        }
        if ($status === 'closed') {
            $attributes['closed_at'] = now();
        }
        if ($status === 'rejected') {
            $attributes += ['rejection_reason' => 'Laporan tidak dapat diproses.', 'rejected_at' => now()];
        }
        DB::table('incidents')->where('id', $incident->id)->update($attributes);
    }
}
