<?php

namespace Tests\Feature;

use App\Models\ActivityReport;
use App\Models\Incident;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\LaboratorySession;
use App\Models\OperationalCalendarEvent;
use App\Models\Role;
use App\Models\ScheduleOccurrence;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\TimetablePublication;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\UatAdminSeeder;
use Database\Seeders\UatGlobalLabContextSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use RuntimeException;
use Tests\TestCase;

class UatGlobalLabContextSeederTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Carbon::setTestNow(Carbon::parse('2026-09-10 07:30:00', 'Asia/Jakarta'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_it_builds_terminal_non_custody_global_lab_context_evidence_and_is_idempotent(): void
    {
        $school = $this->prepareUatAdminAndLabs();

        $seeder = app(UatGlobalLabContextSeeder::class);
        $seeder->run();

        $this->assertSame(2, Incident::query()
            ->where('school_id', $school->id)
            ->whereIn('title', ['UAT GLC Incident RPL1', 'UAT GLC Incident RPL2'])
            ->count());

        $publication = TimetablePublication::query()
            ->where('school_id', $school->id)
            ->where('source_publication_id', 'UAT-GLC-20260910')
            ->sole();
        $this->assertSame('active', $publication->status);
        $this->assertSame(2, ScheduleOccurrence::query()
            ->where('publication_id', $publication->id)
            ->whereDate('occurs_on', '2026-09-10')
            ->count());

        $this->assertSame(2, LaboratoryReservation::query()
            ->where('school_id', $school->id)
            ->where('activity', 'like', 'UAT GLC Reservation%')
            ->where('status', 'cancelled')
            ->count());
        $this->assertSame(0, LaboratoryReservation::query()
            ->where('school_id', $school->id)
            ->where('activity', 'like', 'UAT GLC Reservation%')
            ->whereIn('status', ['submitted', 'approved'])
            ->count());

        $this->assertSame(2, LaboratorySession::query()
            ->where('school_id', $school->id)
            ->where('source_type', 'schedule_occurrence')
            ->where('status', 'cancelled')
            ->count());
        $this->assertSame(0, LaboratorySession::query()
            ->where('school_id', $school->id)
            ->whereIn('status', ['prepared', 'in_progress'])
            ->count());

        $this->assertSame(2, ActivityReport::query()
            ->where('school_id', $school->id)
            ->where('origin', 'manual_backfill')
            ->where('manual_backfill_reason', 'like', 'UAT Global Laboratory Context report%')
            ->count());

        $this->assertSame(3, OperationalCalendarEvent::query()
            ->where('school_id', $school->id)
            ->where('title', 'like', 'UAT GLC%Event')
            ->where('status', 'active')
            ->where('availability_effect', 'informational')
            ->count());

        $counts = [
            Incident::query()->count(),
            TimetablePublication::query()->count(),
            ScheduleOccurrence::query()->count(),
            LaboratoryReservation::query()->count(),
            LaboratorySession::query()->count(),
            ActivityReport::query()->count(),
            OperationalCalendarEvent::query()->count(),
        ];

        $seeder->run();

        $this->assertSame($counts, [
            Incident::query()->count(),
            TimetablePublication::query()->count(),
            ScheduleOccurrence::query()->count(),
            LaboratoryReservation::query()->count(),
            LaboratorySession::query()->count(),
            ActivityReport::query()->count(),
            OperationalCalendarEvent::query()->count(),
        ]);
    }

    public function test_it_refuses_to_run_outside_local_or_testing(): void
    {
        $originalEnvironment = app()->environment();
        app()['env'] = 'production';

        try {
            $this->expectException(RuntimeException::class);
            $this->expectExceptionMessage(
                'UatGlobalLabContextSeeder hanya boleh dijalankan pada environment local/testing.',
            );

            app(UatGlobalLabContextSeeder::class)->run();
        } finally {
            app()['env'] = $originalEnvironment;
        }
    }

    public function test_it_requires_exact_authorized_uat_admin_and_existing_active_labs(): void
    {
        $school = School::factory()->create([
            'code' => 'UAT-SCHOOL',
            'name' => 'SMARTLAB UAT School',
            'timezone' => 'Asia/Jakarta',
            'status' => 'active',
        ]);
        $user = User::factory()->create([
            'email' => UatAdminSeeder::EMAIL,
            'status' => 'active',
        ]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->roles()->sync([Role::query()->where('key', 'super-admin')->sole()->id]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(
            'UAT-RPL1 harus sudah tersedia dan active. Seeder tidak membuat/mengaktifkan Laboratory.',
        );

        app(UatGlobalLabContextSeeder::class)->run();
    }

    private function prepareUatAdminAndLabs(): School
    {
        $school = School::factory()->create([
            'code' => 'UAT-SCHOOL',
            'name' => 'SMARTLAB UAT School',
            'timezone' => 'Asia/Jakarta',
            'status' => 'active',
        ]);

        $user = User::factory()->create([
            'email' => UatAdminSeeder::EMAIL,
            'name' => 'Admin UAT SmartLab',
            'status' => 'active',
        ]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->roles()->sync([Role::query()->where('key', 'super-admin')->sole()->id]);

        foreach ([
            ['UAT-RPL1', 'Lab RPL 1 UAT'],
            ['UAT-RPL2', 'Lab RPL 2 UAT'],
        ] as [$code, $name]) {
            Laboratory::query()->create([
                'school_id' => $school->id,
                'code' => $code,
                'name' => $name,
                'location' => 'Gedung PPLG Lt. 2',
                'capacity' => 36,
                'status' => 'active',
            ]);
        }

        return $school;
    }
}
