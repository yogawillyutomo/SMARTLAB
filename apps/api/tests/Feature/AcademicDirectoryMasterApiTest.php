<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicMasterEvent;
use App\Models\AcademicUnit;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicDirectoryMasterApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_academic_unit_normalizes_code_is_tenant_scoped_and_audited(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $foreignSchool = School::factory()->create();
        $foreignParent = $this->academicUnit($foreignSchool, 'FOREIGN', null);

        $this->postJson('/api/v1/master-data/academic-units', [
            'code' => ' pplg ',
            'name' => '  Pengembangan Perangkat Lunak dan Gim  ',
            'type' => 'PROGRAM',
            'parentId' => $foreignParent->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['parentId']);

        $response = $this->postJson('/api/v1/master-data/academic-units', [
            'code' => ' pplg ',
            'name' => '  Pengembangan Perangkat Lunak dan Gim  ',
            'type' => 'PROGRAM',
        ])->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.code', 'PPLG')
            ->assertJsonPath('data.name', 'Pengembangan Perangkat Lunak dan Gim')
            ->assertJsonPath('data.type', 'program')
            ->assertJsonPath('data.version', 1);

        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('academic_unit', $event->entity_type);
        $this->assertSame($response->json('data.id'), $event->entity_id_snapshot);
        $this->assertSame('PPLG', $event->entity_code_snapshot);
        $this->assertSame($actor->id, $event->actor_user_id_snapshot);
        $this->assertSame($membership->id, $event->actor_membership_id_snapshot);
        $this->assertSame('academic_master.created', $event->event_type);
    }

    public function test_academic_unit_hierarchy_rejects_cycles_and_depth_beyond_four(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $one = $this->academicUnit($school, 'L1');
        $two = $this->academicUnit($school, 'L2', $one->id);
        $three = $this->academicUnit($school, 'L3', $two->id);
        $four = $this->academicUnit($school, 'L4', $three->id);

        $this->postJson('/api/v1/master-data/academic-units', [
            'code' => 'L5',
            'name' => 'Level 5',
            'type' => 'other',
            'parentId' => $four->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['parentId']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-units/'.$one->id, ['parentId' => $two->id])
            ->assertStatus(422)->assertJsonValidationErrors(['parentId']);

        $root = $this->academicUnit($school, 'ROOT');
        $middle = $this->academicUnit($school, 'MID', $root->id);
        $subRoot = $this->academicUnit($school, 'SUB');
        $subChild = $this->academicUnit($school, 'SUB2', $subRoot->id);
        $this->academicUnit($school, 'SUB3', $subChild->id);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/academic-units/'.$subRoot->id, ['parentId' => $middle->id])
            ->assertStatus(422)->assertJsonValidationErrors(['parentId']);
    }

    public function test_teacher_is_separate_from_user_and_links_only_same_school_unique_membership(): void
    {
        [$actor, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $unit = $this->academicUnit($school, 'PPLG');
        $linkedUser = User::factory()->create(['name' => 'Akun Guru']);
        $linkedMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $linkedUser->id,
            'status' => 'active',
        ]);

        $response = $this->postJson('/api/v1/master-data/teachers', [
            'code' => ' gr-001 ',
            'personnelNumber' => ' nip.001 ',
            'name' => '  Guru Produktif  ',
            'email' => ' GURU@EXAMPLE.TEST ',
            'phone' => ' 0812345 ',
            'academicUnitId' => $unit->id,
            'membershipId' => $linkedMembership->id,
        ])->assertCreated()
            ->assertJsonPath('data.code', 'GR-001')
            ->assertJsonPath('data.personnelNumber', 'NIP.001')
            ->assertJsonPath('data.name', 'Guru Produktif')
            ->assertJsonPath('data.email', 'guru@example.test')
            ->assertJsonPath('data.membershipId', $linkedMembership->id);

        $this->assertNotSame($actor->id, $linkedUser->id);
        $this->assertSame($linkedUser->id, $linkedMembership->user_id);
        $this->assertSame($linkedMembership->id, Teacher::query()->findOrFail($response->json('data.id'))->membership_id);

        $this->postJson('/api/v1/master-data/teachers', [
            'code' => 'GR-002',
            'personnelNumber' => 'NIP.002',
            'name' => 'Guru Dua',
            'membershipId' => $linkedMembership->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['membershipId']);

        $this->postJson('/api/v1/master-data/teachers', [
            'code' => 'GR-003',
            'personnelNumber' => 'NIP.001',
            'name' => 'Guru Tiga',
        ])->assertStatus(422)->assertJsonValidationErrors(['personnelNumber']);

        $foreignSchool = School::factory()->create();
        $foreignMembership = SchoolMembership::factory()->create([
            'school_id' => $foreignSchool->id,
            'user_id' => User::factory()->create()->id,
            'status' => 'active',
        ]);
        $this->postJson('/api/v1/master-data/teachers', [
            'code' => 'GR-004',
            'name' => 'Foreign link',
            'membershipId' => $foreignMembership->id,
        ])->assertStatus(422)->assertJsonValidationErrors(['membershipId']);
    }

    public function test_teacher_patch_is_code_immutable_noop_safe_and_versioned(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $teacher = $this->teacher($school, 'GR-001');
        $updatedAt = $teacher->updated_at?->toISOString();

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/teachers/'.$teacher->id, ['code' => 'RENAMED'])
            ->assertStatus(422)->assertJsonValidationErrors(['code']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/teachers/'.$teacher->id, ['name' => $teacher->name])
            ->assertOk()->assertHeader('ETag', '"1"')->assertJsonPath('data.version', 1);
        $this->assertSame($updatedAt, $teacher->refresh()->updated_at?->toISOString());
        $this->assertSame(0, AcademicMasterEvent::query()->count());

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/teachers/'.$teacher->id, ['status' => 'inactive'])
            ->assertOk()->assertHeader('ETag', '"2"')->assertJsonPath('data.version', 2);
        $this->assertSame('academic_master.deactivated', AcademicMasterEvent::query()->sole()->event_type);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/teachers/'.$teacher->id, ['name' => 'Stale'])
            ->assertStatus(412)->assertJsonPath('code', 'ACADEMIC_MASTER_VERSION_CONFLICT');
    }

    public function test_active_class_requires_active_teacher_for_new_assignment_or_reactivation_but_preserves_existing_reference(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $inactiveTeacher = $this->teacher($school, 'INACTIVE', 'inactive');

        $this->postJson('/api/v1/master-data/classes', [
            'code' => 'XI-PPLG-1',
            'name' => 'XI PPLG 1',
            'gradeLevel' => 11,
            'homeroomTeacherId' => $inactiveTeacher->id,
        ])->assertStatus(409)->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $class = AcademicClass::query()->create([
            'school_id' => $school->id,
            'code' => 'XI-PPLG-2',
            'name' => 'XI PPLG 2',
            'grade_level' => 11,
            'homeroom_teacher_id' => $inactiveTeacher->id,
            'student_count' => 36,
            'status' => 'inactive',
            'version' => 1,
        ]);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/classes/'.$class->id, ['status' => 'active'])
            ->assertStatus(409)->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $activeTeacher = $this->teacher($school, 'ACTIVE');
        $activeClass = AcademicClass::query()->create([
            'school_id' => $school->id,
            'code' => 'XII-PPLG-1',
            'name' => 'XII PPLG 1',
            'grade_level' => 12,
            'homeroom_teacher_id' => $activeTeacher->id,
            'student_count' => 35,
            'status' => 'active',
            'version' => 1,
        ]);
        $activeTeacher->update(['status' => 'inactive']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/classes/'.$activeClass->id, ['name' => 'XII PPLG Satu'])
            ->assertOk()->assertJsonPath('data.homeroomTeacherId', $activeTeacher->id);
    }

    public function test_subject_and_lists_are_tenant_scoped_filterable_and_deterministic(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $unit = $this->academicUnit($school, 'PPLG');

        $subject = $this->postJson('/api/v1/master-data/subjects', [
            'code' => ' pwpb ',
            'name' => ' Pemrograman Web dan Perangkat Bergerak ',
            'groupName' => ' Produktif ',
            'academicUnitId' => $unit->id,
        ])->assertCreated()
            ->assertJsonPath('data.code', 'PWPB')
            ->assertJsonPath('data.groupName', 'Produktif');

        $this->teacher($school, 'B-GURU');
        $aTeacher = $this->teacher($school, 'A-GURU');
        AcademicClass::query()->create([
            'school_id' => $school->id,
            'code' => 'XI-PPLG-1',
            'name' => 'XI PPLG 1',
            'grade_level' => 11,
            'student_count' => 36,
            'status' => 'active',
            'version' => 1,
        ]);

        $foreign = School::factory()->create();
        $this->teacher($foreign, 'FOREIGN');
        Subject::query()->create([
            'school_id' => $foreign->id,
            'code' => 'FOREIGN',
            'name' => 'Foreign',
            'status' => 'active',
            'version' => 1,
        ]);

        $this->getJson('/api/v1/master-data/teachers?search=GURU')
            ->assertOk()->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.id', $aTeacher->id);
        $this->getJson('/api/v1/master-data/classes?gradeLevel=11')
            ->assertOk()->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/master-data/subjects?academicUnitId='.$unit->id.'&search=Produktif')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $subject->json('data.id'));
    }

    public function test_directory_routes_require_static_permissions_preconditions_and_expose_no_delete(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'kepala-lab');
        $this->getJson('/api/v1/master-data/teachers')->assertOk();
        $this->postJson('/api/v1/master-data/teachers', [])->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');
        $teacher = $this->teacher($school, 'GR-001');
        $this->patchJson('/api/v1/master-data/teachers/'.$teacher->id, ['name' => 'Changed'])
            ->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');
        $this->deleteJson('/api/v1/master-data/teachers/'.$teacher->id)->assertStatus(405);
        $this->deleteJson('/api/v1/master-data/academic-units/'.strtolower((string) \Illuminate\Support\Str::ulid()))->assertStatus(405);
        $this->deleteJson('/api/v1/master-data/classes/'.strtolower((string) \Illuminate\Support\Str::ulid()))->assertStatus(405);
        $this->deleteJson('/api/v1/master-data/subjects/'.strtolower((string) \Illuminate\Support\Str::ulid()))->assertStatus(405);
    }

    public function test_sqlite_self_parent_integrity_rejects_missing_parent_even_outside_service(): void
    {
        $school = School::factory()->create();
        $this->expectException(QueryException::class);
        AcademicUnit::query()->create([
            'school_id' => $school->id,
            'code' => 'BROKEN',
            'name' => 'Broken',
            'type' => 'other',
            'parent_id' => strtolower((string) \Illuminate\Support\Str::ulid()),
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function academicUnit(School $school, string $code, ?string $parentId = null): AcademicUnit
    {
        return AcademicUnit::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => $code,
            'type' => 'other',
            'parent_id' => $parentId,
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function teacher(School $school, string $code, string $status = 'active'): Teacher
    {
        return Teacher::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => $code,
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
