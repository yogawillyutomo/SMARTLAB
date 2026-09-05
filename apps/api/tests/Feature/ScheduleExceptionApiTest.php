<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\Role;
use App\Models\ScheduleOccurrence;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\TimetableEntry;
use App\Models\TimetablePublication;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ScheduleExceptionApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_auth_and_exception_permission_precede_payload_validation(): void
    {
        $this->postJson('/api/v1/schedule-exceptions', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');

        $this->postJson('/api/v1/schedule-exceptions', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');

        $this->postJson('/api/v1/schedule-exceptions', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['occurrenceId', 'resolution', 'reason', 'unexpected']);

        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $technician = Role::query()->where('key', 'teknisi')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();
        $leader = Role::query()->where('key', 'pimpinan')->firstOrFail();

        $this->assertSame(
            ['schedule-exceptions.cancel', 'schedule-exceptions.create', 'schedule-exceptions.view'],
            $admin->permissions()->where('key', 'like', 'schedule-exceptions.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['schedule-exceptions.cancel', 'schedule-exceptions.create', 'schedule-exceptions.view'],
            $head->permissions()->where('key', 'like', 'schedule-exceptions.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['schedule-exceptions.view'],
            $technician->permissions()->where('key', 'like', 'schedule-exceptions.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertFalse($teacher->permissions()->where('key', 'like', 'schedule-exceptions.%')->exists());
        $this->assertSame(
            ['schedule-exceptions.view'],
            $leader->permissions()->where('key', 'like', 'schedule-exceptions.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_cancel_exception_suppresses_only_the_dated_source_occurrence_without_mutating_tessela_plan(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $created = $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'cancel',
            'reason' => 'Lab ditutup untuk maintenance listrik',
        ])
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.resolution', 'cancel')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.originalLaboratory.id', $fixture['labA']->id)
            ->assertJsonPath('data.replacementLaboratory', null)
            ->assertJsonPath('data.timeline.0.eventType', 'schedule_exception.applied')
            ->json('data');

        $this->getJson($this->availabilityPath($fixture['labA']))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.blockerCount', 0)
            ->assertJsonPath('data.sourceCoverage.scheduleExceptions.status', 'covered');

        $this->getJson('/api/v1/schedule-occurrences?from=2026-09-14&to=2026-09-14')
            ->assertOk()
            ->assertJsonPath('data.0.id', $occurrence->id)
            ->assertJsonPath('data.0.operationalStatus', 'cancelled')
            ->assertJsonPath('data.0.operationalLaboratory', null)
            ->assertJsonPath('data.0.exception.id', $created['id'])
            ->assertJsonPath('data.0.exception.resolution', 'cancel');

        $this->assertDatabaseHas('schedule_occurrences', [
            'id' => $occurrence->id,
            'planned_laboratory_id' => $fixture['labA']->id,
            'start_time_snapshot' => '07:00:00',
            'end_time_snapshot' => '08:45:00',
        ]);
    }

    public function test_relocation_frees_original_lab_and_occupies_replacement_with_explainable_provenance(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'kepala-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $exception = $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $fixture['labB']->id,
            'reason' => 'Lab RPL 1 maintenance satu hari',
        ])
            ->assertCreated()
            ->assertJsonPath('data.resolution', 'relocate')
            ->assertJsonPath('data.replacementLaboratory.id', $fixture['labB']->id)
            ->json('data');

        $this->getJson($this->availabilityPath($fixture['labA']))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.blockerCount', 0);

        $this->getJson($this->availabilityPath($fixture['labB']))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'scheduled')
            ->assertJsonPath('data.blockers.0.type', 'schedule_exception')
            ->assertJsonPath('data.blockers.0.sourceId', $exception['id'])
            ->assertJsonPath('data.blockers.0.details.occurrenceId', $occurrence->id)
            ->assertJsonPath('data.blockers.0.details.originalLaboratory.id', $fixture['labA']->id)
            ->assertJsonPath('data.blockers.0.details.replacementLaboratory.id', $fixture['labB']->id);

        $this->getJson('/api/v1/schedule-occurrences?from=2026-09-14&to=2026-09-14')
            ->assertOk()
            ->assertJsonPath('data.0.plannedLaboratory.id', $fixture['labA']->id)
            ->assertJsonPath('data.0.operationalStatus', 'relocated')
            ->assertJsonPath('data.0.operationalLaboratory.id', $fixture['labB']->id)
            ->assertJsonPath('data.0.exception.reason', 'Lab RPL 1 maintenance satu hari');
    }

    public function test_relocation_rejects_same_lab_capacity_shortfall_and_busy_target(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $fixture['labA']->id,
            'reason' => 'Invalid same lab',
        ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['replacementLaboratoryId']);

        $small = Laboratory::factory()->create([
            'school_id' => $school->id,
            'code' => 'LAB-SMALL',
            'name' => 'Lab Kecil',
            'capacity' => 10,
            'status' => 'active',
        ]);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $small->id,
            'reason' => 'Capacity too small',
        ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['replacementLaboratoryId']);

        LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-BUSYLAB1',
            'laboratory_id' => $fixture['labB']->id,
            'requester_user_id' => User::factory()->create()->id,
            'requester_membership_id' => $this->membershipFor($school)->id,
            'requester_name_snapshot' => 'Guru Booking',
            'requester_email_snapshot' => 'booking@example.test',
            'reservation_date' => '2026-09-14',
            'starts_at' => '07:30:00',
            'ends_at' => '08:30:00',
            'activity' => 'Reservasi lain',
            'participants' => 20,
            'device_needs' => null,
            'notes' => null,
            'pic_name' => 'PIC',
            'status' => 'approved',
            'rejection_reason' => null,
            'decided_at' => now(),
            'cancelled_at' => null,
            'version' => 1,
        ]);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $fixture['labB']->id,
            'reason' => 'Target busy',
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SCHEDULE_EXCEPTION_TARGET_UNAVAILABLE')
            ->assertJsonPath('details.availability.blockers.0.type', 'reservation');

        $this->assertDatabaseCount('schedule_exceptions', 0);
    }

    public function test_cancelling_exception_is_fail_closed_when_restoring_original_lab_would_conflict(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $exception = $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'cancel',
            'reason' => 'Maintenance',
        ])->assertCreated()->json('data');

        $requester = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $requester->id,
            'status' => 'active',
        ]);

        LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-RESTORE1',
            'laboratory_id' => $fixture['labA']->id,
            'requester_user_id' => $requester->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $requester->name,
            'requester_email_snapshot' => $requester->email,
            'reservation_date' => '2026-09-14',
            'starts_at' => '07:00:00',
            'ends_at' => '08:45:00',
            'activity' => 'Slot dipakai setelah jadwal dibatalkan',
            'participants' => 20,
            'device_needs' => null,
            'notes' => null,
            'pic_name' => 'PIC',
            'status' => 'approved',
            'rejection_reason' => null,
            'decided_at' => now(),
            'cancelled_at' => null,
            'version' => 1,
        ]);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/schedule-exceptions/'.$exception['id'].'/cancel', ['reason' => 'Coba pulihkan jadwal'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SCHEDULE_EXCEPTION_RESTORATION_UNAVAILABLE')
            ->assertJsonPath('details.availability.blockers.0.type', 'reservation');

        $this->assertDatabaseHas('schedule_exceptions', [
            'id' => $exception['id'],
            'status' => 'active',
            'version' => 1,
        ]);
    }

    public function test_safe_exception_cancellation_restores_original_and_releases_replacement_with_version_audit(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'kepala-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $exception = $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $fixture['labB']->id,
            'reason' => 'Maintenance sementara',
        ])->assertCreated()->json('data');

        $this->postJson('/api/v1/schedule-exceptions/'.$exception['id'].'/cancel', ['reason' => 'missing precondition'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/schedule-exceptions/'.$exception['id'].'/cancel', ['reason' => 'Lab asli siap kembali'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.timeline.1.eventType', 'schedule_exception.cancelled');

        $this->getJson($this->availabilityPath($fixture['labA']))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'scheduled')
            ->assertJsonPath('data.blockers.0.type', 'schedule_occurrence');

        $this->getJson($this->availabilityPath($fixture['labB']))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.blockerCount', 0);

        $this->getJson('/api/v1/schedule-occurrences?from=2026-09-14&to=2026-09-14')
            ->assertOk()
            ->assertJsonPath('data.0.operationalStatus', 'scheduled')
            ->assertJsonPath('data.0.operationalLaboratory.id', $fixture['labA']->id)
            ->assertJsonPath('data.0.exception', null);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/schedule-exceptions/'.$exception['id'].'/cancel', ['reason' => 'stale'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'SCHEDULE_EXCEPTION_VERSION_CONFLICT');
    }

    public function test_exception_creation_is_tenant_scoped_and_requires_active_source_publication(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $foreignSchool = School::factory()->create();
        $foreignFixture = $this->fixture($foreignSchool);
        $foreignOccurrence = $this->activeSchedule($foreignSchool, $foreignFixture, '2026-09-14', $foreignFixture['labA']);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $foreignOccurrence->id,
            'resolution' => 'cancel',
            'reason' => 'cross school',
        ])
            ->assertNotFound()
            ->assertJsonPath('code', 'SCHEDULE_EXCEPTION_OCCURRENCE_NOT_FOUND');

        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);
        TimetablePublication::query()->whereKey($occurrence->publication_id)->update([
            'status' => 'superseded',
            'superseded_at' => now(),
        ]);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'cancel',
            'reason' => 'stale publication',
        ])
            ->assertNotFound()
            ->assertJsonPath('code', 'SCHEDULE_EXCEPTION_OCCURRENCE_NOT_FOUND');
    }

    /**
     * @return array{
     * year:AcademicYear,semester:Semester,set:LessonPeriodSet,start:LessonPeriod,end:LessonPeriod,
     * teacher:Teacher,class:AcademicClass,subject:Subject,labA:Laboratory,labB:Laboratory
     * }
     */
    private function fixture(School $school): array
    {
        $year = AcademicYear::query()->create([
            'school_id'=>$school->id,'code'=>'2026/2027','name'=>'2026/2027',
            'starts_on'=>'2026-07-01','ends_on'=>'2027-06-30','status'=>'active','version'=>1,
        ]);
        $semester = Semester::query()->create([
            'school_id'=>$school->id,'academic_year_id'=>$year->id,'code'=>'GASAL','name'=>'Semester Gasal',
            'starts_on'=>'2026-07-01','ends_on'=>'2026-12-31','status'=>'active','version'=>1,
        ]);
        $set = LessonPeriodSet::query()->create([
            'school_id'=>$school->id,'academic_year_id'=>$year->id,'code'=>'NORMAL','name'=>'Jam Normal','status'=>'active','version'=>1,
        ]);
        $start = LessonPeriod::query()->create([
            'school_id'=>$school->id,'lesson_period_set_id'=>$set->id,'code'=>'JP01','sequence'=>1,
            'starts_at'=>'07:00:00','ends_at'=>'07:45:00','kind'=>'instruction','status'=>'active','version'=>1,
        ]);
        $end = LessonPeriod::query()->create([
            'school_id'=>$school->id,'lesson_period_set_id'=>$set->id,'code'=>'JP02','sequence'=>2,
            'starts_at'=>'08:00:00','ends_at'=>'08:45:00','kind'=>'instruction','status'=>'active','version'=>1,
        ]);
        $teacher = Teacher::query()->create([
            'school_id'=>$school->id,'code'=>'T-A','name'=>'Guru A','status'=>'active','version'=>1,
        ]);
        $class = AcademicClass::query()->create([
            'school_id'=>$school->id,'code'=>'XI-PPLG-1','name'=>'XI PPLG 1','grade_level'=>11,'student_count'=>32,'status'=>'active','version'=>1,
        ]);
        $subject = Subject::query()->create([
            'school_id'=>$school->id,'code'=>'WEB','name'=>'Pemrograman Web','status'=>'active','version'=>1,
        ]);
        $labA = Laboratory::factory()->create([
            'school_id'=>$school->id,'code'=>'LAB-RPL-1','name'=>'Lab RPL 1','capacity'=>36,'status'=>'active',
        ]);
        $labB = Laboratory::factory()->create([
            'school_id'=>$school->id,'code'=>'LAB-RPL-2','name'=>'Lab RPL 2','capacity'=>40,'status'=>'active',
        ]);

        return compact('year','semester','set','start','end','teacher','class','subject','labA','labB');
    }

    /** @param array<string,mixed> $fixture */
    private function activeSchedule(School $school, array $fixture, string $date, Laboratory $lab): ScheduleOccurrence
    {
        $publication = TimetablePublication::query()->create([
            'school_id'=>$school->id,
            'source_system'=>'tessela',
            'source_publication_id'=>'TT-EXCEPTION',
            'source_version'=>1,
            'schema_version'=>'1.0',
            'academic_reference_source'=>'smartlab',
            'source_school_id'=>$school->id,
            'source_academic_year_id'=>$fixture['year']->id,
            'source_semester_id'=>$fixture['semester']->id,
            'academic_year_id'=>$fixture['year']->id,
            'semester_id'=>$fixture['semester']->id,
            'published_at'=>'2026-09-05 00:00:00+00:00',
            'effective_from'=>'2026-09-01',
            'effective_to'=>'2026-12-18',
            'payload_sha256'=>str_repeat('e',64),
            'source_payload'=>['entries'=>[]],
            'status'=>'active',
            'validation_summary'=>['entriesReceived'=>1,'entriesNormalized'=>1,'occurrencesMaterialized'=>1,'errors'=>0,'warnings'=>0],
            'validated_at'=>now(),
            'activated_at'=>now(),
        ]);

        $entry = TimetableEntry::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'source_schedule_id'=>'SCH-EXCEPTION-001',
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'planned_laboratory_id'=>$lab->id,
            'activity_type'=>'practical',
            'recurrence_kind'=>'single_date',
            'weekday'=>null,
            'entry_effective_from'=>null,
            'entry_effective_to'=>null,
            'occurs_on'=>$date,
            'start_time_snapshot'=>'07:00:00',
            'end_time_snapshot'=>'08:45:00',
            'instruction_period_count'=>2,
            'source_snapshots'=>[
                'teacherCode'=>'T-A','teacherName'=>'Guru A Snapshot',
                'classCode'=>'XI-PPLG-1','className'=>'XI PPLG 1 Snapshot',
                'subjectCode'=>'WEB','subjectName'=>'Web Snapshot',
                'laboratoryCode'=>$lab->code,'laboratoryName'=>$lab->name,
            ],
        ]);

        return ScheduleOccurrence::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'entry_id'=>$entry->id,
            'occurs_on'=>$date,
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'planned_laboratory_id'=>$lab->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'start_time_snapshot'=>'07:00:00',
            'end_time_snapshot'=>'08:45:00',
            'activity_type'=>'practical',
        ]);
    }

    private function availabilityPath(Laboratory $lab): string
    {
        return '/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId'=>$lab->id,
            'date'=>'2026-09-14',
            'startsAt'=>'07:00',
            'endsAt'=>'08:45',
        ]);
    }

    private function membershipFor(School $school): SchoolMembership
    {
        $user = User::factory()->create();

        return SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
    }

    /** @return array{User,School,SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey): array
    {
        $user=User::factory()->create();
        $membership=SchoolMembership::factory()->create(['school_id'=>$school->id,'user_id'=>$user->id,'status'=>'active']);
        $role=Role::query()->where('key',$roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        Sanctum::actingAs($user);

        return [$user,$school,$membership];
    }
}
