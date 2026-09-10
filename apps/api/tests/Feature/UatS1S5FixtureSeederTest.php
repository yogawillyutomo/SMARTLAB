<?php

namespace Tests\Feature;

use App\Models\AcademicClass;
use App\Models\AcademicUnit;
use App\Models\AcademicYear;
use App\Models\Asset;
use App\Models\Device;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Laboratory;
use App\Models\LessonPeriod;
use App\Models\LoanItem;
use App\Models\MaintenanceCampaign;
use App\Models\MaintenanceExecution;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\User;
use App\Models\WorkOrder;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\UatAdminSeeder;
use Database\Seeders\UatS1S5FixtureSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

class UatS1S5FixtureSeederTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    protected function tearDown(): void
    {
        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD');
        parent::tearDown();
    }

    public function test_it_builds_a_rich_canonical_fixture_without_active_custody(): void
    {
        $school = $this->prepareUatAdmin();
        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD=FixturePassword123!');

        app(UatS1S5FixtureSeeder::class)->run();

        $this->assertSame(5, User::query()->whereIn('email', array_keys(UatS1S5FixtureSeeder::ACCOUNTS))->count());

        foreach (UatS1S5FixtureSeeder::ACCOUNTS as $email => $fixture) {
            $user = User::query()->where('email', $email)->sole();
            $membership = SchoolMembership::query()
                ->where('school_id', $school->id)
                ->where('user_id', $user->id)
                ->sole();

            $this->assertTrue(Hash::check('FixturePassword123!', $user->password));
            $this->assertSame('active', $user->status);
            $this->assertSame('active', $membership->status);
            $this->assertSame([$fixture['role']], $membership->roles()->pluck('key')->all());
        }

        $teacherMembership = $this->membershipFor($school, 'uat.teacher@smartlab.local');
        $this->assertTrue($teacherMembership->hasPermission('loans.create'));
        $this->assertFalse($teacherMembership->hasPermission('loans.approve'));

        $kalabMembership = $this->membershipFor($school, 'uat.kalab@smartlab.local');
        $this->assertTrue($kalabMembership->hasPermission('loans.approve'));
        $this->assertTrue($kalabMembership->hasPermission('loans.close'));

        $adminLabMembership = $this->membershipFor($school, 'uat.labadmin@smartlab.local');
        $this->assertTrue($adminLabMembership->hasPermission('loans.checkout'));
        $this->assertTrue($adminLabMembership->hasPermission('loans.return'));

        $studentMembership = $this->membershipFor($school, 'uat.student@smartlab.local');
        $this->assertFalse($studentMembership->hasPermission('loans.create'));

        $this->assertSame(2, Laboratory::query()
            ->where('school_id', $school->id)
            ->whereIn('code', ['UAT-RPL1', 'UAT-RPL2'])
            ->count());

        $this->assertSame(3, Device::query()
            ->where('school_id', $school->id)
            ->whereIn('device_code', ['UAT-PC-001', 'UAT-PC-002', 'UAT-PC-101'])
            ->count());

        $pc1 = Device::query()->where('school_id', $school->id)->where('device_code', 'UAT-PC-001')->sole();
        $pc2 = Device::query()->where('school_id', $school->id)->where('device_code', 'UAT-PC-002')->sole();
        $this->assertSame(8, $pc1->technical_profile['ramGB']);
        $this->assertSame(16, $pc2->technical_profile['ramGB']);

        $assets = Asset::query()
            ->where('school_id', $school->id)
            ->whereIn('asset_code', ['UAT-AST-PC001', 'UAT-AST-PC002', 'UAT-AST-PC101'])
            ->get();

        $this->assertCount(3, $assets);
        $this->assertSame(3, $assets->whereNotNull('linked_device_id')->count());
        $this->assertDatabaseHas('assets', [
            'school_id' => $school->id,
            'asset_code' => 'UAT-AST-MEJA01',
            'linked_device_id' => null,
        ]);

        $ram = InventoryItem::query()->where('school_id', $school->id)->where('item_code', 'UAT-RAM-16GB')->sole();
        $cable = InventoryItem::query()->where('school_id', $school->id)->where('item_code', 'UAT-CABLE-LAN')->sole();

        $this->assertSame('6.000', $ram->on_hand_quantity);
        $this->assertSame('50.500', $cable->on_hand_quantity);
        $this->assertSame(2, InventoryTransaction::query()->where('school_id', $school->id)->count());

        $year = AcademicYear::query()->where('school_id', $school->id)->where('code', '2026-2027')->sole();
        $this->assertDatabaseHas('semesters', ['academic_year_id' => $year->id, 'code' => 'GANJIL']);
        $this->assertDatabaseHas('academic_units', ['school_id' => $school->id, 'code' => 'PPLG']);
        $this->assertDatabaseHas('teachers', ['school_id' => $school->id, 'code' => 'UAT-GURU']);
        $this->assertDatabaseHas('academic_classes', ['school_id' => $school->id, 'code' => 'XI-PPLG-1']);
        $this->assertDatabaseHas('subjects', ['school_id' => $school->id, 'code' => 'PWEB']);
        $this->assertSame(12, LessonPeriod::query()->where('school_id', $school->id)->count());

        $this->assertSame(0, LoanItem::query()->where('school_id', $school->id)->where('custody_active', true)->count());
        $this->assertSame(0, MaintenanceExecution::query()->where('school_id', $school->id)->where('custody_active', true)->count());
        $this->assertSame(0, WorkOrder::query()->where('school_id', $school->id)->where('custody_active', true)->count());
        $this->assertSame(0, MaintenanceCampaign::query()->where('school_id', $school->id)->count());
    }

    public function test_it_is_idempotent_and_preserves_existing_inventory_ledger_and_master_versions(): void
    {
        $school = $this->prepareUatAdmin();
        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD=FixturePassword123!');

        $seeder = app(UatS1S5FixtureSeeder::class);
        $seeder->run();

        $ram = InventoryItem::query()->where('school_id', $school->id)->where('item_code', 'UAT-RAM-16GB')->sole();
        $year = AcademicYear::query()->where('school_id', $school->id)->where('code', '2026-2027')->sole();

        $ramTransactionIds = InventoryTransaction::query()
            ->where('school_id', $school->id)
            ->where('inventory_item_id', $ram->id)
            ->pluck('id')
            ->all();

        $year->version = 7;
        $year->save();

        $seeder->run();

        $this->assertSame(2, Laboratory::query()
            ->where('school_id', $school->id)
            ->whereIn('code', ['UAT-RPL1', 'UAT-RPL2'])
            ->count());
        $this->assertSame(3, Device::query()
            ->where('school_id', $school->id)
            ->whereIn('device_code', ['UAT-PC-001', 'UAT-PC-002', 'UAT-PC-101'])
            ->count());
        $this->assertSame(4, Asset::query()
            ->where('school_id', $school->id)
            ->whereIn('asset_code', ['UAT-AST-PC001', 'UAT-AST-PC002', 'UAT-AST-PC101', 'UAT-AST-MEJA01'])
            ->count());
        $this->assertSame(2, InventoryItem::query()
            ->where('school_id', $school->id)
            ->whereIn('item_code', ['UAT-RAM-16GB', 'UAT-CABLE-LAN'])
            ->count());
        $this->assertSame(2, InventoryTransaction::query()->where('school_id', $school->id)->count());
        $this->assertSame(
            $ramTransactionIds,
            InventoryTransaction::query()
                ->where('school_id', $school->id)
                ->where('inventory_item_id', $ram->id)
                ->pluck('id')
                ->all(),
        );
        $this->assertSame('6.000', $ram->fresh()->on_hand_quantity);
        $this->assertSame(7, $year->fresh()->version);
    }

    public function test_it_refuses_to_run_outside_local_or_testing(): void
    {
        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD=FixturePassword123!');

        $originalEnvironment = app()->environment();
        app()['env'] = 'production';

        try {
            $this->expectException(RuntimeException::class);
            $this->expectExceptionMessage(
                'UatS1S5FixtureSeeder hanya boleh dijalankan pada environment local/testing.',
            );

            app(UatS1S5FixtureSeeder::class)->run();
        } finally {
            app()['env'] = $originalEnvironment;
        }
    }

    public function test_it_requires_an_explicit_password(): void
    {
        $this->prepareUatAdmin();
        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD=short');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(
            'SMARTLAB_UAT_FIXTURE_PASSWORD wajib diisi dengan password minimal 12 karakter.',
        );

        app(UatS1S5FixtureSeeder::class)->run();
    }

    public function test_it_refuses_to_guess_or_elevate_the_target_school(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create([
            'email' => UatAdminSeeder::EMAIL,
            'status' => 'active',
        ]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->roles()->sync([Role::query()->where('key', 'guru')->sole()->id]);

        putenv('SMARTLAB_UAT_FIXTURE_PASSWORD=FixturePassword123!');

        try {
            app(UatS1S5FixtureSeeder::class)->run();
            $this->fail('Seeder should fail closed without an already-authorized UAT super-admin membership.');
        } catch (RuntimeException $exception) {
            $this->assertSame(
                'UatS1S5FixtureSeeder memerlukan tepat satu membership aktif UAT admin yang sudah memiliki role super-admin.',
                $exception->getMessage(),
            );
        }

        $this->assertSame(['guru'], $membership->roles()->pluck('key')->all());
        $this->assertSame(0, User::query()->whereIn('email', array_keys(UatS1S5FixtureSeeder::ACCOUNTS))->count());
    }

    private function prepareUatAdmin(): School
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

        return $school;
    }

    private function membershipFor(School $school, string $email): SchoolMembership
    {
        $user = User::query()->where('email', $email)->sole();

        return SchoolMembership::query()
            ->where('school_id', $school->id)
            ->where('user_id', $user->id)
            ->sole();
    }
}
