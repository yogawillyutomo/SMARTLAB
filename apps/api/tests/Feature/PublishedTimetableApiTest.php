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
use App\Models\TimetablePublicationEvent;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class PublishedTimetableApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_authentication_and_schedule_permissions_precede_payload_validation(): void
    {
        $this->postJson('/api/v1/timetable-publications', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');
        $this->postJson('/api/v1/timetable-publications', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');
        $this->postJson('/api/v1/timetable-publications', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors([
                'schemaVersion',
                'sourceSystem',
                'sourcePublicationId',
                'sourceVersion',
                'academicReferenceSource',
                'schoolSourceId',
                'academicYearSourceId',
                'semesterSourceId',
                'publishedAt',
                'effectiveFrom',
                'effectiveTo',
                'entries',
                'unexpected',
            ]);

        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();

        $this->assertSame(
            ['schedules.activate', 'schedules.ingest', 'schedules.view'],
            $admin->permissions()->where('key', 'like', 'schedules.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['schedules.view'],
            $head->permissions()->where('key', 'like', 'schedules.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['schedules.view'],
            $teacher->permissions()->where('key', 'like', 'schedules.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_valid_publication_is_normalized_materialized_and_audited(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);

        $response = $this->postJson('/api/v1/timetable-publications', $this->payload($school, $fixture))
            ->assertCreated()
            ->assertHeader('X-Timetable-Replayed', 'false')
            ->assertJsonPath('data.status', 'validated')
            ->assertJsonPath('data.sourceSystem', 'tessela')
            ->assertJsonPath('data.sourceVersion', 1)
            ->assertJsonPath('data.academicYearId', $fixture['year']->id)
            ->assertJsonPath('data.semesterId', $fixture['semester']->id)
            ->assertJsonPath('data.validationSummary.entriesReceived', 1)
            ->assertJsonPath('data.validationSummary.entriesNormalized', 1)
            ->assertJsonPath('data.validationSummary.occurrencesMaterialized', 3)
            ->assertJsonPath('data.validationSummary.errors', 0)
            ->assertJsonPath('data.validationSummary.warnings', 1);

        $publicationId = $response->json('data.id');
        $this->assertSame(64, strlen((string) $response->json('data.payloadSha256')));
        $this->assertDatabaseCount('timetable_publications', 1);
        $this->assertDatabaseCount('timetable_entries', 1);
        $this->assertDatabaseCount('schedule_occurrences', 3);

        $entry = TimetableEntry::query()->sole();
        $this->assertSame(2, $entry->instruction_period_count);
        $this->assertSame('07:00:00', $entry->start_time_snapshot);
        $this->assertSame('08:45:00', $entry->end_time_snapshot);
        $this->assertSame($fixture['labA']->id, $entry->planned_laboratory_id);

        $this->assertSame(
            ['2026-09-07', '2026-09-14', '2026-09-21'],
            ScheduleOccurrence::query()
                ->where('publication_id', $publicationId)
                ->orderBy('occurs_on')
                ->get()
                ->map(fn (ScheduleOccurrence $occurrence): string => $occurrence->occurs_on->format('Y-m-d'))
                ->all(),
        );

        $this->assertSame(
            ['publication_received', 'publication_validated'],
            TimetablePublicationEvent::query()->orderBy('created_at')->orderBy('id')->pluck('event_type')->all(),
        );
    }

    public function test_identical_replay_is_idempotent_and_changed_same_version_is_rejected(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $payload = $this->payload($school, $fixture);

        $first = $this->postJson('/api/v1/timetable-publications', $payload)
            ->assertCreated();

        $publicationId = $first->json('data.id');
        $hash = $first->json('data.payloadSha256');

        $this->postJson('/api/v1/timetable-publications', $payload)
            ->assertOk()
            ->assertHeader('X-Timetable-Replayed', 'true')
            ->assertJsonPath('data.id', $publicationId)
            ->assertJsonPath('data.payloadSha256', $hash);

        $this->assertDatabaseCount('timetable_publications', 1);
        $this->assertDatabaseCount('timetable_entries', 1);
        $this->assertDatabaseCount('schedule_occurrences', 3);
        $this->assertDatabaseHas('timetable_publication_events', [
            'publication_id' => $publicationId,
            'event_type' => 'publication_replayed',
        ]);

        $changed = $payload;
        $changed['entries'][0]['activityType'] = 'exam';

        $this->postJson('/api/v1/timetable-publications', $changed)
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_INTEGRITY_CONFLICT');

        $this->assertDatabaseCount('timetable_publications', 1);
        $this->assertDatabaseHas('timetable_publication_events', [
            'publication_id' => $publicationId,
            'event_type' => 'publication_integrity_conflict',
        ]);
    }

    public function test_source_collision_rejects_publication_without_partial_entries_or_occurrences(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);
        $payload = $this->payload($school, $fixture);

        $payload['entries'][] = [
            'sourceScheduleId' => 'SCH-CONFLICT',
            'teacherSourceId' => $fixture['teacherA']->id,
            'academicClassSourceId' => $fixture['classB']->id,
            'subjectSourceId' => $fixture['subjectB']->id,
            'lessonPeriodSetSourceId' => $fixture['set']->id,
            'startLessonPeriodSourceId' => $fixture['jp1']->id,
            'endLessonPeriodSourceId' => $fixture['jp2']->id,
            'plannedLaboratoryId' => $fixture['labB']->id,
            'activityType' => 'theory',
            'recurrenceKind' => 'weekly',
            'weekday' => 1,
            'entryEffectiveFrom' => '2026-09-07',
            'entryEffectiveTo' => '2026-09-21',
        ];

        $response = $this->postJson('/api/v1/timetable-publications', $payload)
            ->assertStatus(422)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_INVALID');

        $publication = TimetablePublication::query()->sole();
        $this->assertSame('rejected', $publication->status);
        $this->assertGreaterThan(0, (int) $response->json('details.errors'));
        $this->assertDatabaseCount('timetable_entries', 0);
        $this->assertDatabaseCount('schedule_occurrences', 0);
        $this->assertSame(
            ['publication_received', 'publication_validation_failed'],
            TimetablePublicationEvent::query()->orderBy('created_at')->orderBy('id')->pluck('event_type')->all(),
        );
    }

    public function test_unknown_or_cross_school_references_fail_closed_and_are_persisted_as_rejected(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);

        $otherSchool = School::factory()->create();
        $foreignFixture = $this->fixture($otherSchool);

        $payload = $this->payload($school, $fixture);
        $payload['entries'][0]['teacherSourceId'] = $foreignFixture['teacherA']->id;

        $response = $this->postJson('/api/v1/timetable-publications', $payload)
            ->assertStatus(422)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_INVALID');

        $this->assertSame(
            'The Teacher reference is unknown in the active School.',
            $response->json('errors')['entries.0.teacherSourceId'][0] ?? null,
        );

        $this->assertSame('rejected', TimetablePublication::query()->sole()->status);
        $this->assertDatabaseCount('timetable_entries', 0);
        $this->assertDatabaseCount('schedule_occurrences', 0);
    }

    public function test_activation_is_atomic_supersedes_prior_version_and_prevents_rollback_or_future_cutover(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-10 09:00:00', 'Asia/Jakarta'));

        try {
            [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
            $fixture = $this->fixture($school);

            $v1Payload = $this->payload($school, $fixture);
            $v1 = $this->postJson('/api/v1/timetable-publications', $v1Payload)
                ->assertCreated()
                ->json('data');

            $this->postJson('/api/v1/timetable-publications/'.$v1['id'].'/activate')
                ->assertOk()
                ->assertJsonPath('data.status', 'active');

            $v2Payload = $v1Payload;
            $v2Payload['sourceVersion'] = 2;
            $v2Payload['publishedAt'] = '2026-09-09T12:00:00+07:00';
            $v2Payload['entries'][0]['sourceSnapshots'] = ['subjectName' => 'Snapshot v2'];

            $v2 = $this->postJson('/api/v1/timetable-publications', $v2Payload)
                ->assertCreated()
                ->json('data');

            $this->postJson('/api/v1/timetable-publications/'.$v2['id'].'/activate')
                ->assertOk()
                ->assertJsonPath('data.status', 'active');

            $this->assertDatabaseHas('timetable_publications', [
                'id' => $v1['id'],
                'status' => 'superseded',
                'superseded_by_id' => $v2['id'],
            ]);
            $this->assertDatabaseHas('timetable_publications', [
                'id' => $v2['id'],
                'status' => 'active',
            ]);
            $this->assertSame(
                1,
                TimetablePublication::query()
                    ->where('school_id', $school->id)
                    ->where('semester_id', $fixture['semester']->id)
                    ->where('status', 'active')
                    ->count(),
            );

            $this->postJson('/api/v1/timetable-publications/'.$v1['id'].'/activate')
                ->assertStatus(409)
                ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_NOT_ACTIVATABLE');

            $v3Payload = $v1Payload;
            $v3Payload['sourceVersion'] = 3;
            $v3Payload['publishedAt'] = '2026-09-10T12:00:00+07:00';
            $v3Payload['effectiveFrom'] = '2026-10-01';
            $v3Payload['entries'][0]['entryEffectiveFrom'] = '2026-10-05';
            $v3Payload['entries'][0]['entryEffectiveTo'] = '2026-10-19';

            $v3 = $this->postJson('/api/v1/timetable-publications', $v3Payload)
                ->assertCreated()
                ->json('data');

            $this->postJson('/api/v1/timetable-publications/'.$v3['id'].'/activate')
                ->assertStatus(409)
                ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_NOT_ACTIVATABLE');

            $this->assertDatabaseHas('timetable_publications', [
                'id' => $v2['id'],
                'status' => 'active',
            ]);
            $this->assertDatabaseHas('timetable_publications', [
                'id' => $v3['id'],
                'status' => 'validated',
            ]);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_publication_list_and_detail_are_tenant_scoped(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);

        $publication = $this->postJson('/api/v1/timetable-publications', $this->payload($school, $fixture))
            ->assertCreated()
            ->json('data');

        $otherSchool = School::factory()->create();
        $otherFixture = $this->fixture($otherSchool);
        $foreign = TimetablePublication::query()->create([
            'school_id' => $otherSchool->id,
            'source_system' => 'tessela',
            'source_publication_id' => 'FOREIGN',
            'source_version' => 1,
            'schema_version' => '1.0',
            'academic_reference_source' => 'smartlab',
            'source_school_id' => $otherSchool->id,
            'source_academic_year_id' => $otherFixture['year']->id,
            'source_semester_id' => $otherFixture['semester']->id,
            'academic_year_id' => $otherFixture['year']->id,
            'semester_id' => $otherFixture['semester']->id,
            'published_at' => '2026-09-05 00:00:00+00:00',
            'effective_from' => '2026-09-01',
            'effective_to' => '2026-12-18',
            'payload_sha256' => str_repeat('a', 64),
            'source_payload' => ['entries' => []],
            'status' => 'validated',
            'validation_summary' => [
                'entriesReceived' => 0,
                'entriesNormalized' => 0,
                'occurrencesMaterialized' => 0,
                'errors' => 0,
                'warnings' => 0,
            ],
            'validated_at' => now(),
        ]);

        $this->getJson('/api/v1/timetable-publications?semesterId='.$fixture['semester']->id)
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $publication['id']);

        $this->getJson('/api/v1/timetable-publications/'.$publication['id'])
            ->assertOk()
            ->assertJsonPath('data.id', $publication['id']);

        $this->getJson('/api/v1/timetable-publications/'.$foreign->id)
            ->assertNotFound()
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_NOT_FOUND');
    }

    public function test_publication_family_is_stable_for_one_semester(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $fixture = $this->fixture($school);

        $this->postJson('/api/v1/timetable-publications', $this->payload($school, $fixture))
            ->assertCreated();

        $changedFamily = $this->payload($school, $fixture);
        $changedFamily['sourcePublicationId'] = 'TT-OTHER-FAMILY';
        $changedFamily['sourceVersion'] = 1;

        $this->postJson('/api/v1/timetable-publications', $changedFamily)
            ->assertStatus(409)
            ->assertJsonPath('code', 'TIMETABLE_PUBLICATION_FAMILY_CONFLICT');

        $this->assertDatabaseCount('timetable_publications', 1);
    }

    public function test_activation_audit_failure_rolls_back_status_transition(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-10 09:00:00', 'Asia/Jakarta'));

        try {
            [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
            $fixture = $this->fixture($school);

            $publication = $this->postJson('/api/v1/timetable-publications', $this->payload($school, $fixture))
                ->assertCreated()
                ->json('data');

            DB::unprepared(<<<'SQL'
                CREATE TRIGGER timetable_publication_events_test_insert_failure
                BEFORE INSERT ON timetable_publication_events
                BEGIN
                    SELECT RAISE(ABORT, 'forced timetable publication audit insert failure');
                END;
            SQL);

            try {
                $this->postJson('/api/v1/timetable-publications/'.$publication['id'].'/activate')
                    ->assertStatus(500);
            } finally {
                DB::unprepared('DROP TRIGGER IF EXISTS timetable_publication_events_test_insert_failure');
            }

            $this->assertDatabaseHas('timetable_publications', [
                'id' => $publication['id'],
                'status' => 'validated',
            ]);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_schedule_occurrence_read_requires_server_permission_before_query_validation(): void
    {
        $this->getJson('/api/v1/schedule-occurrences?unexpected=true')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');

        $this->getJson('/api/v1/schedule-occurrences?unexpected=true')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');

        $this->getJson('/api/v1/schedule-occurrences?unexpected=true')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['from', 'to', 'unexpected']);
    }

    public function test_schedule_occurrence_read_returns_only_active_current_plan_with_canonical_labels(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-10 09:00:00', 'Asia/Jakarta'));

        try {
            [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
            $fixture = $this->fixture($school);

            $publication = $this->postJson('/api/v1/timetable-publications', $this->payload($school, $fixture))
                ->assertCreated()
                ->json('data');

            $this->postJson('/api/v1/timetable-publications/'.$publication['id'].'/activate')
                ->assertOk();

            $response = $this->getJson('/api/v1/schedule-occurrences?from=2026-09-07&to=2026-09-13&perPage=1000')
                ->assertOk()
                ->assertJsonPath('meta.page', 1)
                ->assertJsonPath('meta.perPage', 1000)
                ->assertJsonPath('meta.total', 1)
                ->assertJsonPath('meta.lastPage', 1)
                ->assertJsonPath('meta.from', '2026-09-07')
                ->assertJsonPath('meta.to', '2026-09-13')
                ->assertJsonPath('meta.activePublicationCount', 1)
                ->assertJsonPath('data.0.publicationId', $publication['id'])
                ->assertJsonPath('data.0.sourceVersion', 1)
                ->assertJsonPath('data.0.sourceScheduleId', 'SCH-XIPPLG1-WEB-MON-01')
                ->assertJsonPath('data.0.occursOn', '2026-09-07')
                ->assertJsonPath('data.0.activityType', 'practical')
                ->assertJsonPath('data.0.teacher.id', $fixture['teacherA']->id)
                ->assertJsonPath('data.0.teacher.code', 'T-A')
                ->assertJsonPath('data.0.teacher.name', 'Guru A')
                ->assertJsonPath('data.0.academicClass.id', $fixture['classA']->id)
                ->assertJsonPath('data.0.academicClass.code', 'XI-PPLG-1')
                ->assertJsonPath('data.0.academicClass.name', 'XI PPLG 1')
                ->assertJsonPath('data.0.subject.id', $fixture['subjectA']->id)
                ->assertJsonPath('data.0.subject.code', 'WEB')
                ->assertJsonPath('data.0.subject.name', 'Pemrograman Web')
                ->assertJsonPath('data.0.plannedLaboratory.id', $fixture['labA']->id)
                ->assertJsonPath('data.0.plannedLaboratory.code', 'LAB-RPL-1')
                ->assertJsonPath('data.0.plannedLaboratory.name', 'Lab RPL 1')
                ->assertJsonPath('data.0.startTime', '07:00:00')
                ->assertJsonPath('data.0.endTime', '08:45:00')
                ->assertJsonPath('data.0.instructionPeriodCount', 2);

            $this->assertSame($school->id, $response->json('data.0.schoolId'));
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_schedule_occurrence_read_filters_current_plan_and_hides_superseded_occurrences(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-10 09:00:00', 'Asia/Jakarta'));

        try {
            [, $school] = $this->actingAsRole(School::factory()->create(['timezone' => 'Asia/Jakarta']), 'admin-lab');
            $fixture = $this->fixture($school);

            $v1Payload = $this->payload($school, $fixture);
            $v1 = $this->postJson('/api/v1/timetable-publications', $v1Payload)
                ->assertCreated()
                ->json('data');
            $this->postJson('/api/v1/timetable-publications/'.$v1['id'].'/activate')->assertOk();

            $v2Payload = $v1Payload;
            $v2Payload['sourceVersion'] = 2;
            $v2Payload['publishedAt'] = '2026-09-09T12:00:00+07:00';
            $v2Payload['entries'][0]['sourceSnapshots'] = [
                'teacherCode' => 'T-A',
                'teacherName' => 'Guru Snapshot',
                'classCode' => 'XI-PPLG-1',
                'className' => 'XI PPLG 1 Snapshot',
                'subjectCode' => 'WEB',
                'subjectName' => 'Web Snapshot v2',
                'laboratoryCode' => 'LAB-RPL-1',
                'laboratoryName' => 'Lab Snapshot',
            ];

            $v2 = $this->postJson('/api/v1/timetable-publications', $v2Payload)
                ->assertCreated()
                ->json('data');
            $this->postJson('/api/v1/timetable-publications/'.$v2['id'].'/activate')->assertOk();

            $this->getJson(
                '/api/v1/schedule-occurrences?from=2026-09-07&to=2026-09-13'.
                '&laboratoryId='.$fixture['labA']->id.
                '&teacherId='.$fixture['teacherA']->id.
                '&academicClassId='.$fixture['classA']->id.
                '&subjectId='.$fixture['subjectA']->id.
                '&activityType=practical'
            )
                ->assertOk()
                ->assertJsonPath('meta.total', 1)
                ->assertJsonPath('meta.activePublicationCount', 1)
                ->assertJsonPath('data.0.publicationId', $v2['id'])
                ->assertJsonPath('data.0.sourceVersion', 2)
                ->assertJsonPath('data.0.teacher.name', 'Guru Snapshot')
                ->assertJsonPath('data.0.academicClass.name', 'XI PPLG 1 Snapshot')
                ->assertJsonPath('data.0.subject.name', 'Web Snapshot v2')
                ->assertJsonPath('data.0.plannedLaboratory.name', 'Lab Snapshot');

            $this->assertDatabaseHas('timetable_publications', [
                'id' => $v1['id'],
                'status' => 'superseded',
            ]);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_schedule_occurrence_read_rejects_oversized_ranges_and_unknown_query_fields(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');

        $this->getJson('/api/v1/schedule-occurrences?from=2026-09-01&to=2026-09-15')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['to']);

        $this->getJson('/api/v1/schedule-occurrences?from=2026-09-01&to=2026-09-07&sort=teacher')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['sort']);
    }

    /**
     * @return array{
     *   year: AcademicYear,
     *   semester: Semester,
     *   set: LessonPeriodSet,
     *   jp1: LessonPeriod,
     *   break: LessonPeriod,
     *   jp2: LessonPeriod,
     *   jp3: LessonPeriod,
     *   teacherA: Teacher,
     *   teacherB: Teacher,
     *   classA: AcademicClass,
     *   classB: AcademicClass,
     *   subjectA: Subject,
     *   subjectB: Subject,
     *   labA: Laboratory,
     *   labB: Laboratory
     * }
     */
    private function fixture(School $school): array
    {
        $year = AcademicYear::query()->create([
            'school_id' => $school->id,
            'code' => '2026/2027',
            'name' => 'Tahun Ajaran 2026/2027',
            'starts_on' => '2026-07-01',
            'ends_on' => '2027-06-30',
            'status' => 'active',
            'version' => 1,
        ]);
        $semester = Semester::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'code' => 'GASAL',
            'name' => 'Semester Gasal',
            'starts_on' => '2026-07-01',
            'ends_on' => '2026-12-31',
            'status' => 'active',
            'version' => 1,
        ]);
        $set = LessonPeriodSet::query()->create([
            'school_id' => $school->id,
            'academic_year_id' => $year->id,
            'code' => 'NORMAL',
            'name' => 'Jam Normal',
            'status' => 'active',
            'version' => 1,
        ]);
        $jp1 = $this->period($school, $set, 'JP01', 1, '07:00:00', '07:45:00', 'instruction');
        $break = $this->period($school, $set, 'BREAK', 2, '07:45:00', '08:00:00', 'break');
        $jp2 = $this->period($school, $set, 'JP02', 3, '08:00:00', '08:45:00', 'instruction');
        $jp3 = $this->period($school, $set, 'JP03', 4, '08:45:00', '09:30:00', 'instruction');

        $teacherA = $this->teacher($school, 'T-A', 'Guru A');
        $teacherB = $this->teacher($school, 'T-B', 'Guru B');
        $classA = $this->academicClass($school, 'XI-PPLG-1', 'XI PPLG 1', 36);
        $classB = $this->academicClass($school, 'XI-PPLG-2', 'XI PPLG 2', 30);
        $subjectA = $this->subject($school, 'WEB', 'Pemrograman Web');
        $subjectB = $this->subject($school, 'DB', 'Basis Data');

        $labA = Laboratory::query()->create([
            'school_id' => $school->id,
            'code' => 'LAB-RPL-1',
            'name' => 'Lab RPL 1',
            'location' => 'Gedung A',
            'capacity' => 32,
            'status' => 'active',
        ]);
        $labB = Laboratory::query()->create([
            'school_id' => $school->id,
            'code' => 'LAB-RPL-2',
            'name' => 'Lab RPL 2',
            'location' => 'Gedung A',
            'capacity' => 40,
            'status' => 'active',
        ]);

        return compact(
            'year',
            'semester',
            'set',
            'jp1',
            'break',
            'jp2',
            'jp3',
            'teacherA',
            'teacherB',
            'classA',
            'classB',
            'subjectA',
            'subjectB',
            'labA',
            'labB',
        );
    }

    /** @param array<string, mixed> $fixture */
    private function payload(School $school, array $fixture): array
    {
        return [
            'schemaVersion' => '1.0',
            'sourceSystem' => 'tessela',
            'sourcePublicationId' => 'TT-2026-GASAL',
            'sourceVersion' => 1,
            'academicReferenceSource' => 'smartlab',
            'schoolSourceId' => $school->id,
            'academicYearSourceId' => $fixture['year']->id,
            'semesterSourceId' => $fixture['semester']->id,
            'publishedAt' => '2026-09-05T05:00:00+07:00',
            'effectiveFrom' => '2026-09-01',
            'effectiveTo' => '2026-12-18',
            'entries' => [[
                'sourceScheduleId' => 'SCH-XIPPLG1-WEB-MON-01',
                'teacherSourceId' => $fixture['teacherA']->id,
                'academicClassSourceId' => $fixture['classA']->id,
                'subjectSourceId' => $fixture['subjectA']->id,
                'lessonPeriodSetSourceId' => $fixture['set']->id,
                'startLessonPeriodSourceId' => $fixture['jp1']->id,
                'endLessonPeriodSourceId' => $fixture['jp2']->id,
                'plannedLaboratoryId' => $fixture['labA']->id,
                'activityType' => 'practical',
                'recurrenceKind' => 'weekly',
                'weekday' => 1,
                'entryEffectiveFrom' => '2026-09-07',
                'entryEffectiveTo' => '2026-09-21',
                'sourceSnapshots' => [
                    'teacherCode' => 'T-A',
                    'classCode' => 'XI-PPLG-1',
                    'subjectCode' => 'WEB',
                    'laboratoryCode' => 'LAB-RPL-1',
                ],
            ]],
        ];
    }

    private function period(
        School $school,
        LessonPeriodSet $set,
        string $code,
        int $sequence,
        string $startsAt,
        string $endsAt,
        string $kind,
    ): LessonPeriod {
        return LessonPeriod::query()->create([
            'school_id' => $school->id,
            'lesson_period_set_id' => $set->id,
            'code' => $code,
            'sequence' => $sequence,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'kind' => $kind,
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function teacher(School $school, string $code, string $name): Teacher
    {
        return Teacher::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => $name,
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function academicClass(School $school, string $code, string $name, int $studentCount): AcademicClass
    {
        return AcademicClass::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => $name,
            'grade_level' => 11,
            'student_count' => $studentCount,
            'status' => 'active',
            'version' => 1,
        ]);
    }

    private function subject(School $school, string $code, string $name): Subject
    {
        return Subject::query()->create([
            'school_id' => $school->id,
            'code' => $code,
            'name' => $name,
            'status' => 'active',
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

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }
}
