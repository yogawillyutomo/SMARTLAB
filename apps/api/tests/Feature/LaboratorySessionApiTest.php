<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\PriorityEvent;
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
use Illuminate\Support\Carbon;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LaboratorySessionApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-09-14 07:05:00', 'Asia/Jakarta'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_session_permissions_and_teacher_membership_scope_are_server_authoritative(): void
    {
        $this->postJson('/api/v1/laboratory-sessions', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create(['timezone' => 'Asia/Jakarta']);
        $this->actingAsRole($school, 'siswa');

        $this->postJson('/api/v1/laboratory-sessions', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        [$guru, $school, $guruMembership] = $this->actingAsRole($school, 'guru');
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $guruMembership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $prepared = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
            'openingCondition' => 'Lab siap digunakan.',
        ])
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.status', 'prepared')
            ->assertJsonPath('data.source.type', 'schedule_occurrence')
            ->assertJsonPath('data.source.id', $occurrence->id)
            ->assertJsonPath('data.source.ownerMembershipId', $guruMembership->id)
            ->assertJsonPath('data.responsibility.name', $fixture['teacher']->name)
            ->json('data');

        $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_DUPLICATE_SOURCE')
            ->assertJsonPath('details.sessionId', $prepared['id']);

        $otherSchool = School::factory()->create(['timezone' => 'Asia/Jakarta']);
        $otherFixture = $this->fixture($otherSchool);
        $otherOccurrence = $this->publicationOccurrence($otherSchool, $otherFixture, 1, 'active', '2026-09-14');

        $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $otherOccurrence->id,
        ])
            ->assertNotFound()
            ->assertJsonPath('code', 'LABORATORY_SESSION_SOURCE_NOT_FOUND');

        $this->assertSame(
            ['sessions.cancel', 'sessions.end', 'sessions.prepare', 'sessions.start', 'sessions.view'],
            Role::query()->where('key', 'guru')->firstOrFail()
                ->permissions()->where('key', 'like', 'sessions.%')->pluck('key')->sort()->values()->all(),
        );

        $this->assertSame(
            ['sessions.cancel', 'sessions.end', 'sessions.export', 'sessions.prepare', 'sessions.start', 'sessions.view', 'sessions.view-all'],
            Role::query()->where('key', 'admin-lab')->firstOrFail()
                ->permissions()->where('key', 'like', 'sessions.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_schedule_session_lifecycle_and_actual_occupancy_extend_beyond_planned_window(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
            'openingCondition' => '36 PC siap.',
        ])->assertCreated()->json('data');

        $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $started = $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.timeline.1.eventType', 'laboratory_session.started')
            ->json('data');

        $this->getJson('/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '09:00',
            'endsAt' => '09:30',
        ]))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'blocked')
            ->assertJsonPath('data.blockers.0.type', 'laboratory_session')
            ->assertJsonPath('data.blockers.0.sourceId', $started['id'])
            ->assertJsonPath('data.sourceCoverage.laboratorySessions.status', 'covered');

        Carbon::setTestNow(Carbon::parse('2026-09-14 09:10:00', 'Asia/Jakarta'));

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', [
                'endOutcome' => 'completed',
                'closingCondition' => 'Lab ditinggalkan rapi.',
            ])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'ended')
            ->assertJsonPath('data.endOutcome', 'completed')
            ->assertJsonPath('data.timeline.2.payload.activityReportPendingS3_3', true)
            ->json('data');

        $this->getJson('/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId' => $fixture['labA']->id,
            'date' => '2026-09-14',
            'startsAt' => '09:15',
            'endsAt' => '09:30',
        ]))
            ->assertOk()
            ->assertJsonPath('data.available', true);

        $this->withHeader('If-Match', '"3"')
            ->postJson('/api/v1/laboratory-sessions/'.$ended['id'].'/cancel', ['reason' => 'Tidak boleh'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_STATE_CONFLICT');
    }

    public function test_approved_priority_event_can_start_by_excluding_only_its_own_blocker_and_cannot_be_cancelled_mid_session(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'admin-lab',
        );
        $fixture = $this->fixture($school);
        $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14', $fixture['labB']);

        $event = PriorityEvent::query()->create([
            'school_id' => $school->id,
            'event_number' => 'PEV-20260914-SESSION',
            'laboratory_id' => $fixture['labA']->id,
            'requester_user_id' => $actor->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $actor->name,
            'requester_email_snapshot' => $actor->email,
            'event_date' => '2026-09-14',
            'starts_at' => '10:00:00',
            'ends_at' => '11:00:00',
            'category' => 'official_visit',
            'title' => 'Kunjungan Industri',
            'participants' => 20,
            'description' => null,
            'pic_name' => $actor->name,
            'status' => 'approved',
            'rejection_reason' => null,
            'decided_at' => now(),
            'cancelled_at' => null,
            'version' => 2,
        ]);

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'priority_event',
            'sourceId' => $event->id,
        ])->assertCreated()->json('data');

        Carbon::setTestNow(Carbon::parse('2026-09-14 10:05:00', 'Asia/Jakarta'));

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.source.type', 'priority_event');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/priority-events/'.$event->id.'/cancel', ['reason' => 'Tidak boleh saat berjalan'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_ACTIVE_SOURCE_CONFLICT')
            ->assertJsonPath('details.session.id', $session['id']);
    }

    public function test_prepared_session_blocks_source_mutation_until_explicitly_cancelled(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'admin-lab',
        );
        $fixture = $this->fixture($school);
        $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14', $fixture['labB']);

        $reservation = LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-SESSION',
            'laboratory_id' => $fixture['labA']->id,
            'requester_user_id' => $actor->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $actor->name,
            'requester_email_snapshot' => $actor->email,
            'reservation_date' => '2026-09-14',
            'starts_at' => '10:00:00',
            'ends_at' => '11:00:00',
            'activity' => 'Praktikum tambahan',
            'participants' => 20,
            'device_needs' => null,
            'notes' => null,
            'pic_name' => $actor->name,
            'status' => 'approved',
            'rejection_reason' => null,
            'decided_at' => now(),
            'cancelled_at' => null,
            'version' => 2,
        ]);

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'laboratory_reservation',
            'sourceId' => $reservation->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation->id.'/cancel', ['reason' => 'Bentrok'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_ACTIVE_SOURCE_CONFLICT')
            ->assertJsonPath('details.session.id', $session['id']);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/cancel', ['reason' => 'Tidak jadi dilaksanakan'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation->id.'/cancel', ['reason' => 'Sekarang aman'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');
    }

    public function test_laboratory_cannot_be_deactivated_while_session_is_prepared_or_in_progress(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->patchJson('/api/v1/laboratories/'.$fixture['labA']->id, ['status' => 'inactive'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_ACTIVE_SOURCE_CONFLICT')
            ->assertJsonPath('details.operation', 'deactivate_laboratory')
            ->assertJsonPath('details.session.id', $session['id']);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        $this->patchJson('/api/v1/laboratories/'.$fixture['labA']->id, ['status' => 'inactive'])
            ->assertStatus(409)
            ->assertJsonPath('details.session.status', 'in_progress');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', ['endOutcome' => 'interrupted'])
            ->assertOk();

        $this->patchJson('/api/v1/laboratories/'.$fixture['labA']->id, ['status' => 'inactive'])
            ->assertOk()
            ->assertJsonPath('data.status', 'inactive');
    }

    public function test_schedule_exception_cannot_change_a_prepared_schedule_session_source(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->postJson('/api/v1/schedule-exceptions', [
            'occurrenceId' => $occurrence->id,
            'resolution' => 'relocate',
            'replacementLaboratoryId' => $fixture['labB']->id,
            'reason' => 'Coba ubah source setelah prepare.',
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_SESSION_ACTIVE_SOURCE_CONFLICT')
            ->assertJsonPath('details.operation', 'apply_schedule_exception')
            ->assertJsonPath('details.session.id', $session['id']);
    }

    public function test_start_fails_closed_when_source_evidence_changes_outside_supported_mutation_path(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'admin-lab',
        );
        $fixture = $this->fixture($school);
        $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14', $fixture['labB']);

        $reservation = LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-STALE',
            'laboratory_id' => $fixture['labA']->id,
            'requester_user_id' => $actor->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $actor->name,
            'requester_email_snapshot' => $actor->email,
            'reservation_date' => '2026-09-14',
            'starts_at' => '12:00:00',
            'ends_at' => '13:00:00',
            'activity' => 'Source drift test',
            'participants' => 10,
            'pic_name' => $actor->name,
            'status' => 'approved',
            'decided_at' => now(),
            'version' => 2,
        ]);

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'laboratory_reservation',
            'sourceId' => $reservation->id,
        ])->assertCreated()->json('data');

        $reservation->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
            'version' => 3,
        ]);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertStatus(409)
            ->assertJsonPath('code', 'SESSION_SOURCE_CHANGED')
            ->assertJsonPath('details.reason', 'LABORATORY_SESSION_SOURCE_INELIGIBLE');
    }

    public function test_timetable_activation_is_blocked_by_prepared_session_from_current_publication(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
        $fixture = $this->fixture($school);
        $currentOccurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');
        $candidateOccurrence = $this->publicationOccurrence($school, $fixture, 2, 'validated', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $currentOccurrence->id,
        ])->assertCreated()->json('data');

        $candidate = $candidateOccurrence->publication;

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', false)
            ->assertJsonPath('data.blockers.0.type', 'active_session_conflict')
            ->assertJsonPath('data.blockers.0.details.sessionNumber', $session['sessionNumber']);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED')
            ->assertJsonPath('details.impact.blockers.0.type', 'active_session_conflict');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/cancel', ['reason' => 'Reconcile sebelum publication cutover'])
            ->assertOk();

        $this->getJson('/api/v1/timetable-publications/'.$candidate->id.'/impact')
            ->assertOk()
            ->assertJsonPath('data.clear', true);

        $this->postJson('/api/v1/timetable-publications/'.$candidate->id.'/activate')
            ->assertOk()
            ->assertJsonPath('data.status', 'active');
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
            'school_id'=>$school->id,'code'=>'XI-PPLG-1','name'=>'XI PPLG 1','grade_level'=>11,
            'student_count'=>32,'status'=>'active','version'=>1,
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
    private function publicationOccurrence(
        School $school,
        array $fixture,
        int $version,
        string $status,
        string $date,
        ?Laboratory $laboratory = null,
    ): ScheduleOccurrence {
        $laboratory ??= $fixture['labA'];

        $publication = TimetablePublication::query()->create([
            'school_id'=>$school->id,
            'source_system'=>'tessela',
            'source_publication_id'=>'TT-SESSION',
            'source_version'=>$version,
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
            'payload_sha256'=>str_repeat((string) $version,64),
            'source_payload'=>['entries'=>[]],
            'status'=>$status,
            'validation_summary'=>['entriesReceived'=>1,'entriesNormalized'=>1,'occurrencesMaterialized'=>1,'errors'=>0,'warnings'=>0],
            'validated_at'=>now(),
            'activated_at'=>$status === 'active' ? now() : null,
        ]);

        $entry = TimetableEntry::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'source_schedule_id'=>'SCH-SESSION-001',
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'planned_laboratory_id'=>$laboratory->id,
            'activity_type'=>'practical',
            'recurrence_kind'=>'single_date',
            'weekday'=>null,
            'entry_effective_from'=>null,
            'entry_effective_to'=>null,
            'occurs_on'=>$date,
            'start_time_snapshot'=>'07:00:00',
            'end_time_snapshot'=>'08:45:00',
            'instruction_period_count'=>2,
            'source_snapshots'=>[],
        ]);

        return ScheduleOccurrence::query()->create([
            'school_id'=>$school->id,
            'publication_id'=>$publication->id,
            'entry_id'=>$entry->id,
            'occurs_on'=>$date,
            'teacher_id'=>$fixture['teacher']->id,
            'academic_class_id'=>$fixture['class']->id,
            'subject_id'=>$fixture['subject']->id,
            'planned_laboratory_id'=>$laboratory->id,
            'lesson_period_set_id'=>$fixture['set']->id,
            'start_lesson_period_id'=>$fixture['start']->id,
            'end_lesson_period_id'=>$fixture['end']->id,
            'start_time_snapshot'=>'07:00:00',
            'end_time_snapshot'=>'08:45:00',
            'activity_type'=>'practical',
        ]);
    }

    /** @return array{User,School,SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id'=>$school->id,
            'user_id'=>$user->id,
            'status'=>'active',
        ]);
        $role = Role::query()->where('key',$roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        Sanctum::actingAs($user);

        return [$user,$school,$membership];
    }
}
