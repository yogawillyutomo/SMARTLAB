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
use Carbon\Carbon;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class TimetablePublicationReconciliationApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-09-10 09:00:00', 'Asia/Jakarta'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_candidate_publication_is_blocked_by_reservation_until_reservation_is_explicitly_reconciled(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone'=>'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);

        $current = $this->publication($school, $fixture, 1, 'active');
        $this->occurrence($school, $fixture, $current, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');

        $candidate = $this->publication($school, $fixture, 2, 'validated');
        $this->occurrence($school, $fixture, $candidate, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');
        $this->occurrence($school, $fixture, $candidate, 'NEW-LAB-A', '2026-09-14', $fixture['labA'], '09:00:00', '10:00:00');

        $reservation = $this->postJson('/api/v1/laboratory-reservations', [
            'laboratoryId'=>$fixture['labA']->id,
            'date'=>'2026-09-14',
            'startsAt'=>'09:00',
            'endsAt'=>'10:00',
            'activity'=>'Reservasi sebelum revisi jadwal',
            'participants'=>20,
            'picName'=>'Admin Lab',
        ])->assertCreated()->json('data');

        $impact = $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', false)
            ->assertJsonPath('data.scheduleDiff.added', 1)
            ->assertJsonPath('data.scheduleDiff.unchanged', 1)
            ->assertJsonPath('data.blockers.0.type', 'reservation_conflict')
            ->assertJsonPath('data.blockers.0.entityId', $reservation['id'])
            ->json('data');

        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $impact['fingerprint']);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED')
            ->assertJsonPath('details.impact.blockerCount', 1);

        $this->assertDatabaseHas('timetable_publications', ['id'=>$current->id,'status'=>'active']);
        $this->assertDatabaseHas('timetable_publications', ['id'=>$candidate->id,'status'=>'validated']);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/cancel', ['reason'=>'Jadwal TESSELA v2 membutuhkan slot ini'])
            ->assertOk();

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', true)
            ->assertJsonPath('data.blockerCount', 0);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertOk()
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.sourceVersion', 2);

        $this->assertDatabaseHas('timetable_publications', ['id'=>$current->id,'status'=>'superseded']);
    }

    public function test_candidate_publication_is_blocked_by_approved_priority_event_until_event_is_cancelled(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone'=>'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);

        $current = $this->publication($school, $fixture, 1, 'active');
        $this->occurrence($school, $fixture, $current, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');

        $event = $this->postJson('/api/v1/priority-events', [
            'laboratoryId'=>$fixture['labA']->id,
            'date'=>'2026-09-14',
            'startsAt'=>'11:00',
            'endsAt'=>'12:00',
            'category'=>'official_visit',
            'title'=>'Kunjungan Mitra',
            'participants'=>20,
            'picName'=>'Waka Humas',
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/approve')
            ->assertOk();

        $candidate = $this->publication($school, $fixture, 2, 'validated');
        $this->occurrence($school, $fixture, $candidate, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');
        $this->occurrence($school, $fixture, $candidate, 'NEW-PRIORITY-CONFLICT', '2026-09-14', $fixture['labA'], '11:00:00', '12:00:00');

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', false)
            ->assertJsonPath('data.blockers.0.type', 'priority_event_conflict')
            ->assertJsonPath('data.blockers.0.entityId', $event['id']);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/cancel', ['reason'=>'Dipindahkan agar sesuai jadwal revisi'])
            ->assertOk();

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertOk()
            ->assertJsonPath('data.status', 'active');
    }

    public function test_active_schedule_exception_never_silently_migrates_to_new_tessela_publication(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone'=>'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);

        $current = $this->publication($school, $fixture, 1, 'active');
        $source = $this->occurrence($school, $fixture, $current, 'BASE-EXCEPTION', '2026-09-14', $fixture['labA'], '07:00:00', '08:45:00');

        $exception = $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId'=>$source->id,
            'resolution'=>'relocate',
            'replacementLaboratoryId'=>$fixture['labB']->id,
            'reason'=>'Maintenance satu hari',
        ])->assertCreated()->json('data');

        $candidate = $this->publication($school, $fixture, 2, 'validated');
        $this->occurrence($school, $fixture, $candidate, 'BASE-EXCEPTION', '2026-09-14', $fixture['labA'], '07:00:00', '08:45:00');

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.blockers.0.type', 'active_schedule_exception')
            ->assertJsonPath('data.blockers.0.entityId', $exception['id'])
            ->assertJsonPath('data.blockers.0.details.candidateOccurrenceExists', true)
            ->assertJsonPath('data.blockers.0.details.sourceChanged', false);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/schedule-exceptions/'.$exception['id'].'/cancel', ['reason'=>'Reconcile sebelum TESSELA v2'])
            ->assertOk();

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertOk();

        $this->assertDatabaseHas('schedule_exceptions', [
            'id'=>$exception['id'],
            'status'=>'cancelled',
        ]);
    }

    public function test_capacity_reduction_after_validation_blocks_activation(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone'=>'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);

        $current = $this->publication($school, $fixture, 1, 'active');
        $this->occurrence($school, $fixture, $current, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');

        $candidate = $this->publication($school, $fixture, 2, 'validated');
        $this->occurrence($school, $fixture, $candidate, 'CAPACITY-CONFLICT', '2026-09-16', $fixture['labA'], '09:00:00', '10:00:00');

        $fixture['labA']->update(['capacity'=>20]);

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', false)
            ->assertJsonPath('data.blockers.0.type', 'laboratory_capacity_conflict')
            ->assertJsonPath('data.blockers.0.details.studentCount', 32)
            ->assertJsonPath('data.blockers.0.details.laboratoryCapacity', 20);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED');
    }

    public function test_calendar_blocker_and_inactive_laboratory_are_activation_blockers(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone'=>'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);

        $current = $this->publication($school, $fixture, 1, 'active');
        $this->occurrence($school, $fixture, $current, 'BASE-1', '2026-09-14', $fixture['labB'], '07:00:00', '08:45:00');

        OperationalCalendarEvent::query()->create([
            'school_id'=>$school->id,
            'scope'=>'school',
            'laboratory_id'=>null,
            'category'=>'closure',
            'availability_effect'=>'blocked',
            'title'=>'Penutupan sekolah',
            'description'=>null,
            'starts_on'=>'2026-09-15',
            'ends_on'=>'2026-09-15',
            'all_day'=>true,
            'starts_at'=>null,
            'ends_at'=>null,
            'status'=>'active',
            'version'=>1,
            'cancelled_at'=>null,
        ]);

        $candidate = $this->publication($school, $fixture, 2, 'validated');
        $this->occurrence($school, $fixture, $candidate, 'CALENDAR-CONFLICT', '2026-09-15', $fixture['labA'], '09:00:00', '10:00:00');

        $fixture['labA']->update(['status'=>'inactive']);

        $impact = $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', false)
            ->json('data');

        $types = collect($impact['blockers'])->pluck('type');
        $this->assertTrue($types->contains('calendar_blocker_conflict'));
        $this->assertTrue($types->contains('laboratory_status_conflict'));

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED');
    }

    /** @return array<string,mixed> */
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
    private function publication(School $school, array $fixture, int $version, string $status): TimetablePublication
    {
        return TimetablePublication::query()->create([
            'school_id'=>$school->id,'source_system'=>'tessela','source_publication_id'=>'TT-UAT-GASAL',
            'source_version'=>$version,'schema_version'=>'1.0','academic_reference_source'=>'smartlab',
            'source_school_id'=>$school->id,'source_academic_year_id'=>$fixture['year']->id,
            'source_semester_id'=>$fixture['semester']->id,'academic_year_id'=>$fixture['year']->id,
            'semester_id'=>$fixture['semester']->id,
            'published_at'=>$version === 1 ? '2026-09-01 00:00:00+00:00' : '2026-09-09 00:00:00+00:00',
            'effective_from'=>'2026-09-01','effective_to'=>'2026-12-18',
            'payload_sha256'=>str_repeat($version === 1 ? 'a' : 'b',64),
            'source_payload'=>['entries'=>[]],'status'=>$status,
            'validation_summary'=>['entriesReceived'=>1,'entriesNormalized'=>1,'occurrencesMaterialized'=>1,'errors'=>0,'warnings'=>0],
            'validated_at'=>now(),
            'activated_at'=>$status === 'active' ? now() : null,
        ]);
    }

    /** @param array<string,mixed> $fixture */
    private function occurrence(
        School $school,
        array $fixture,
        TimetablePublication $publication,
        string $sourceScheduleId,
        string $date,
        Laboratory $lab,
        string $startsAt,
        string $endsAt,
    ): ScheduleOccurrence {
        $entry = TimetableEntry::query()->create([
            'school_id'=>$school->id,'publication_id'=>$publication->id,'source_schedule_id'=>$sourceScheduleId,
            'teacher_id'=>$fixture['teacher']->id,'academic_class_id'=>$fixture['class']->id,'subject_id'=>$fixture['subject']->id,
            'lesson_period_set_id'=>$fixture['set']->id,'start_lesson_period_id'=>$fixture['start']->id,'end_lesson_period_id'=>$fixture['end']->id,
            'planned_laboratory_id'=>$lab->id,'activity_type'=>'practical','recurrence_kind'=>'single_date','weekday'=>null,
            'entry_effective_from'=>null,'entry_effective_to'=>null,'occurs_on'=>$date,
            'start_time_snapshot'=>$startsAt,'end_time_snapshot'=>$endsAt,'instruction_period_count'=>2,'source_snapshots'=>[],
        ]);

        return ScheduleOccurrence::query()->create([
            'school_id'=>$school->id,'publication_id'=>$publication->id,'entry_id'=>$entry->id,'occurs_on'=>$date,
            'teacher_id'=>$fixture['teacher']->id,'academic_class_id'=>$fixture['class']->id,'subject_id'=>$fixture['subject']->id,
            'planned_laboratory_id'=>$lab->id,'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,'end_lesson_period_id'=>$fixture['end']->id,
            'start_time_snapshot'=>$startsAt,'end_time_snapshot'=>$endsAt,'activity_type'=>'practical',
        ]);
    }

    /** @return array{User,School,SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id'=>$school->id,'user_id'=>$user->id,'status'=>'active',
        ]);
        $role = Role::query()->where('key',$roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        Sanctum::actingAs($user);

        return [$user,$school,$membership];
    }
}
