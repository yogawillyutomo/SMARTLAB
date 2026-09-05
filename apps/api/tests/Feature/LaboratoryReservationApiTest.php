<?php

namespace Tests\Feature;

use App\Models\AcademicYear;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\OperationalCalendarEvent;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\TimetablePublication;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LaboratoryReservationApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_reservation_auth_and_permission_precede_payload_validation(): void
    {
        $this->postJson('/api/v1/laboratory-reservations', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');

        $this->postJson('/api/v1/laboratory-reservations', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'guru');

        $this->postJson('/api/v1/laboratory-reservations', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors([
                'laboratoryId', 'date', 'startsAt', 'endsAt', 'activity', 'participants', 'picName', 'unexpected',
            ]);

        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();
        $leader = Role::query()->where('key', 'pimpinan')->firstOrFail();

        $this->assertSame(
            ['bookings.approve','bookings.cancel','bookings.create','bookings.export','bookings.view','bookings.view-all'],
            $admin->permissions()->where('key', 'like', 'bookings.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['bookings.approve','bookings.cancel','bookings.export','bookings.view','bookings.view-all'],
            $head->permissions()->where('key', 'like', 'bookings.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['bookings.cancel','bookings.create','bookings.view'],
            $teacher->permissions()->where('key', 'like', 'bookings.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['bookings.export','bookings.view','bookings.view-all'],
            $leader->permissions()->where('key', 'like', 'bookings.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_submission_uses_session_identity_holds_slot_and_cancel_releases_it(): void
    {
        $school = School::factory()->create();
        [$teacher, , $membership] = $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create([
            'school_id' => $school->id,
            'capacity' => 36,
            'status' => 'active',
        ]);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $created = $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.requester.userId', $teacher->id)
            ->assertJsonPath('data.requester.membershipId', $membership->id)
            ->assertJsonPath('data.requester.name', $teacher->name)
            ->assertJsonPath('data.laboratory.id', $lab->id)
            ->assertJsonPath('data.timeline.0.eventType', 'reservation.submitted')
            ->json('data');

        $this->assertMatchesRegularExpression('/^RSV-20260914-[0-9A-HJKMNP-TV-Z]{8}$/', $created['reservationNumber']);

        $this->getJson($this->availabilityPath($lab))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.state', 'blocked')
            ->assertJsonPath('data.blockers.0.type', 'reservation')
            ->assertJsonPath('data.blockers.0.details.reservationNumber', $created['reservationNumber'])
            ->assertJsonPath('data.sourceCoverage.reservations.status', 'covered');

        $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab, 'Overlapping request'))
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_UNAVAILABLE')
            ->assertJsonPath('details.availability.blockers.0.type', 'reservation');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$created['id'].'/cancel', ['reason' => 'Rencana berubah'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.timeline.1.eventType', 'reservation.cancelled');

        $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab, 'Replacement request'))
            ->assertCreated()
            ->assertJsonPath('data.status', 'submitted');

        $this->assertDatabaseCount('laboratory_reservations', 2);
        $this->assertDatabaseCount('laboratory_reservation_events', 3);
    }

    public function test_approval_rechecks_availability_and_fails_if_operational_reality_changed(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'capacity' => 36, 'status' => 'active']);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $reservation = $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab))
            ->assertCreated()
            ->json('data');

        OperationalCalendarEvent::query()->create([
            'school_id' => $school->id,
            'scope' => 'laboratory',
            'laboratory_id' => $lab->id,
            'category' => 'maintenance',
            'availability_effect' => 'blocked',
            'title' => 'Maintenance mendadak',
            'starts_on' => '2026-09-14',
            'ends_on' => '2026-09-14',
            'all_day' => false,
            'starts_at' => '10:30:00',
            'ends_at' => '11:30:00',
            'status' => 'active',
            'version' => 1,
            'cancelled_at' => null,
        ]);

        $this->actingAsRole($school, 'kepala-lab');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/approve')
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_UNAVAILABLE')
            ->assertJsonPath('details.availability.state', 'blocked')
            ->assertJsonPath('details.availability.blockers.0.type', 'calendar_event');

        $this->assertDatabaseHas('laboratory_reservations', [
            'id' => $reservation['id'],
            'status' => 'submitted',
            'version' => 1,
        ]);
    }

    public function test_approval_excludes_self_rechecks_then_commits_audited_version(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'capacity' => 36, 'status' => 'active']);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $reservation = $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab))
            ->assertCreated()
            ->json('data');

        $this->actingAsRole($school, 'kepala-lab');

        $this->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/approve')
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $approved = $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/approve')
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.timeline.1.eventType', 'reservation.approved')
            ->json('data');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/reject', ['reason' => 'stale'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_VERSION_CONFLICT');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/reject', ['reason' => 'late'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_STATE_CONFLICT');

        $this->assertNotNull($approved['decidedAt']);
        $this->assertDatabaseHas('laboratory_reservation_events', [
            'reservation_id' => $reservation['id'],
            'event_type' => 'reservation.approved',
            'entity_version_before' => 1,
            'entity_version_after' => 2,
        ]);
    }

    public function test_rejection_releases_slot_and_requires_reason(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'capacity' => 36, 'status' => 'active']);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $reservation = $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab))
            ->assertCreated()
            ->json('data');

        $this->actingAsRole($school, 'admin-lab');

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/reject', [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['reason']);

        $this->withHeader('If-Match', '"1"')
            ->postJson('/api/v1/laboratory-reservations/'.$reservation['id'].'/reject', ['reason' => 'Kegiatan tidak sesuai'])
            ->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.rejectionReason', 'Kegiatan tidak sesuai');

        $this->getJson($this->availabilityPath($lab))
            ->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.blockerCount', 0);
    }

    public function test_teacher_reads_only_own_reservations_while_view_all_roles_can_read_school_scope(): void
    {
        $school = School::factory()->create();
        [$teacherA] = $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'capacity' => 36, 'status' => 'active']);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $mine = $this->postJson('/api/v1/laboratory-reservations', $this->payload($lab, 'Mine'))
            ->assertCreated()
            ->json('data');

        [$teacherB] = $this->actingAsRole($school, 'guru');

        $this->getJson('/api/v1/laboratory-reservations?from=2026-09-01&to=2026-09-30')
            ->assertOk()
            ->assertJsonPath('meta.total', 0);

        $this->getJson('/api/v1/laboratory-reservations?from=2026-09-01&to=2026-09-30&scope=all')
            ->assertForbidden()
            ->assertJsonPath('code', 'LABORATORY_RESERVATION_SCOPE_FORBIDDEN');

        $this->getJson('/api/v1/laboratory-reservations/'.$mine['id'])
            ->assertNotFound();

        $this->actingAsRole($school, 'pimpinan');

        $this->getJson('/api/v1/laboratory-reservations?from=2026-09-01&to=2026-09-30&scope=all')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.requester.userId', $teacherA->id);

        $this->getJson('/api/v1/laboratory-reservations/'.$mine['id'])
            ->assertOk()
            ->assertJsonPath('data.id', $mine['id']);

        $this->assertNotSame($teacherA->id, $teacherB->id);
    }

    public function test_capacity_cross_tenant_and_unknown_fields_fail_closed(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'capacity' => 20, 'status' => 'active']);
        $this->createScheduleCoverage($school, '2026-09-01', '2026-12-18');

        $tooMany = $this->payload($lab);
        $tooMany['participants'] = 21;

        $this->postJson('/api/v1/laboratory-reservations', $tooMany)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['participants']);

        $foreign = Laboratory::factory()->create(['school_id' => School::factory()->create()->id]);

        $this->postJson('/api/v1/laboratory-reservations', $this->payload($foreign))
            ->assertStatus(422)
            ->assertJsonValidationErrors(['laboratoryId']);

        $spoofed = $this->payload($lab);
        $spoofed['requesterName'] = 'Spoofed';

        $this->postJson('/api/v1/laboratory-reservations', $spoofed)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['requesterName']);
    }

    private function payload(Laboratory $lab, string $activity = 'Praktikum tambahan'): array
    {
        return [
            'laboratoryId' => $lab->id,
            'date' => '2026-09-14',
            'startsAt' => '10:00',
            'endsAt' => '12:00',
            'activity' => $activity,
            'participants' => min(18, $lab->capacity),
            'deviceNeeds' => 'PC dan projector',
            'notes' => 'Catatan pengajuan',
            'picName' => 'Guru PIC',
        ];
    }

    private function availabilityPath(Laboratory $lab): string
    {
        return '/api/v1/laboratory-availability?'.http_build_query([
            'laboratoryId' => $lab->id,
            'date' => '2026-09-14',
            'startsAt' => '10:00',
            'endsAt' => '12:00',
        ]);
    }

    private function createScheduleCoverage(School $school, string $from, string $to): TimetablePublication
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

        return TimetablePublication::query()->create([
            'school_id' => $school->id,
            'source_system' => 'tessela',
            'source_publication_id' => 'TT-RESERVATION-COVERAGE',
            'source_version' => 1,
            'schema_version' => '1.0',
            'academic_reference_source' => 'smartlab',
            'source_school_id' => $school->id,
            'source_academic_year_id' => $year->id,
            'source_semester_id' => $semester->id,
            'academic_year_id' => $year->id,
            'semester_id' => $semester->id,
            'published_at' => '2026-09-05 00:00:00+00:00',
            'effective_from' => $from,
            'effective_to' => $to,
            'payload_sha256' => str_repeat('a', 64),
            'source_payload' => ['entries' => []],
            'status' => 'active',
            'validation_summary' => [
                'entriesReceived' => 0,
                'entriesNormalized' => 0,
                'occurrencesMaterialized' => 0,
                'errors' => 0,
                'warnings' => 0,
            ],
            'validated_at' => now(),
            'activated_at' => now(),
        ]);
    }

    /** @return array{User,School,SchoolMembership} */
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
