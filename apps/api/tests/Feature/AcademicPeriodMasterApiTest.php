<?php

namespace Tests\Feature;

use App\Models\AcademicMasterEvent;
use App\Models\AcademicYear;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicPeriodMasterApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_authentication_and_permission_precede_academic_master_validation(): void
    {
        $this->postJson('/api/v1/master-data/academic-years', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');
        $this->postJson('/api/v1/master-data/academic-years', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');
        $this->postJson('/api/v1/master-data/academic-years', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['code', 'name', 'startsOn', 'endsOn', 'unexpected']);
    }

    public function test_role_baseline_is_server_authoritative_and_has_no_master_data_delete_permission(): void
    {
        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $student = Role::query()->where('key', 'siswa')->firstOrFail();

        $this->assertSame(
            ['master-data.create', 'master-data.update', 'master-data.view'],
            $admin->permissions()->where('key', 'like', 'master-data.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['master-data.view'],
            $head->permissions()->where('key', 'like', 'master-data.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame([], $student->permissions()->where('key', 'like', 'master-data.%')->pluck('key')->all());
        $this->assertDatabaseMissing('permissions', ['key' => 'master-data.delete']);
    }

    public function test_create_academic_year_normalizes_code_writes_etag_and_one_immutable_event(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(School::factory()->create(), 'admin-lab');

        $response = $this->postJson('/api/v1/master-data/academic-years', [
            'code' => ' 2026/2027 ',
            'name' => '  Tahun Ajaran 2026/2027  ',
            'startsOn' => '2026-07-01',
            'endsOn' => '2027-06-30',
        ])->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.code', '2026/2027')
            ->assertJsonPath('data.name', 'Tahun Ajaran 2026/2027')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.version', 1);

        $yearId = $response->json('data.id');
        $this->assertDatabaseHas('academic_years', [
            'id' => $yearId,
            'school_id' => $school->id,
            'code' => '2026/2027',
            'version' => 1,
        ]);

        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('academic_year', $event->entity_type);
        $this->assertSame($yearId, $event->entity_id_snapshot);
        $this->assertSame('2026/2027', $event->entity_code_snapshot);
        $this->assertSame($actor->id, $event->actor_user_id_snapshot);
        $this->assertSame($membership->id, $event->actor_membership_id_snapshot);
        $this->assertSame('academic_master.created', $event->event_type);
        $this->assertSame(0, $event->entity_version_before);
        $this->assertSame(1, $event->entity_version_after);
    }

    public function test_academic_year_codes_are_stable_unique_and_not_patchable(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');

        $this->postJson('/api/v1/master-data/academic-years', [
            'code' => ' 2026/2027 ',
            'name' => 'Duplicate',
            'startsOn' => '2028-07-01',
            'endsOn' => '2029-06-30',
        ])->assertStatus(422)->assertJsonValidationErrors(['code']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, [
                'code' => 'RENAMED',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['code', 'request']);

        $this->assertSame('2026/2027', $year->refresh()->code);
    }

    public function test_active_academic_year_ranges_cannot_overlap_but_inactive_reference_can_be_staged(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');

        $payload = [
            'code' => '2027/2028',
            'name' => 'Overlapping',
            'startsOn' => '2027-06-01',
            'endsOn' => '2028-05-31',
        ];

        $this->postJson('/api/v1/master-data/academic-years', $payload)
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $payload['status'] = 'inactive';
        $this->postJson('/api/v1/master-data/academic-years', $payload)
            ->assertCreated()
            ->assertJsonPath('data.status', 'inactive');
    }

    public function test_academic_year_list_and_detail_are_tenant_scoped_literal_searchable_and_deterministic(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $b = $this->academicYear($school, 'B-2028', '2028-07-01', '2029-06-30', 'inactive');
        $a = $this->academicYear($school, 'A-2027', '2027-07-01', '2028-06-30', 'inactive');

        $otherSchool = School::factory()->create();
        $foreign = $this->academicYear($otherSchool, 'A-OTHER', '2027-07-01', '2028-06-30', 'inactive');

        $this->getJson('/api/v1/master-data/academic-years?status=inactive&page=1&perPage=10')
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.id', $a->id)
            ->assertJsonPath('data.1.id', $b->id);

        $this->getJson('/api/v1/master-data/academic-years?search=A-2027')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $a->id);

        $this->getJson('/api/v1/master-data/academic-years/'.$foreign->id)
            ->assertNotFound()
            ->assertJsonPath('code', 'ACADEMIC_MASTER_NOT_FOUND');
    }

    public function test_academic_year_patch_requires_strong_precondition_rejects_stale_and_preserves_noop(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');
        $updatedAt = $year->updated_at?->toISOString();

        $this->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['name' => 'Changed'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');
        $this->withHeader('If-Match', '1')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['name' => 'Changed'])
            ->assertStatus(428);
        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['name' => 'Changed'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'ACADEMIC_MASTER_VERSION_CONFLICT');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['name' => $year->name])
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.version', 1);

        $year->refresh();
        $this->assertSame($updatedAt, $year->updated_at?->toISOString());
        $this->assertSame(0, AcademicMasterEvent::query()->count());
    }

    public function test_meaningful_year_update_increments_once_and_date_shrink_cannot_orphan_semester_range(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');
        $semester = $this->semester($school, $year, 'GASAL', '2026-07-01', '2026-12-31');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['name' => 'TA Baru'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2);

        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('academic_master.updated', $event->event_type);
        $this->assertSame(['name' => 'Tahun Ajaran 2026/2027'], $event->payload['before']);
        $this->assertSame(['name' => 'TA Baru'], $event->payload['after']);
        $this->assertSame(1, $event->entity_version_before);
        $this->assertSame(2, $event->entity_version_after);

        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['startsOn' => '2026-08-01'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $this->assertSame('2026-07-01', $year->refresh()->starts_on->format('Y-m-d'));
        $this->assertSame('2026-07-01', $semester->refresh()->starts_on->format('Y-m-d'));
    }

    public function test_semester_requires_same_school_parent_containment_active_parent_and_nonoverlap(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');
        $this->semester($school, $year, 'GASAL', '2026-07-01', '2026-12-31');

        $otherSchool = School::factory()->create();
        $foreignYear = $this->academicYear($otherSchool, 'OTHER', '2026-07-01', '2027-06-30');

        $base = [
            'academicYearId' => $foreignYear->id,
            'code' => 'GENAP',
            'name' => 'Semester Genap',
            'startsOn' => '2027-01-01',
            'endsOn' => '2027-06-30',
        ];
        $this->postJson('/api/v1/master-data/semesters', $base)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['academicYearId']);

        $base['academicYearId'] = $year->id;
        $base['startsOn'] = '2026-12-15';
        $this->postJson('/api/v1/master-data/semesters', $base)
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $base['startsOn'] = '2025-01-01';
        $this->postJson('/api/v1/master-data/semesters', $base)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['startsOn']);

        $inactiveYear = $this->academicYear($school, '2028/2029', '2028-07-01', '2029-06-30', 'inactive');
        $base['academicYearId'] = $inactiveYear->id;
        $base['startsOn'] = '2028-07-01';
        $base['endsOn'] = '2028-12-31';
        $this->postJson('/api/v1/master-data/semesters', $base)
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');
    }

    public function test_semester_code_is_parent_scoped_and_patch_is_versioned_audited_and_code_immutable(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $yearA = $this->academicYear($school, 'A', '2026-01-01', '2026-12-31', 'inactive');
        $yearB = $this->academicYear($school, 'B', '2027-01-01', '2027-12-31', 'inactive');
        $semesterA = $this->semester($school, $yearA, 'S1', '2026-01-01', '2026-06-30', 'inactive');
        $this->semester($school, $yearB, 'S1', '2027-01-01', '2027-06-30', 'inactive');
        AcademicMasterEvent::query()->delete();

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/semesters/'.$semesterA->id, ['code' => 'CHANGED'])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['code', 'request']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/semesters/'.$semesterA->id, ['name' => 'Semester Satu'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2);

        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('semester', $event->entity_type);
        $this->assertSame('academic_master.updated', $event->event_type);
        $this->assertSame('S1', $semesterA->refresh()->code);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/semesters/'.$semesterA->id, ['name' => 'Stale'])
            ->assertStatus(412);
    }

    public function test_deactivate_and_reactivate_use_typed_events_and_no_delete_routes_exist(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027', '2026-07-01', '2027-06-30');
        AcademicMasterEvent::query()->delete();

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['status' => 'inactive'])
            ->assertOk()->assertHeader('ETag', '"2"');
        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/master-data/academic-years/'.$year->id, ['status' => 'active'])
            ->assertOk()->assertHeader('ETag', '"3"');

        $this->assertSame(
            ['academic_master.deactivated', 'academic_master.reactivated'],
            AcademicMasterEvent::query()->orderBy('created_at')->orderBy('id')->pluck('event_type')->all(),
        );

        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/v1/master-data/'))
            ->values();
        $this->assertTrue($routes->isNotEmpty());
        $this->assertTrue($routes->every(fn ($route) => ! in_array('DELETE', $route->methods(), true)));
    }

    public function test_audit_insert_failure_rolls_back_academic_year_creation(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER academic_master_events_test_insert_failure
            BEFORE INSERT ON academic_master_events
            BEGIN
                SELECT RAISE(ABORT, 'forced academic master audit insert failure');
            END;
        SQL);

        try {
            $this->postJson('/api/v1/master-data/academic-years', [
                'code' => 'ROLLBACK',
                'name' => 'Rollback Year',
                'startsOn' => '2030-01-01',
                'endsOn' => '2030-12-31',
            ])->assertStatus(500);
        } finally {
            DB::unprepared('DROP TRIGGER IF EXISTS academic_master_events_test_insert_failure');
        }

        $this->assertDatabaseMissing('academic_years', [
            'school_id' => $school->id,
            'code' => 'ROLLBACK',
        ]);
        $this->assertSame(0, AcademicMasterEvent::query()->count());
    }

    private function academicYear(
        School $school,
        string $code,
        string $startsOn,
        string $endsOn,
        string $status = 'active',
    ): AcademicYear {
        return AcademicYear::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => 'Tahun Ajaran '.$code,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'status' => $status,
            'version' => 1,
        ]);
    }

    private function semester(
        School $school,
        AcademicYear $year,
        string $code,
        string $startsOn,
        string $endsOn,
        string $status = 'active',
    ): Semester {
        return Semester::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'code' => $code,
            'name' => 'Semester '.$code,
            'starts_on' => $startsOn,
            'ends_on' => $endsOn,
            'status' => $status,
            'version' => 1,
        ]);
    }

    /** @return array{User, School, SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $role = Role::query()->where('key', $roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        $membership->setRelation('user', $user);

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }
}
