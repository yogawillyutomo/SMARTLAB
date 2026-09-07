<?php

namespace Tests\Feature;

use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\UatAdminSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

class UatAdminSeederTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    protected function tearDown(): void
    {
        putenv('SMARTLAB_UAT_ADMIN_PASSWORD');
        parent::tearDown();
    }

    public function test_it_resets_only_the_existing_local_uat_admin_password(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create([
            'email' => UatAdminSeeder::EMAIL,
            'password' => 'OldUatPassword123!',
            'status' => 'active',
        ]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $superAdmin = Role::query()->where('key', 'super-admin')->sole();
        $membership->roles()->sync([$superAdmin->id]);

        putenv('SMARTLAB_UAT_ADMIN_PASSWORD=NewUatPassword123!');

        $this->seed(UatAdminSeeder::class);

        $user->refresh();
        $membership->refresh();

        $this->assertTrue(Hash::check('NewUatPassword123!', $user->password));
        $this->assertSame('active', $user->status);
        $this->assertSame(
            ['super-admin'],
            $membership->roles()->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame($school->id, $membership->school_id);
    }

    public function test_it_refuses_to_run_outside_local_or_testing(): void
    {
        putenv('SMARTLAB_UAT_ADMIN_PASSWORD=NewUatPassword123!');

        $originalEnvironment = app()->environment();
        app()['env'] = 'production';

        try {
            $this->expectException(RuntimeException::class);
            $this->expectExceptionMessage(
                'UatAdminSeeder hanya boleh dijalankan pada environment local/testing.',
            );

            $this->seed(UatAdminSeeder::class);
        } finally {
            app()['env'] = $originalEnvironment;
        }
    }

    public function test_it_refuses_to_elevate_a_non_super_admin_membership(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create([
            'email' => UatAdminSeeder::EMAIL,
            'password' => 'OldUatPassword123!',
            'status' => 'active',
        ]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $guru = Role::query()->where('key', 'guru')->sole();
        $membership->roles()->sync([$guru->id]);
        $originalPasswordHash = $user->password;

        putenv('SMARTLAB_UAT_ADMIN_PASSWORD=NewUatPassword123!');

        try {
            $this->seed(UatAdminSeeder::class);
            $this->fail('Seeder should fail closed when the UAT membership is not already super-admin.');
        } catch (RuntimeException $exception) {
            $this->assertSame(
                'UAT admin membership harus sudah memiliki role SMARTLAB local super-admin.',
                $exception->getMessage(),
            );
        }

        $this->assertSame($originalPasswordHash, $user->fresh()->password);
        $this->assertSame(['guru'], $membership->roles()->pluck('key')->all());
    }

    public function test_it_requires_an_explicit_password_of_at_least_twelve_characters(): void
    {
        putenv('SMARTLAB_UAT_ADMIN_PASSWORD=short');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage(
            'SMARTLAB_UAT_ADMIN_PASSWORD wajib diisi dengan password minimal 12 karakter.',
        );

        $this->seed(UatAdminSeeder::class);
    }
}
