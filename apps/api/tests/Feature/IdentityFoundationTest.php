<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\PermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IdentityFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_returns_the_exact_safe_response(): void
    {
        $this->getJson('/api/v1/health')
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'status' => 'ok',
                    'service' => 'smartlab-api',
                ],
            ]);
    }

    public function test_guest_cannot_read_current_user_context(): void
    {
        $this->getJson('/api/v1/me')
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_stateful_web_user_with_one_active_membership_receives_context(): void
    {
        $user = User::factory()->create(['name' => 'Ayu Admin', 'email' => 'ayu@example.test']);
        $school = School::factory()->create(['code' => 'SMK-01', 'name' => 'SMK SmartLab']);
        $membership = $this->activeMembership($user, $school);
        $role = Role::factory()->create(['key' => 'admin-lab', 'name' => 'Admin Lab']);
        $assetView = Permission::factory()->create(['key' => 'assets.view', 'name' => 'Lihat Aset']);
        $laboratoryView = Permission::factory()->create(['key' => 'laboratories.view', 'name' => 'Lihat Laboratorium']);

        $membership->roles()->attach($role->id);
        $role->permissions()->attach([$assetView->id, $laboratoryView->id]);

        $this->actingAs($user, 'web');

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'id' => $user->id,
                    'name' => 'Ayu Admin',
                    'email' => 'ayu@example.test',
                    'school' => [
                        'id' => $school->id,
                        'code' => 'SMK-01',
                        'name' => 'SMK SmartLab',
                    ],
                    'membership' => [
                        'id' => $membership->id,
                        'status' => 'active',
                        'roles' => ['Admin Lab'],
                    ],
                    'permissions' => ['assets.view', 'laboratories.view'],
                ],
            ]);
    }

    public function test_authenticated_user_without_an_active_membership_receives_explicit_context_error(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'An active school membership is required.',
                'code' => 'ACTIVE_MEMBERSHIP_REQUIRED',
            ]);
    }

    public function test_user_with_multiple_active_memberships_must_select_a_school_context(): void
    {
        $user = User::factory()->create();
        $this->activeMembership($user, School::factory()->create());
        $this->activeMembership($user, School::factory()->create());

        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'A school context must be selected before this request can continue.',
                'code' => 'SCHOOL_CONTEXT_REQUIRED',
            ]);
    }

    public function test_active_membership_for_an_inactive_school_is_not_a_valid_context(): void
    {
        $user = User::factory()->create();
        $this->activeMembership($user, School::factory()->create(['status' => 'inactive']));
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_active_membership_for_a_soft_deleted_school_is_not_a_valid_context(): void
    {
        $user = User::factory()->create();
        $school = School::factory()->create();
        $this->activeMembership($user, $school);
        $school->delete();
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_one_valid_school_resolves_when_another_membership_school_is_inactive(): void
    {
        $user = User::factory()->create();
        $validSchool = School::factory()->create(['code' => 'VALID', 'status' => 'active']);
        $this->activeMembership($user, $validSchool);
        $this->activeMembership($user, School::factory()->create(['status' => 'inactive']));
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.school.id', $validSchool->id)
            ->assertJsonPath('data.school.code', 'VALID');
    }

    public function test_school_codes_and_user_emails_are_unique(): void
    {
        School::factory()->create(['code' => 'SMK-UNIQUE']);
        $this->expectException(QueryException::class);
        School::factory()->create(['code' => 'SMK-UNIQUE']);
    }

    public function test_user_email_is_unique(): void
    {
        User::factory()->create(['email' => 'unique@example.test']);
        $this->expectException(QueryException::class);
        User::factory()->create(['email' => 'unique@example.test']);
    }

    public function test_school_memberships_reject_duplicate_school_user_pairs(): void
    {
        $user = User::factory()->create();
        $school = School::factory()->create();
        $this->activeMembership($user, $school);

        $this->expectException(QueryException::class);
        $this->activeMembership($user, $school);
    }

    public function test_membership_role_assignment_rejects_duplicates(): void
    {
        $membership = $this->activeMembership(User::factory()->create(), School::factory()->create());
        $role = Role::factory()->create();
        $membership->roles()->attach($role->id);

        $this->expectException(QueryException::class);
        $membership->roles()->attach($role->id);
    }

    public function test_role_permission_assignment_rejects_duplicates(): void
    {
        $role = Role::factory()->create();
        $permission = Permission::factory()->create();
        $role->permissions()->attach($permission->id);

        $this->expectException(QueryException::class);
        $role->permissions()->attach($permission->id);
    }

    public function test_user_with_membership_cannot_be_hard_deleted(): void
    {
        $user = User::factory()->create();
        $this->activeMembership($user, School::factory()->create());

        $this->expectException(QueryException::class);
        $user->delete();
    }

    public function test_school_with_membership_cannot_be_force_deleted(): void
    {
        $school = School::factory()->create();
        $this->activeMembership(User::factory()->create(), $school);

        $this->expectException(QueryException::class);
        $school->forceDelete();
    }

    public function test_core_identity_models_generate_ulids(): void
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = $this->activeMembership($user, $school);
        $role = Role::factory()->create();
        $permission = Permission::factory()->create();

        foreach ([$school, $user, $membership, $role, $permission] as $model) {
            $this->assertTrue(Str::isUlid($model->id));
        }
    }

    public function test_effective_permissions_are_unique_and_sorted_across_membership_roles(): void
    {
        $membership = $this->activeMembership(User::factory()->create(), School::factory()->create());
        $firstRole = Role::factory()->create(['key' => 'role-one']);
        $secondRole = Role::factory()->create(['key' => 'role-two']);
        $assetsView = Permission::factory()->create(['key' => 'assets.view']);
        $laboratoriesView = Permission::factory()->create(['key' => 'laboratories.view']);

        $membership->roles()->attach([$firstRole->id, $secondRole->id]);
        $firstRole->permissions()->attach([$assetsView->id, $laboratoriesView->id]);
        $secondRole->permissions()->attach($assetsView->id);

        $membership->load('roles.permissions');

        $this->assertSame(
            ['assets.view', 'laboratories.view'],
            $membership->effectivePermissions()->pluck('key')->all(),
        );
        $this->assertTrue($membership->hasPermission('assets.view'));
    }

    public function test_reference_rbac_seeders_are_idempotent_and_enforce_security_baselines(): void
    {
        $this->seed(DatabaseSeeder::class);

        Role::query()->where('key', 'admin-lab')->update(['name' => 'Incorrect Name']);
        Permission::query()->where('key', 'assets.view')->update(['name' => 'Incorrect Name']);
        $legacyAuditPermission = Permission::factory()->create(['key' => 'audit-logs.create']);
        Role::query()->where('key', 'admin-lab')->firstOrFail()->permissions()->attach($legacyAuditPermission);
        $this->seed(DatabaseSeeder::class);

        $superAdmin = Role::query()->where('key', 'super-admin')->firstOrFail();
        $adminLab = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $student = Role::query()->where('key', 'siswa')->firstOrFail();
        $leader = Role::query()->where('key', 'pimpinan')->firstOrFail();
        $mutationSuffixes = ['.create', '.update', '.delete', '.approve', '.assign', '.manage'];
        $leaderKeys = $leader->permissions()->pluck('key');

        $this->assertSame(8, Role::query()->count());
        $this->assertSame(count(PermissionSeeder::keys()), Permission::query()->count());
        $this->assertSame(Permission::query()->count(), $superAdmin->permissions()->count());
        $this->assertSame('Admin Lab', $adminLab->name);
        $this->assertSame('Lihat Aset', Permission::query()->where('key', 'assets.view')->value('name'));
        $this->assertFalse(Permission::query()->where('key', 'audit-logs.create')->exists());
        $this->assertEqualsCanonicalizing(
            ['audit-logs.view', 'audit-logs.export'],
            $adminLab->permissions()->where('key', 'like', 'audit-logs.%')->pluck('key')->all(),
        );
        $this->assertTrue($student->permissions()->where('key', 'incidents.create')->exists());
        $this->assertTrue($leaderKeys->every(
            fn (string $key) => collect($mutationSuffixes)->every(fn (string $suffix) => ! str_ends_with($key, $suffix)),
        ));
    }

    private function activeMembership(User $user, School $school): SchoolMembership
    {
        return SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
    }
}
