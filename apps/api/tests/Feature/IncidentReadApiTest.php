<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Incident\IncidentEventRecorder;
use App\Domain\Incident\IncidentEventType;
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
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class IncidentReadApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_rejected(): void
    {
        $this->getJson('/api/v1/incidents/'.strtolower((string) Str::ulid()))
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_active_member_without_view_permission_is_forbidden(): void
    {
        [, $school] = $this->authenticateWithPermissions([]);
        $incident = $this->createIncidentFor($this->reporter($school), Laboratory::factory()->for($school)->create());

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);
    }

    public function test_member_with_view_can_read_own_reported_incident(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.id', $incident->id)
            ->assertJsonPath('data.reporter.userId', $user->id);
    }

    public function test_unknown_cross_school_and_same_school_non_visible_incidents_share_exact_safe_404(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view']);
        $sameSchoolIncident = $this->createIncidentFor(
            $this->reporter($school),
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $otherSchool = School::factory()->create();
        $crossSchoolIncident = $this->createIncidentFor(
            $this->reporter($otherSchool),
            Laboratory::factory()->for($otherSchool)->create(['status' => 'active']),
        );

        $expected = [
            'message' => 'Incident not found.',
            'code' => 'INCIDENT_NOT_FOUND',
        ];

        $sameSchool = $this->getJson('/api/v1/incidents/'.$sameSchoolIncident->id)
            ->assertNotFound()
            ->assertExactJson($expected);
        $crossSchool = $this->getJson('/api/v1/incidents/'.$crossSchoolIncident->id)
            ->assertNotFound()
            ->assertExactJson($expected);
        $unknown = $this->getJson('/api/v1/incidents/'.strtolower((string) Str::ulid()))
            ->assertNotFound()
            ->assertExactJson($expected);

        $this->assertSame($sameSchool->json(), $crossSchool->json());
        $this->assertSame($sameSchool->json(), $unknown->json());
    }

    public function test_view_all_expands_visibility_only_inside_the_current_school(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $incident = $this->createIncidentFor(
            $this->reporter($school),
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertOk()
            ->assertJsonPath('data.id', $incident->id);

        $otherSchool = School::factory()->create();
        $crossSchool = $this->createIncidentFor(
            $this->reporter($otherSchool),
            Laboratory::factory()->for($otherSchool)->create(['status' => 'active']),
        );
        $this->getJson('/api/v1/incidents/'.$crossSchool->id)
            ->assertNotFound()
            ->assertJsonPath('code', 'INCIDENT_NOT_FOUND');
    }

    #[DataProvider('nonVisibilityPermissionProvider')]
    public function test_other_incident_capabilities_do_not_expand_row_visibility(string $permission): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', $permission]);
        $incident = $this->createIncidentFor(
            $this->reporter($school),
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertNotFound()
            ->assertExactJson([
                'message' => 'Incident not found.',
                'code' => 'INCIDENT_NOT_FOUND',
            ]);
    }

    public static function nonVisibilityPermissionProvider(): array
    {
        return [
            'history' => ['incidents.view-history'],
            'update' => ['incidents.update'],
            'assign' => ['incidents.assign'],
            'approve' => ['incidents.approve'],
            'comment' => ['incidents.comment'],
        ];
    }

    public function test_replacement_membership_for_the_same_user_preserves_reporter_visibility(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $originalMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $incident = $this->createIncidentFor(
            [$user, $originalMembership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        $originalMembership->delete();

        $replacement = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($replacement, ['incidents.view']);
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertOk()
            ->assertJsonPath('data.reporter.userId', $user->id);

        $otherUser = User::factory()->create();
        $otherMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $otherUser->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($otherMembership, ['incidents.view']);
        Sanctum::actingAs($otherUser);

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertNotFound()
            ->assertJsonPath('code', 'INCIDENT_NOT_FOUND');
    }

    public function test_detail_uses_exact_snapshot_dto_after_live_records_change(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        [$reporter, $reporterMembership] = $this->reporter($school);
        $laboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-SNAPSHOT',
            'name' => 'Laboratorium Snapshot',
        ]);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-SNAPSHOT',
            'device_type' => 'desktop_pc',
            'lifecycle_status' => 'in_service',
        ]);
        $assignee = User::factory()->create(['name' => 'Teknisi Saat Ditugaskan']);
        $assigneeMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $assignee->id,
            'status' => 'active',
        ]);

        $reporterOriginalName = $reporter->name;
        $incident = $this->createIncidentFor([$reporter, $reporterMembership], $laboratory, $device);
        $triagedAt = now()->subMinutes(2);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'assigned',
            'triage_summary' => 'Perlu pemeriksaan teknis.',
            'triaged_at' => $triagedAt,
            'assignee_membership_id' => $assigneeMembership->id,
            'assignee_user_id_snapshot' => $assignee->id,
            'assignee_name_snapshot' => $assignee->name,
            'assigned_at' => now()->subMinute(),
            'version' => 12,
            'updated_at' => now(),
        ]);

        $reporter->update(['name' => 'Nama Reporter Baru']);
        $laboratory->update(['code' => 'LAB-RENAMED', 'name' => 'Laboratorium Baru']);
        $device->update(['device_code' => 'PC-RENAMED', 'device_type' => 'laptop']);
        $assignee->update(['name' => 'Nama Teknisi Baru']);
        $device->delete();

        $response = $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertOk()
            ->assertHeader('ETag', '"12"');

        $response
            ->assertJsonPath('data.reporter.userId', $reporter->id)
            ->assertJsonPath('data.reporter.name', $reporterOriginalName)
            ->assertJsonPath('data.laboratory.id', $laboratory->id)
            ->assertJsonPath('data.laboratory.code', 'LAB-SNAPSHOT')
            ->assertJsonPath('data.laboratory.name', 'Laboratorium Snapshot')
            ->assertJsonPath('data.device.id', $device->id)
            ->assertJsonPath('data.device.deviceCode', 'PC-SNAPSHOT')
            ->assertJsonPath('data.device.deviceType', 'desktop_pc')
            ->assertJsonPath('data.assignee.membershipId', $assigneeMembership->id)
            ->assertJsonPath('data.assignee.userId', $assignee->id)
            ->assertJsonPath('data.assignee.name', 'Teknisi Saat Ditugaskan');

        $this->assertNull($incident->fresh()->device_id);
    }

    public function test_detail_has_exact_keys_null_projections_and_no_internal_field_leakage(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $response = $this->getJson('/api/v1/incidents/'.$incident->id)->assertOk();
        $data = $response->json('data');

        $this->assertSame([
            'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority',
            'title', 'description', 'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'status',
            'assignee', 'triageSummary', 'resolutionSummary', 'rejectionReason', 'verificationNote',
            'version', 'occurredAt', 'reportedAt', 'triagedAt', 'assignedAt', 'startedAt',
            'resolvedAt', 'verifiedAt', 'closedAt', 'rejectedAt', 'createdAt', 'updatedAt',
        ], array_keys($data));
        $this->assertSame(['userId', 'name'], array_keys($data['reporter']));
        $this->assertSame(['id', 'code', 'name'], array_keys($data['laboratory']));
        $this->assertNull($data['device']);
        $this->assertNull($data['assignee']);

        $serialized = json_encode($response->json(), JSON_THROW_ON_ERROR);
        foreach ([
            'schoolId', 'submissionId', 'payloadFingerprint', 'reporterMembershipId',
            'serialNumber', 'hostname', 'qrPublicId', 'technicalProfile', 'telemetry',
            'layout', 'asset', 'comments', 'events', 'workOrder',
        ] as $forbidden) {
            $this->assertStringNotContainsString('"'.$forbidden.'"', $serialized);
        }
    }

    public function test_deleted_live_assignee_membership_is_reconstructed_from_immutable_assignment_history(): void
    {
        [$viewer, $school, $viewerMembership] = $this->authenticateWithPermissions([
            'incidents.view',
            'incidents.view-all',
        ]);
        $viewerMembership->setRelation('user', $viewer);
        $context = new CurrentMembershipContext($viewerMembership, collect([
            'incidents.view',
            'incidents.view-all',
        ]));
        [$reporter, $reporterMembership] = $this->reporter($school);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $incident = $this->createIncidentFor([$reporter, $reporterMembership], $laboratory);
        $assignee = User::factory()->create(['name' => 'Teknisi Historis']);
        $assigneeMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $assignee->id,
            'status' => 'active',
        ]);
        $triagedAt = now()->subMinutes(2);

        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'triaged',
            'triage_summary' => 'Perlu pemeriksaan teknis.',
            'triaged_at' => $triagedAt,
            'version' => 2,
            'updated_at' => $triagedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Triaged,
            1,
            2,
            [
                'triageSummary' => 'Perlu pemeriksaan teknis.',
                'priority' => 'normal',
                'impact' => null,
                'blocksLaboratoryOperation' => false,
            ],
            $triagedAt,
        );

        $assignedAt = now()->subMinute();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'assigned',
            'assignee_membership_id' => $assigneeMembership->id,
            'assignee_user_id_snapshot' => $assignee->id,
            'assignee_name_snapshot' => $assignee->name,
            'assigned_at' => $assignedAt,
            'version' => 3,
            'updated_at' => $assignedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Assigned,
            2,
            3,
            [
                'assignee' => [
                    'membershipId' => $assigneeMembership->id,
                    'userId' => $assignee->id,
                    'name' => $assignee->name,
                ],
                'reason' => null,
            ],
            $assignedAt,
        );

        $resolvedAt = now();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'resolved',
            'resolution_summary' => 'Perangkat sudah kembali berfungsi.',
            'resolved_at' => $resolvedAt,
            'version' => 4,
            'updated_at' => $resolvedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Resolved,
            3,
            4,
            ['resolutionSummary' => 'Perangkat sudah kembali berfungsi.'],
            $resolvedAt,
        );

        $assigneeMembershipId = $assigneeMembership->id;
        $assigneeMembership->delete();
        $this->assertNull($incident->fresh()->assignee_membership_id);

        $this->getJson('/api/v1/incidents/'.$incident->id)
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.assignee.membershipId', $assigneeMembershipId)
            ->assertJsonPath('data.assignee.userId', $assignee->id)
            ->assertJsonPath('data.assignee.name', 'Teknisi Historis');
    }

    public function test_detail_emits_strong_etag_for_version_one_and_higher_version(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $versionOne = $this->createIncidentFor([$user, $membership], $laboratory);

        $this->getJson('/api/v1/incidents/'.$versionOne->id)
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.version', 1);

        DB::table('incidents')->where('id', $versionOne->id)->update(['version' => 12]);
        $this->getJson('/api/v1/incidents/'.$versionOne->id)
            ->assertOk()
            ->assertHeader('ETag', '"12"')
            ->assertJsonPath('data.version', 12);
    }

    public function test_detail_get_is_side_effect_free(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        )->fresh();
        $version = $incident->version;
        $updatedAt = $incident->updated_at?->toISOString();
        $eventCount = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count();

        $this->getJson('/api/v1/incidents/'.$incident->id)->assertOk();

        $incident->refresh();
        $this->assertSame($version, $incident->version);
        $this->assertSame($updatedAt, $incident->updated_at?->toISOString());
        $this->assertSame(
            $eventCount,
            IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count(),
        );
    }

    public function test_b1_detail_route_keeps_its_exact_path_and_permission(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())
            ->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}'
                && in_array('GET', $route->methods(), true));
        $this->assertSame(['GET', 'HEAD'], $route->methods());
        $this->assertSame('api/v1/incidents/{incidentId}', $route->uri());
        $this->assertContains('auth:sanctum', $route->gatherMiddleware());
        $this->assertContains('permission:incidents.view', $route->gatherMiddleware());
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

    /** @param array{User, SchoolMembership} $reporter */
    private function createIncidentFor(
        array $reporter,
        Laboratory $laboratory,
        ?Device $device = null,
    ): Incident {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);
        $context = new CurrentMembershipContext($membership, collect());

        return app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            [
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
            ],
        )->incident;
    }
}
