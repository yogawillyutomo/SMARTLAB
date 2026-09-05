<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\Laboratory;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\OperationalCalendarEvent;
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

class LaboratoryAvailabilityApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_auth_and_availability_permission_precede_query_validation(): void
    {
        $this->getJson('/api/v1/laboratory-availability?unexpected=true')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');

        $this->getJson('/api/v1/laboratory-availability?unexpected=true')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'guru');

        $this->getJson('/api/v1/laboratory-availability?unexpected=true')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['laboratoryId', 'date', 'startsAt', 'endsAt', 'unexpected']);

        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();
        $student = Role::query()->where('key', 'siswa')->firstOrFail();

        $this->assertTrue($head->permissions()->where('key', 'availability.view')->exists());
        $this->assertTrue($teacher->permissions()->where('key', 'availability.view')->exists());
        $this->assertFalse($student->permissions()->where('key', 'availability.view')->exists());
    }

    public function test_missing_schedule_coverage_fails_closed_instead_of_reporting_available(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'active']);

        $this->getJson($this->path($lab, '2026-09-14', '10:00', '12:00'))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'unknown')
            ->assertJsonPath('data.blockerCount', 0)
            ->assertJsonPath('data.sourceCoverage.schedule.status', 'missing')
            ->assertJsonPath('data.sourceCoverage.schedule.activePublicationCount', 0)
            ->assertJsonPath('data.issues.0.code', 'schedule_coverage_missing');
    }

    public function test_active_timetable_occurrence_blocks_only_overlapping_half_open_window(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'guru');
        $fixture = $this->fixture($school);
        $this->activeSchedule($school, $fixture, '2026-09-14', '07:00:00', '08:45:00');

        $this->getJson($this->path($fixture['lab'], '2026-09-14', '08:00', '08:30'))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'scheduled')
            ->assertJsonPath('data.blockerCount', 1)
            ->assertJsonPath('data.blockers.0.type', 'schedule_occurrence')
            ->assertJsonPath('data.blockers.0.details.sourceScheduleId', 'SCH-AVAIL-001')
            ->assertJsonPath('data.blockers.0.startsAt', '07:00:00')
            ->assertJsonPath('data.blockers.0.endsAt', '08:45:00')
            ->assertJsonPath('data.sourceCoverage.schedule.status', 'covered');

        $this->getJson($this->path($fixture['lab'], '2026-09-14', '08:45', '09:30'))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.state', 'available')
            ->assertJsonPath('data.blockerCount', 0);
    }

    public function test_calendar_blockers_and_notices_are_explainable_and_can_mix_with_schedule(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'guru');
        $fixture = $this->fixture($school);
        $this->activeSchedule($school, $fixture, '2026-09-14', '07:00:00', '08:45:00');

        OperationalCalendarEvent::query()->create([
            'school_id' => $school->id,
            'scope' => 'laboratory',
            'laboratory_id' => $fixture['lab']->id,
            'category' => 'maintenance',
            'availability_effect' => 'blocked',
            'title' => 'Maintenance jaringan',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-09-14',
            'all_day' => false,
            'starts_at' => '08:00:00',
            'ends_at' => '12:00:00',
            'status' => 'active',
            'version' => 1,
            'cancelled_at' => null,
        ]);

        OperationalCalendarEvent::query()->create([
            'school_id' => $school->id,
            'scope' => 'school',
            'laboratory_id' => null,
            'category' => 'school_event',
            'availability_effect' => 'informational',
            'title' => 'Kunjungan industri',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-09-14',
            'all_day' => true,
            'starts_at' => null,
            'ends_at' => null,
            'status' => 'active',
            'version' => 1,
            'cancelled_at' => null,
        ]);

        $this->getJson($this->path($fixture['lab'], '2026-09-14', '08:15', '08:30'))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'mixed')
            ->assertJsonPath('data.blockerCount', 2)
            ->assertJsonPath('data.blockers.0.type', 'schedule_occurrence')
            ->assertJsonPath('data.blockers.1.type', 'calendar_event')
            ->assertJsonPath('data.blockers.1.details.category', 'maintenance')
            ->assertJsonPath('data.noticeCount', 1)
            ->assertJsonPath('data.notices.0.title', 'Kunjungan industri')
            ->assertJsonPath('data.notices.0.details.scope', 'school');
    }

    public function test_known_operational_blocker_still_reports_unavailable_when_schedule_coverage_is_missing(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'inactive']);

        $this->getJson($this->path($lab, '2026-09-14', '10:00', '12:00'))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'blocked')
            ->assertJsonPath('data.blockers.0.type', 'laboratory_status')
            ->assertJsonPath('data.sourceCoverage.schedule.status', 'missing')
            ->assertJsonPath('data.issues.0.code', 'schedule_coverage_missing');
    }

    public function test_cross_school_laboratory_is_not_disclosed_and_invalid_window_is_rejected(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'guru');
        $foreign = Laboratory::factory()->create(['school_id' => School::factory()->create()->id]);

        $this->getJson($this->path($foreign, '2026-09-14', '10:00', '12:00'))
            ->assertNotFound()
            ->assertJsonPath('code', 'LABORATORY_AVAILABILITY_LAB_NOT_FOUND');

        $local = Laboratory::factory()->create(['school_id' => $school->id]);

        $this->getJson($this->path($local, '2026-09-14', '12:00', '10:00'))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['endsAt']);
    }

    /**
     * @return array{
     *   year:AcademicYear,semester:Semester,set:LessonPeriodSet,start:LessonPeriod,end:LessonPeriod,
     *   teacher:Teacher,class:AcademicClass,subject:Subject,lab:Laboratory
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
        $lab = Laboratory::factory()->create([
            'school_id'=>$school->id,'code'=>'LAB-RPL-1','name'=>'Lab RPL 1','capacity'=>36,'status'=>'active',
        ]);

        return compact('year','semester','set','start','end','teacher','class','subject','lab');
    }

    /** @param array<string,mixed> $fixture */
    private function activeSchedule(School $school, array $fixture, string $date, string $startsAt, string $endsAt): void
    {
        $publication = TimetablePublication::query()->create([
            'school_id'=>$school->id,
            'source_system'=>'tessela',
            'source_publication_id'=>'TT-AVAIL',
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
            'payload_sha256'=>str_repeat('a',64),
            'source_payload'=>['entries'=>[]],
            'status'=>'active',
            'validation_summary'=>['entriesReceived'=>1,'entriesNormalized'=>1,'occurrencesMaterialized'=>1,'errors'=>0,'warnings'=>0],
            'validated_at'=>now(),
            'activated_at'=>now(),
        ]);

        $entry = TimetableEntry::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'source_schedule_id'=>'SCH-AVAIL-001',
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'planned_laboratory_id'=>$fixture['lab']->id,
            'activity_type'=>'practical',
            'recurrence_kind'=>'single_date',
            'weekday'=>null,
            'entry_effective_from'=>null,
            'entry_effective_to'=>null,
            'occurs_on'=>$date,
            'start_time_snapshot'=>$startsAt,
            'end_time_snapshot'=>$endsAt,
            'instruction_period_count'=>2,
            'source_snapshots'=>[
                'teacherCode'=>'T-A','teacherName'=>'Guru Snapshot',
                'classCode'=>'XI-PPLG-1','className'=>'XI PPLG 1 Snapshot',
                'subjectCode'=>'WEB','subjectName'=>'Web Snapshot',
                'laboratoryCode'=>'LAB-RPL-1','laboratoryName'=>'Lab RPL 1 Snapshot',
            ],
        ]);

        ScheduleOccurrence::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'entry_id'=>$entry->id,
            'occurs_on'=>$date,
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'planned_laboratory_id'=>$fixture['lab']->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'start_time_snapshot'=>$startsAt,
            'end_time_snapshot'=>$endsAt,
            'activity_type'=>'practical',
        ]);
    }

    private function path(Laboratory $lab, string $date, string $startsAt, string $endsAt): string
    {
        return '/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId'=>$lab->id,
            'date'=>$date,
            'startsAt'=>$startsAt,
            'endsAt'=>$endsAt,
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
