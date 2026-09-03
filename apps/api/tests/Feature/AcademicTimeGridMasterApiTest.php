<?php

namespace Tests\Feature;

use App\Models\AcademicMasterEvent;
use App\Models\AcademicYear;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AcademicTimeGridMasterApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_authentication_and_permission_precede_time_grid_validation(): void
    {
        $this->postJson('/api/v1/master-data/lesson-period-sets', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');
        $this->postJson('/api/v1/master-data/lesson-period-sets', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');
        $this->postJson('/api/v1/master-data/lesson-period-sets', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['academicYearId', 'code', 'name', 'unexpected']);
    }

    public function test_lesson_period_set_is_parent_scoped_normalized_audited_and_tenant_safe(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $yearA = $this->academicYear($school, '2026/2027');
        $yearB = $this->academicYear($school, '2027/2028');

        $created = $this->postJson('/api/v1/master-data/lesson-period-sets', [
            'academicYearId' => $yearA->id,
            'code' => ' normal ',
            'name' => '  Jadwal Normal  ',
        ])->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.academicYearId', $yearA->id)
            ->assertJsonPath('data.code', 'NORMAL')
            ->assertJsonPath('data.name', 'Jadwal Normal')
            ->assertJsonPath('data.version', 1);

        $setId = $created->json('data.id');
        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('lesson_period_set', $event->entity_type);
        $this->assertSame($setId, $event->entity_id_snapshot);
        $this->assertSame('NORMAL', $event->entity_code_snapshot);
        $this->assertSame($actor->id, $event->actor_user_id_snapshot);
        $this->assertSame($membership->id, $event->actor_membership_id_snapshot);
        $this->assertSame('academic_master.created', $event->event_type);

        $this->postJson('/api/v1/master-data/lesson-period-sets', [
            'academicYearId' => $yearA->id,
            'code' => 'NORMAL',
            'name' => 'Duplicate',
        ])->assertStatus(422)->assertJsonValidationErrors(['code']);

        $this->postJson('/api/v1/master-data/lesson-period-sets', [
            'academicYearId' => $yearB->id,
            'code' => 'NORMAL',
            'name' => 'Normal tahun berikutnya',
        ])->assertCreated();

        $otherSchool = School::factory()->create();
        $foreignYear = $this->academicYear($otherSchool, 'OTHER');
        $this->postJson('/api/v1/master-data/lesson-period-sets', [
            'academicYearId' => $foreignYear->id,
            'code' => 'FOREIGN',
            'name' => 'Foreign',
        ])->assertStatus(422)->assertJsonValidationErrors(['academicYearId']);
    }

    public function test_lesson_period_set_list_detail_and_patch_are_versioned_deterministic_and_code_parent_immutable(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027');
        $b = $this->lessonPeriodSet($school, $year, 'B', 'B Set');
        $a = $this->lessonPeriodSet($school, $year, 'A', 'A Set');

        $otherSchool = School::factory()->create();
        $foreignYear = $this->academicYear($otherSchool, 'OTHER');
        $foreign = $this->lessonPeriodSet($otherSchool, $foreignYear, 'FOREIGN', 'Foreign');

        $this->getJson('/api/v1/master-data/lesson-period-sets?academicYearId='.$year->id)
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.id', $a->id)
            ->assertJsonPath('data.1.id', $b->id);

        $this->getJson('/api/v1/master-data/lesson-period-sets?search=A%20Set')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $a->id);

        $this->getJson('/api/v1/master-data/lesson-period-sets/'.$foreign->id)
            ->assertNotFound()->assertJsonPath('code', 'ACADEMIC_MASTER_NOT_FOUND');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-period-sets/'.$a->id, ['code' => 'RENAMED', 'academicYearId' => $foreignYear->id])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['code', 'academicYearId', 'request']);

        $updatedAt = $a->updated_at?->toISOString();
        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-period-sets/'.$a->id, ['name' => 'A Set'])
            ->assertOk()->assertHeader('ETag', '"1"')->assertJsonPath('data.version', 1);
        $this->assertSame($updatedAt, $a->refresh()->updated_at?->toISOString());
        $this->assertSame(0, AcademicMasterEvent::query()->count());

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-period-sets/'.$a->id, ['status' => 'inactive'])
            ->assertOk()->assertHeader('ETag', '"2"')->assertJsonPath('data.version', 2);
        $this->assertSame('academic_master.deactivated', AcademicMasterEvent::query()->sole()->event_type);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-period-sets/'.$a->id, ['name' => 'Stale'])
            ->assertStatus(412)->assertJsonPath('code', 'ACADEMIC_MASTER_VERSION_CONFLICT');
    }

    public function test_lesson_period_requires_valid_parent_unique_code_sequence_and_strict_time_range(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027');
        $set = $this->lessonPeriodSet($school, $year, 'NORMAL', 'Normal');

        $otherSchool = School::factory()->create();
        $foreignYear = $this->academicYear($otherSchool, 'OTHER');
        $foreignSet = $this->lessonPeriodSet($otherSchool, $foreignYear, 'FOREIGN', 'Foreign');

        $base = [
            'lessonPeriodSetId' => $foreignSet->id,
            'code' => 'JP01',
            'sequence' => 1,
            'startsAt' => '07:00:00',
            'endsAt' => '07:45:00',
            'kind' => 'instruction',
        ];
        $this->postJson('/api/v1/master-data/lesson-periods', $base)
            ->assertStatus(422)->assertJsonValidationErrors(['lessonPeriodSetId']);

        $base['lessonPeriodSetId'] = $set->id;
        $base['endsAt'] = '07:00:00';
        $this->postJson('/api/v1/master-data/lesson-periods', $base)
            ->assertStatus(422)->assertJsonValidationErrors(['endsAt']);

        $base['endsAt'] = '07:45:00';
        $this->postJson('/api/v1/master-data/lesson-periods', $base)
            ->assertCreated()->assertHeader('ETag', '"1"')->assertJsonPath('data.code', 'JP01');

        $duplicateCode = $base;
        $duplicateCode['sequence'] = 2;
        $duplicateCode['startsAt'] = '07:45:00';
        $duplicateCode['endsAt'] = '08:30:00';
        $this->postJson('/api/v1/master-data/lesson-periods', $duplicateCode)
            ->assertStatus(422)->assertJsonValidationErrors(['code']);

        $duplicateSequence = $duplicateCode;
        $duplicateSequence['code'] = 'JP02';
        $duplicateSequence['sequence'] = 1;
        $this->postJson('/api/v1/master-data/lesson-periods', $duplicateSequence)
            ->assertStatus(422)->assertJsonValidationErrors(['sequence']);
    }

    public function test_lesson_period_time_ranges_may_touch_but_never_overlap_even_when_existing_period_is_inactive(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027');
        $set = $this->lessonPeriodSet($school, $year, 'NORMAL', 'Normal');

        $this->lessonPeriod($school, $set, 'JP01', 1, '07:00:00', '07:45:00', 'instruction', 'inactive');

        $this->postJson('/api/v1/master-data/lesson-periods', [
            'lessonPeriodSetId' => $set->id,
            'code' => 'JP02',
            'sequence' => 2,
            'startsAt' => '07:30:00',
            'endsAt' => '08:15:00',
            'kind' => 'instruction',
        ])->assertStatus(409)->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $this->postJson('/api/v1/master-data/lesson-periods', [
            'lessonPeriodSetId' => $set->id,
            'code' => 'JP02',
            'sequence' => 2,
            'startsAt' => '07:45:00',
            'endsAt' => '08:30:00',
            'kind' => 'instruction',
        ])->assertCreated();
    }

    public function test_lesson_period_list_filters_orders_and_never_discloses_foreign_tenant_rows(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027');
        $set = $this->lessonPeriodSet($school, $year, 'NORMAL', 'Normal');
        $p2 = $this->lessonPeriod($school, $set, 'BREAK', 2, '07:45:00', '08:00:00', 'break');
        $p1 = $this->lessonPeriod($school, $set, 'JP01', 1, '07:00:00', '07:45:00');

        $otherSchool = School::factory()->create();
        $foreignYear = $this->academicYear($otherSchool, 'OTHER');
        $foreignSet = $this->lessonPeriodSet($otherSchool, $foreignYear, 'FOREIGN', 'Foreign');
        $foreign = $this->lessonPeriod($otherSchool, $foreignSet, 'JP99', 1, '07:00:00', '07:45:00');

        $this->getJson('/api/v1/master-data/lesson-periods?lessonPeriodSetId='.$set->id)
            ->assertOk()
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('data.0.id', $p1->id)
            ->assertJsonPath('data.1.id', $p2->id);

        $this->getJson('/api/v1/master-data/lesson-periods?lessonPeriodSetId='.$set->id.'&kind=break&search=BREAK')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $p2->id);

        $this->getJson('/api/v1/master-data/lesson-periods/'.$foreign->id)
            ->assertNotFound()->assertJsonPath('code', 'ACADEMIC_MASTER_NOT_FOUND');
    }

    public function test_lesson_period_patch_is_preconditioned_noop_safe_audited_and_parent_code_immutable(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $year = $this->academicYear($school, '2026/2027');
        $set = $this->lessonPeriodSet($school, $year, 'NORMAL', 'Normal');
        $period = $this->lessonPeriod($school, $set, 'JP01', 1, '07:00:00', '07:45:00');
        $this->lessonPeriod($school, $set, 'JP02', 2, '07:45:00', '08:30:00');

        $this->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['kind' => 'break'])
            ->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['code' => 'RENAMED', 'lessonPeriodSetId' => $set->id])
            ->assertStatus(422)->assertJsonValidationErrors(['code', 'lessonPeriodSetId', 'request']);

        $updatedAt = $period->updated_at?->toISOString();
        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['kind' => 'instruction'])
            ->assertOk()->assertHeader('ETag', '"1"')->assertJsonPath('data.version', 1);
        $this->assertSame($updatedAt, $period->refresh()->updated_at?->toISOString());
        $this->assertSame(0, AcademicMasterEvent::query()->count());

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['sequence' => 2])
            ->assertStatus(422)->assertJsonValidationErrors(['sequence']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['endsAt' => '08:00:00'])
            ->assertStatus(409)->assertJsonPath('code', 'ACADEMIC_MASTER_CONFLICT');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['kind' => 'break'])
            ->assertOk()->assertHeader('ETag', '"2"')->assertJsonPath('data.version', 2);

        $event = AcademicMasterEvent::query()->sole();
        $this->assertSame('lesson_period', $event->entity_type);
        $this->assertSame('academic_master.updated', $event->event_type);
        $this->assertSame(['kind' => 'instruction'], $event->payload['before']);
        $this->assertSame(['kind' => 'break'], $event->payload['after']);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/master-data/lesson-periods/'.$period->id, ['kind' => 'instruction'])
            ->assertStatus(412)->assertJsonPath('code', 'ACADEMIC_MASTER_VERSION_CONFLICT');
    }

    private function academicYear(School $school, string $code): AcademicYear
    {
        return AcademicYear::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => 'Tahun Ajaran '.$code,
            'starts_on' => '2026-07-01',
            'ends_on' => '2027-06-30',
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function lessonPeriodSet(School $school, AcademicYear $year, string $code, string $name): LessonPeriodSet
    {
        return LessonPeriodSet::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'code' => $code,
            'name' => $name,
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function lessonPeriod(
        School $school,
        LessonPeriodSet $set,
        string $code,
        int $sequence,
        string $startsAt,
        string $endsAt,
        string $kind = 'instruction',
        string $status = 'active',
    ): LessonPeriod {
        return LessonPeriod::query()->create([
            'school_id' => $school->id,
            'lesson_period_set_id' => $set->id,
            'code' => $code,
            'sequence' => $sequence,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'kind' => $kind,
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
