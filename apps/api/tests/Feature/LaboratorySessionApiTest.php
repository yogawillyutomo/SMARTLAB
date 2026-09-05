<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\ActivityReportAttachment;
use App\Models\ActivityReportEvent;
use App\Models\Device;
use App\Models\Incident;
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
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
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

    public function test_session_source_read_model_is_ownership_safe_and_exposes_existing_execution(): void
    {
        [$guru, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $reservation = LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-SOURCE',
            'laboratory_id' => $fixture['labA']->id,
            'requester_user_id' => $guru->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $guru->name,
            'requester_email_snapshot' => $guru->email,
            'reservation_date' => '2026-09-14',
            'starts_at' => '10:00:00',
            'ends_at' => '11:00:00',
            'activity' => 'Praktikum tambahan',
            'participants' => 20,
            'pic_name' => $guru->name,
            'status' => 'approved',
            'decided_at' => now(),
            'version' => 2,
        ]);

        $event = PriorityEvent::query()->create([
            'school_id' => $school->id,
            'event_number' => 'PEV-20260914-SOURCE',
            'laboratory_id' => $fixture['labB']->id,
            'requester_user_id' => $guru->id,
            'requester_membership_id' => $membership->id,
            'requester_name_snapshot' => $guru->name,
            'requester_email_snapshot' => $guru->email,
            'event_date' => '2026-09-14',
            'starts_at' => '12:00:00',
            'ends_at' => '13:00:00',
            'category' => 'exam',
            'title' => 'Ujian praktik',
            'participants' => 18,
            'pic_name' => $guru->name,
            'status' => 'approved',
            'decided_at' => now(),
            'version' => 2,
        ]);

        $otherUser = User::factory()->create();
        $otherMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $otherUser->id,
            'status' => 'active',
        ]);
        LaboratoryReservation::query()->create([
            'school_id' => $school->id,
            'reservation_number' => 'RSV-20260914-OTHER',
            'laboratory_id' => $fixture['labB']->id,
            'requester_user_id' => $otherUser->id,
            'requester_membership_id' => $otherMembership->id,
            'requester_name_snapshot' => $otherUser->name,
            'requester_email_snapshot' => $otherUser->email,
            'reservation_date' => '2026-09-14',
            'starts_at' => '14:00:00',
            'ends_at' => '15:00:00',
            'activity' => 'Milik orang lain',
            'participants' => 10,
            'pic_name' => $otherUser->name,
            'status' => 'approved',
            'decided_at' => now(),
            'version' => 2,
        ]);

        $this->getJson('/api/v1/laboratory-session-sources?'.http_build_query([
            'from' => '2026-09-14',
            'to' => '2026-09-14',
            'scope' => 'mine',
        ]))
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('meta.scope', 'mine')
            ->assertJsonPath('data.0.sourceType', 'schedule_occurrence')
            ->assertJsonPath('data.0.sourceId', $occurrence->id)
            ->assertJsonPath('data.0.responsibility.name', $fixture['teacher']->name)
            ->assertJsonPath('data.1.sourceType', 'laboratory_reservation')
            ->assertJsonPath('data.1.sourceId', $reservation->id)
            ->assertJsonPath('data.2.sourceType', 'priority_event')
            ->assertJsonPath('data.2.sourceId', $event->id);

        $prepared = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->getJson('/api/v1/laboratory-session-sources?'.http_build_query([
            'from' => '2026-09-14',
            'to' => '2026-09-14',
            'scope' => 'mine',
        ]))
            ->assertOk()
            ->assertJsonPath('data.0.session.id', $prepared['id'])
            ->assertJsonPath('data.0.session.status', 'prepared')
            ->assertJsonPath('data.0.session.version', 1);

        $this->getJson('/api/v1/laboratory-session-sources?'.http_build_query([
            'from' => '2026-09-14',
            'to' => '2026-09-14',
            'scope' => 'all',
        ]))
            ->assertForbidden()
            ->assertJsonPath('code', 'LABORATORY_SESSION_SCOPE_FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');

        $this->getJson('/api/v1/laboratory-session-sources?'.http_build_query([
            'from' => '2026-09-14',
            'to' => '2026-09-14',
            'scope' => 'all',
        ]))
            ->assertOk()
            ->assertJsonCount(4, 'data');
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
            ->assertJsonPath('data.activityReport.status', 'draft')
            ->assertJsonPath('data.activityReport.reportType', 'practicum')
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

    public function test_activity_report_lifecycle_permissions_and_tenant_scope_are_server_authoritative(): void
    {
        [$guru, $school, $guruMembership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $guruMembership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', [
                'endOutcome' => 'completed',
                'closingCondition' => 'Semua perangkat dimatikan.',
            ])
            ->assertOk()
            ->assertJsonPath('data.activityReport.status', 'draft')
            ->json('data');

        $reportId = $ended['activityReport']['id'];

        $this->assertDatabaseHas('activity_reports', [
            'id' => $reportId,
            'school_id' => $school->id,
            'session_id' => $session['id'],
            'origin' => 'session',
            'status' => 'draft',
            'report_type' => 'practicum',
            'owner_membership_id' => $guruMembership->id,
            'version' => 1,
        ]);

        $this->withHeader('If-Match', '')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'commonContent' => ['objective' => 'Menguji DOM', 'outcomeReflection' => 'Tujuan tercapai.'],
            ])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'presentCount' => 31,
                'absentCount' => 1,
                'attendanceNotes' => 'Satu siswa tidak hadir; detail presensi tetap di HADIRA.',
                'commonContent' => [
                    'objective' => 'Menguji DOM',
                    'material' => 'DOM dasar',
                    'resources' => 'Browser dan editor',
                    'issues' => null,
                    'followUp' => 'Latihan lanjutan',
                    'outcomeReflection' => 'Tujuan tercapai.',
                ],
                'typeSpecificContent' => [
                    'topic' => 'DOM',
                    'steps' => 'Query elemen lalu ubah isi.',
                    'softwareTools' => 'VS Code, browser',
                    'learningOutcome' => 'Siswa mampu memanipulasi DOM.',
                ],
            ])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.attendance.presentCount', 31)
            ->assertJsonPath('data.timeline.1.eventType', 'activity_report.updated');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/submit')
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'submitted');

        $this->withHeader('If-Match', '"3"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/verify')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
        $this->getJson('/api/v1/activity-reports/'.$reportId)
            ->assertNotFound()
            ->assertJsonPath('code', 'ACTIVITY_REPORT_NOT_FOUND');

        [$reviewer] = $this->actingAsRole($school, 'kepala-lab');

        $this->withHeader('If-Match', '"3"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/request-revision', [
                'reason' => 'Tambahkan tindak lanjut yang lebih spesifik.',
            ])
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.status', 'revision_required');

        Sanctum::actingAs($guru);

        $this->withHeader('If-Match', '"4"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/reopen')
            ->assertOk()
            ->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.timeline.4.eventType', 'activity_report.reopened');

        $this->withHeader('If-Match', '"5"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/submit')
            ->assertOk()
            ->assertHeader('ETag', '"6"')
            ->assertJsonPath('data.status', 'submitted');

        Sanctum::actingAs($reviewer);

        $this->withHeader('If-Match', '"6"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/verify')
            ->assertOk()
            ->assertHeader('ETag', '"7"')
            ->assertJsonPath('data.status', 'verified')
            ->assertJsonPath('data.timeline.6.eventType', 'activity_report.verified');

        $this->assertSame(
            ['activity-reports.edit', 'activity-reports.submit', 'activity-reports.view'],
            Role::query()->where('key', 'guru')->firstOrFail()
                ->permissions()->where('key', 'like', 'activity-reports.%')->pluck('key')->sort()->values()->all(),
        );

        $this->assertSame(
            [
                'activity-reports.create-backfill',
                'activity-reports.edit',
                'activity-reports.export',
                'activity-reports.request-revision',
                'activity-reports.submit',
                'activity-reports.verify',
                'activity-reports.view',
                'activity-reports.view-all',
            ],
            Role::query()->where('key', 'admin-lab')->firstOrFail()
                ->permissions()->where('key', 'like', 'activity-reports.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_manual_backfill_is_elevated_audited_and_never_creates_a_fake_session(): void
    {
        [$admin, $school] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'admin-lab',
        );
        $fixture = $this->fixture($school);
        $beforeSessions = \App\Models\LaboratorySession::query()->count();

        $backfill = $this->postJson('/api/v1/activity-reports/backfill', [
            'reportType' => 'general',
            'laboratoryId' => $fixture['labA']->id,
            'occurredOn' => '2026-09-01',
            'manualBackfillReason' => 'Migrasi jurnal kertas sebelum cutover S3.',
            'responsibleName' => 'Guru Arsip',
            'activityDescription' => 'Penggunaan laboratorium historis.',
            'plannedParticipantCount' => 30,
            'presentCount' => 29,
            'absentCount' => 1,
            'commonContent' => [
                'objective' => 'Dokumentasi aktivitas historis',
                'outcomeReflection' => 'Bukti telah direkonsiliasi.',
            ],
            'typeSpecificContent' => [
                'activityOwner' => 'PPLG',
                'result' => 'Kegiatan selesai.',
            ],
        ])
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.origin', 'manual_backfill')
            ->assertJsonPath('data.sessionId', null)
            ->assertJsonPath('data.timeline.0.eventType', 'activity_report.manual_backfill_created')
            ->json('data');

        $this->assertSame($beforeSessions, \App\Models\LaboratorySession::query()->count());
        $this->assertDatabaseHas('activity_reports', [
            'id' => $backfill['id'],
            'origin' => 'manual_backfill',
            'session_id' => null,
            'created_by_user_id' => $admin->id,
        ]);

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/activity-reports/'.$backfill['id'], [
                'reportType' => 'exam',
                'typeSpecificContent' => ['activityOwner' => 'invalid for exam'],
            ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->actingAsRole($school, 'guru');

        $this->postJson('/api/v1/activity-reports/backfill', [
            'reportType' => 'general',
            'laboratoryId' => $fixture['labA']->id,
            'occurredOn' => '2026-09-01',
            'manualBackfillReason' => 'Tidak boleh',
            'responsibleName' => 'Guru',
            'activityDescription' => 'Bypass',
        ])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_execution_observation_is_explicit_and_incident_promotion_is_idempotent(): void
    {
        [$guru, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $device = Device::factory()->create([
            'school_id' => $school->id,
            'home_laboratory_id' => $fixture['labA']->id,
            'device_code' => 'PC-RPL1-12',
            'lifecycle_status' => 'in_service',
        ]);

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-14 07:30:00', 'Asia/Jakarta'));

        $beforeIncidents = Incident::query()->count();

        $observation = $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations', [
            'subjectType' => 'device',
            'referenceId' => $device->id,
            'summary' => 'PC mati mendadak saat praktikum.',
            'severity' => 'high',
            'observedAt' => now()->toISOString(),
        ])
            ->assertCreated()
            ->assertJsonPath('data.subjectType', 'device')
            ->assertJsonPath('data.referenceId', $device->id)
            ->assertJsonPath('data.referenceCode', 'PC-RPL1-12')
            ->assertJsonPath('data.incident', null)
            ->assertJsonPath('data.version', 1)
            ->json('data');

        $this->assertSame($beforeIncidents, Incident::query()->count(), 'Observation creation must not auto-create an Incident.');

        $this->getJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $observation['id']);

        $promotePayload = [
            'category' => 'hardware',
            'priority' => 'high',
            'title' => 'PC RPL1-12 mati saat praktikum',
            'description' => 'Temuan dipromosikan secara eksplisit dari Pelaksanaan Lab.',
            'impact' => 'Satu workstation tidak dapat digunakan.',
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => 'Sudah mencoba restart dan memeriksa kabel daya.',
        ];

        $promoted = $this->postJson('/api/v1/session-observations/'.$observation['id'].'/promote-incident', $promotePayload)
            ->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.incident.status', 'reported')
            ->json('data');

        $this->assertSame($beforeIncidents + 1, Incident::query()->count());
        $this->assertDatabaseHas('incidents', [
            'id' => $promoted['incident']['id'],
            'school_id' => $school->id,
            'laboratory_id' => $fixture['labA']->id,
            'device_id' => $device->id,
            'reporter_membership_id' => $membership->id,
        ]);
        $this->assertDatabaseHas('session_issue_observations', [
            'id' => $observation['id'],
            'incident_id' => $promoted['incident']['id'],
            'version' => 2,
        ]);

        $this->postJson('/api/v1/session-observations/'.$observation['id'].'/promote-incident', [
            ...$promotePayload,
            'title' => 'Retry dengan payload berbeda tidak membuat tiket kedua',
        ])
            ->assertOk()
            ->assertJsonPath('data.incident.id', $promoted['incident']['id']);

        $this->assertSame($beforeIncidents + 1, Incident::query()->count(), 'Promotion retry must remain one Incident per observation.');

        $otherDevice = Device::factory()->create([
            'school_id' => $school->id,
            'home_laboratory_id' => $fixture['labB']->id,
            'device_code' => 'PC-RPL2-01',
            'lifecycle_status' => 'in_service',
        ]);

        $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations', [
            'subjectType' => 'device',
            'referenceId' => $otherDevice->id,
            'summary' => 'Perangkat dari lab lain tidak boleh dipakai sebagai evidence.',
            'severity' => 'medium',
            'observedAt' => now()->toISOString(),
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'SESSION_ISSUE_OBSERVATION_REFERENCE_INVALID');

        $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations', [
            'subjectType' => 'asset',
            'referenceId' => 'legacy-asset-1',
            'summary' => 'Tidak boleh mengarang canonical Asset ID sebelum S4.',
            'severity' => 'low',
            'observedAt' => now()->toISOString(),
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertSame(
            ['session-observations.create', 'session-observations.promote', 'session-observations.view'],
            Role::query()->where('key', 'guru')->firstOrFail()
                ->permissions()->where('key', 'like', 'session-observations.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_observation_creation_closes_when_report_is_no_longer_an_editable_draft(): void
    {
        [, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-14 08:40:00', 'Asia/Jakarta'));

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', ['endOutcome' => 'completed'])
            ->assertOk()
            ->json('data');

        $reportId = $ended['activityReport']['id'];

        $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations', [
            'subjectType' => 'facility',
            'summary' => 'AC laboratorium kurang dingin.',
            'severity' => 'medium',
            'observedAt' => now()->subMinutes(5)->toISOString(),
        ])->assertCreated();

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'commonContent' => [
                    'objective' => 'Praktikum DOM',
                    'outcomeReflection' => 'Kegiatan selesai.',
                ],
                'typeSpecificContent' => [
                    'topic' => 'DOM',
                    'learningOutcome' => 'Siswa memahami DOM.',
                ],
            ])
            ->assertOk()
            ->assertHeader('ETag', '"2"');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/submit')
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted');

        $this->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/observations', [
            'subjectType' => 'other',
            'summary' => 'Evidence baru tidak boleh masuk setelah submit.',
            'severity' => 'low',
            'observedAt' => now()->subMinutes(2)->toISOString(),
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SESSION_ISSUE_OBSERVATION_STATE_CONFLICT');
    }

    public function test_activity_report_attachment_is_private_versioned_and_draft_only(): void
    {
        Storage::fake('local');

        [, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-14 08:40:00', 'Asia/Jakarta'));

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', ['endOutcome' => 'completed'])
            ->assertOk()
            ->json('data');

        $reportId = $ended['activityReport']['id'];
        $file = UploadedFile::fake()->image('bukti-kondisi.png', 320, 200);

        $attachment = $this->withHeader('If-Match', '"1"')
            ->post('/api/v1/activity-reports/'.$reportId.'/attachments', ['file' => $file], ['Accept' => 'application/json'])
            ->assertCreated()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('reportVersion', 2)
            ->assertJsonPath('data.fileName', 'bukti-kondisi.png')
            ->assertJsonPath('data.mediaType', 'image/png')
            ->assertJsonPath('data.available', true)
            ->json('data');

        $row = ActivityReportAttachment::query()->findOrFail($attachment['id']);
        Storage::disk('local')->assertExists($row->storage_key);
        $this->assertSame(64, strlen($attachment['sha256']));
        $this->assertStringNotContainsString('storageKey', json_encode($attachment, JSON_THROW_ON_ERROR));

        $this->getJson('/api/v1/activity-reports/'.$reportId.'/attachments')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $attachment['id'])
            ->assertJsonPath('data.0.available', true);

        $this->get('/api/v1/activity-reports/'.$reportId.'/attachments/'.$attachment['id'].'/download', ['Accept' => 'application/octet-stream'])
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('X-Content-Type-Options', 'nosniff');

        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'commonContent' => [
                    'objective' => 'Praktikum DOM',
                    'outcomeReflection' => 'Kegiatan selesai.',
                ],
                'typeSpecificContent' => [
                    'topic' => 'DOM',
                    'learningOutcome' => 'Siswa memahami DOM.',
                ],
            ])
            ->assertOk()
            ->assertHeader('ETag', '"3"');

        $this->withHeader('If-Match', '"3"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/submit')
            ->assertOk()
            ->assertHeader('ETag', '"4"');

        $this->withHeader('If-Match', '"4"')
            ->post('/api/v1/activity-reports/'.$reportId.'/attachments', [
                'file' => UploadedFile::fake()->image('terlambat.png', 100, 100),
            ], ['Accept' => 'application/json'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVITY_REPORT_STATE_CONFLICT');

        Storage::disk('local')->delete($row->storage_key);

        $this->getJson('/api/v1/activity-reports/'.$reportId.'/attachments')
            ->assertOk()
            ->assertJsonPath('data.0.available', false);

        $this->get('/api/v1/activity-reports/'.$reportId.'/attachments/'.$attachment['id'].'/download', ['Accept' => 'application/json'])
            ->assertStatus(410)
            ->assertJsonPath('code', 'ACTIVITY_REPORT_ATTACHMENT_UNAVAILABLE');
    }

    public function test_offline_activity_report_draft_sync_is_idempotent_and_audited(): void
    {
        [, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-14 08:40:00', 'Asia/Jakarta'));

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', ['endOutcome' => 'completed'])
            ->assertOk()
            ->json('data');

        $reportId = $ended['activityReport']['id'];
        $mutationId = Str::uuid()->toString();
        $payload = [
            'clientMutationId' => $mutationId,
            'baseVersion' => 1,
            'patch' => [
                'presentCount' => 31,
                'absentCount' => 1,
                'attendanceNotes' => 'Draft disimpan ketika koneksi tidak stabil.',
                'commonContent' => [
                    'objective' => 'Praktikum DOM',
                    'outcomeReflection' => 'Draft offline tersimpan dan disinkronkan.',
                ],
                'typeSpecificContent' => [
                    'topic' => 'DOM',
                    'learningOutcome' => 'Siswa memahami DOM.',
                ],
            ],
        ];

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', $payload)
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('sync.clientMutationId', $mutationId)
            ->assertJsonPath('sync.baseVersion', 1)
            ->assertJsonPath('sync.appliedVersion', 2)
            ->assertJsonPath('sync.replayed', false)
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.attendance.presentCount', 31)
            ->assertJsonPath('data.timeline.1.eventType', 'activity_report.offline_sync_applied');

        $this->assertDatabaseHas('activity_report_draft_sync_mutations', [
            'school_id' => $school->id,
            'report_id' => $reportId,
            'client_mutation_id' => $mutationId,
            'base_version' => 1,
            'resulting_version' => 2,
        ]);

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', $payload)
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('sync.replayed', true)
            ->assertJsonPath('sync.appliedVersion', 2)
            ->assertJsonPath('data.version', 2);

        $this->assertDatabaseCount('activity_report_draft_sync_mutations', 1);
        $this->assertSame(
            1,
            ActivityReportEvent::query()
                ->where('report_id', $reportId)
                ->where('event_type', 'activity_report.offline_sync_applied')
                ->count(),
        );

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', [
            ...$payload,
            'patch' => [
                ...$payload['patch'],
                'attendanceNotes' => 'Payload berbeda memakai mutation ID yang sama.',
            ],
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVITY_REPORT_SYNC_MUTATION_REUSED');

        $this->assertDatabaseHas('activity_reports', [
            'id' => $reportId,
            'version' => 2,
            'attendance_notes' => 'Draft disimpan ketika koneksi tidak stabil.',
        ]);

        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'attendanceNotes' => 'Perubahan server sesudah mutation offline sudah applied.',
            ])
            ->assertOk()
            ->assertHeader('ETag', '"3"');

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', $payload)
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('sync.replayed', true)
            ->assertJsonPath('sync.appliedVersion', 2)
            ->assertJsonPath('data.version', 3)
            ->assertJsonPath('data.attendance.notes', 'Perubahan server sesudah mutation offline sudah applied.');

        $this->assertDatabaseCount('activity_report_draft_sync_mutations', 1);
        $this->assertSame(
            1,
            ActivityReportEvent::query()
                ->where('report_id', $reportId)
                ->where('event_type', 'activity_report.offline_sync_applied')
                ->count(),
        );
    }

    public function test_offline_activity_report_sync_conflict_never_overwrites_newer_server_state(): void
    {
        [, $school, $membership] = $this->actingAsRole(
            School::factory()->create(['timezone' => 'Asia/Jakarta']),
            'guru',
        );
        $fixture = $this->fixture($school);
        $fixture['teacher']->update(['membership_id' => $membership->id]);
        $occurrence = $this->publicationOccurrence($school, $fixture, 1, 'active', '2026-09-14');

        $session = $this->postJson('/api/v1/laboratory-sessions', [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => $occurrence->id,
        ])->assertCreated()->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/start')
            ->assertOk();

        Carbon::setTestNow(Carbon::parse('2026-09-14 08:40:00', 'Asia/Jakarta'));

        $ended = $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-sessions/'.$session['id'].'/end', ['endOutcome' => 'completed'])
            ->assertOk()
            ->json('data');

        $reportId = $ended['activityReport']['id'];

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'attendanceNotes' => 'Perubahan kanonik dari perangkat lain.',
            ])
            ->assertOk()
            ->assertHeader('ETag', '"2"');

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', [
            'clientMutationId' => Str::uuid()->toString(),
            'baseVersion' => 1,
            'patch' => [
                'attendanceNotes' => 'Draft offline lama yang tidak boleh overwrite.',
            ],
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVITY_REPORT_OFFLINE_SYNC_CONFLICT')
            ->assertJsonPath('details.reportId', $reportId)
            ->assertJsonPath('details.currentVersion', 2)
            ->assertJsonPath('details.currentStatus', 'draft');

        $this->assertDatabaseMissing('activity_report_draft_sync_mutations', [
            'report_id' => $reportId,
            'base_version' => 1,
        ]);
        $this->assertDatabaseHas('activity_reports', [
            'id' => $reportId,
            'version' => 2,
            'attendance_notes' => 'Perubahan kanonik dari perangkat lain.',
        ]);

        $this->withHeader('If-Match', '"2"')
            ->patchJson('/api/v1/activity-reports/'.$reportId, [
                'commonContent' => [
                    'objective' => 'Praktikum DOM',
                    'outcomeReflection' => 'Kegiatan selesai.',
                ],
                'typeSpecificContent' => [
                    'topic' => 'DOM',
                    'learningOutcome' => 'Siswa memahami DOM.',
                ],
            ])
            ->assertOk()
            ->assertHeader('ETag', '"3"');

        $this->withHeader('If-Match', '"3"')
            ->postJson('/api/v1/activity-reports/'.$reportId.'/submit')
            ->assertOk()
            ->assertHeader('ETag', '"4"');

        $this->postJson('/api/v1/activity-reports/'.$reportId.'/sync-draft', [
            'clientMutationId' => Str::uuid()->toString(),
            'baseVersion' => 4,
            'patch' => ['attendanceNotes' => 'Tidak boleh diterapkan setelah submit.'],
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVITY_REPORT_STATE_CONFLICT');

        $this->assertDatabaseHas('activity_reports', [
            'id' => $reportId,
            'version' => 4,
            'status' => 'submitted',
        ]);
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
