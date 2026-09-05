<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\Laboratory;
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

class PriorityEventApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_priority_event_permissions_are_server_authoritative(): void
    {
        $this->postJson('/api/v1/priority-events', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');

        $this->postJson('/api/v1/priority-events', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');

        $this->postJson('/api/v1/priority-events', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['laboratoryId', 'date', 'startsAt', 'endsAt', 'category', 'title', 'participants', 'picName', 'unexpected']);

        $this->assertSame(
            [
                'priority-events.approve',
                'priority-events.cancel',
                'priority-events.create',
                'priority-events.export',
                'priority-events.view',
                'priority-events.view-all',
            ],
            Role::query()->where('key', 'admin-lab')->firstOrFail()
                ->permissions()->where('key', 'like', 'priority-events.%')->pluck('key')->sort()->values()->all(),
        );

        $this->assertSame(
            ['priority-events.cancel', 'priority-events.create', 'priority-events.view'],
            Role::query()->where('key', 'guru')->firstOrFail()
                ->permissions()->where('key', 'like', 'priority-events.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_priority_event_submission_may_conflict_but_approval_requires_explicit_reconciliation(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $event = $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '07:00',
            'endsAt' => '08:45',
            'category' => 'official_visit',
            'title' => 'Kunjungan Industri Prioritas',
            'participants' => 30,
            'description' => 'Kegiatan sekolah yang harus memakai Lab RPL 1.',
            'picName' => 'Waka Humas',
        ])
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.timeline.0.eventType', 'priority_event.submitted')
            ->assertJsonPath('data.timeline.0.payload.availabilityAtSubmission.state', 'scheduled')
            ->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/approve')
            ->assertStatus(409)
            ->assertJsonPath('code', 'PRIORITY_EVENT_RECONCILIATION_REQUIRED')
            ->assertJsonPath('details.availability.blockers.0.type', 'schedule_occurrence');

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'cancel',
            'reason' => 'Digantikan Priority Event pada tanggal ini.',
        ])->assertCreated();

        $approved = $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/approve')
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.timeline.1.eventType', 'priority_event.approved')
            ->json('data');

        $this->getJson($this->availabilityPath($fixture['labA']))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'blocked')
            ->assertJsonPath('data.blockers.0.type', 'priority_event')
            ->assertJsonPath('data.blockers.0.sourceId', $approved['id'])
            ->assertJsonPath('data.sourceCoverage.priorityEvents.status', 'covered');

        $this->postJson('/api/v1/laboratory-reservations', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '07:15',
            'endsAt' => '08:00',
            'activity' => 'Tidak boleh masuk',
            'participants' => 10,
            'picName' => 'Guru A',
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_UNAVAILABLE')
            ->assertJsonPath('details.availability.blockers.0.type', 'priority_event');
    }

    public function test_cancelling_approved_priority_event_releases_its_operational_blocker(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labA']);

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'cancel',
            'reason' => 'Slot disiapkan untuk Priority Event.',
        ])->assertCreated();

        $event = $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '07:00',
            'endsAt' => '08:45',
            'category' => 'school_event',
            'title' => 'Briefing Sekolah',
            'participants' => 25,
            'picName' => 'Admin Lab',
        ])->assertCreated()->json('data');

        $this->postJson('/api/v1/priority-events/'.$event['id'].'/cancel', ['reason' => 'missing precondition'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/approve')
            ->assertOk();

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/cancel', ['reason' => 'Kegiatan dipindahkan'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.timeline.2.eventType', 'priority_event.cancelled');

        $this->getJson($this->availabilityPath($fixture['labA']))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.blockerCount', 0);

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/priority-events/'.$event['id'].'/cancel', ['reason' => 'stale'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'PRIORITY_EVENT_VERSION_CONFLICT');
    }

    public function test_priority_event_scope_and_tenant_boundaries_fail_closed(): void
    {
        [$teacher, $school, $membership] = $this->actingAsRole(School::factory()->create(), 'guru');
        $fixture = $this->fixture($school);

        $event = $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-15',
            'startsAt' => '10:00',
            'endsAt' => '11:00',
            'category' => 'competition',
            'title' => 'Seleksi Lomba',
            'participants' => 12,
            'picName' => $teacher->name,
        ])->assertCreated()->json('data');

        $this->getJson('/api/v1/priority-events?from=2026-09-01&to=2026-09-30&scope=mine')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $event['id']);

        $this->getJson('/api/v1/priority-events?from=2026-09-01&to=2026-09-30&scope=all')
            ->assertForbidden()
            ->assertJsonPath('code', 'PRIORITY_EVENT_SCOPE_FORBIDDEN');

        $foreignSchool = School::factory()->create();
        $foreignFixture = $this->fixture($foreignSchool);

        $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $foreignFixture['labA']->id,
            'date' => '2026-09-15',
            'startsAt' => '12:00',
            'endsAt' => '13:00',
            'category' => 'other',
            'title' => 'Cross tenant',
            'participants' => 5,
            'picName' => 'Invalid',
        ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['laboratoryId']);

        $this->assertDatabaseHas('priority_events', [
            'id' => $event['id'],
            'requester_membership_id' => $membership->id,
            'school_id' => $school->id,
        ]);
    }

    public function test_approved_priority_event_prevents_second_priority_event_approval_on_same_window(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'kepala-lab');
        $fixture = $this->fixture($school);
        $this->activeSchedule($school, $fixture, '2026-09-14', $fixture['labB']);

        $first = $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '09:00',
            'endsAt' => '10:00',
            'category' => 'emergency',
            'title' => 'Event A',
            'participants' => 10,
            'picName' => 'Kepala Lab',
        ])->assertCreated()->json('data');

        $second = $this->postJson('/api/v1/priority-events', [
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '09:30',
            'endsAt' => '10:30',
            'category' => 'school_event',
            'title' => 'Event B',
            'participants' => 10,
            'picName' => 'Kepala Lab',
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$first['id'].'/approve')
            ->assertOk();

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/priority-events/'.$second['id'].'/approve')
            ->assertStatus(409)
            ->assertJsonPath('code', 'PRIORITY_EVENT_RECONCILIATION_REQUIRED')
            ->assertJsonPath('details.availability.blockers.0.type', 'priority_event');
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
    private function activeSchedule(School $school, array $fixture, string $date, Laboratory $lab): ScheduleOccurrence
    {
        $publication = TimetablePublication::query()->create([
            'school_id'=>$school->id,'source_system'=>'tessela','source_publication_id'=>'TT-PRIORITY',
            'source_version'=>1,'schema_version'=>'1.0','academic_reference_source'=>'smartlab',
            'source_school_id'=>$school->id,'source_academic_year_id'=>$fixture['year']->id,
            'source_semester_id'=>$fixture['semester']->id,'academic_year_id'=>$fixture['year']->id,
            'semester_id'=>$fixture['semester']->id,'published_at'=>'2026-09-05 00:00:00+00:00',
            'effective_from'=>'2026-09-01','effective_to'=>'2026-12-18','payload_sha256'=>str_repeat('p',64),
            'source_payload'=>['entries'=>[]],'status'=>'active',
            'validation_summary'=>['entriesReceived'=>1,'entriesNormalized'=>1,'occurrencesMaterialized'=>1,'errors'=>0,'warnings'=>0],
            'validated_at'=>now(),'activated_at'=>now(),
        ]);

        $entry = TimetableEntry::query()->create([
            'school_id'=>$school->id,'publication_id'=>$publication->id,'source_schedule_id'=>'SCH-PRIORITY-001',
            'teacher_id'=>$fixture['teacher']->id,'academic_class_id'=>$fixture['class']->id,'subject_id'=>$fixture['subject']->id,
            'lesson_period_set_id'=>$fixture['set']->id,'start_lesson_period_id'=>$fixture['start']->id,'end_lesson_period_id'=>$fixture['end']->id,
            'planned_laboratory_id'=>$lab->id,'activity_type'=>'practical','recurrence_kind'=>'single_date','weekday'=>null,
            'entry_effective_from'=>null,'entry_effective_to'=>null,'occurs_on'=>$date,'start_time_snapshot'=>'07:00:00',
            'end_time_snapshot'=>'08:45:00','instruction_period_count'=>2,'source_snapshots'=>[],
        ]);

        return ScheduleOccurrence::query()->create([
            'school_id'=>$school->id,'publication_id'=>$publication->id,'entry_id'=>$entry->id,'occurs_on'=>$date,
            'teacher_id'=>$fixture['teacher']->id,'academic_class_id'=>$fixture['class']->id,'subject_id'=>$fixture['subject']->id,
            'planned_laboratory_id'=>$lab->id,'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,'end_lesson_period_id'=>$fixture['end']->id,
            'start_time_snapshot'=>'07:00:00','end_time_snapshot'=>'08:45:00','activity_type'=>'practical',
        ]);
    }

    private function availabilityPath(Laboratory $lab): string
    {
        return '/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId'=>$lab->id,'date'=>'2026-09-14','startsAt'=>'07:00','endsAt'=>'08:45',
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
