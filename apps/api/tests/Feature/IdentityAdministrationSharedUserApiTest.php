<?php

namespace Tests\Feature;

use App\Models\IdentityChangeEvent;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IdentityAdministrationSharedUserApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_shared_user_global_account_change_is_rejected_without_partial_tenant_mutation(): void
    {
        $school = School::factory()->create();
        $this->authenticateSuperAdmin($school);

        $targetUser = User::factory()->create([
            'name' => 'Shared User',
            'email' => 'shared@example.test',
            'status' => 'active',
        ]);
        $target = $this->membership($school, $targetUser, 'guru');

        $otherSchool = School::factory()->create();
        $otherMembership = $this->membership($otherSchool, $targetUser, 'siswa', 'inactive');

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'name' => 'Cross Tenant Change',
            'membershipStatus' => 'inactive',
            'roleKeys' => ['teknisi'],
        ])->assertStatus(409)
            ->assertExactJson([
                'message' => 'Shared user account fields cannot be changed from a school-scoped administration context.',
                'code' => 'IDENTITY_SHARED_USER_MUTATION_REQUIRES_GLOBAL_AUTHORITY',
            ]);

        $targetUser->refresh();
        $target->refresh()->load('roles');
        $otherMembership->refresh();

        $this->assertSame('Shared User', $targetUser->name);
        $this->assertSame('shared@example.test', $targetUser->email);
        $this->assertSame('active', $target->status);
        $this->assertSame(['guru'], $target->roles->pluck('key')->all());
        $this->assertSame('inactive', $otherMembership->status);
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_shared_user_global_status_change_is_rejected(): void
    {
        $school = School::factory()->create();
        $this->authenticateSuperAdmin($school);

        $targetUser = User::factory()->create(['status' => 'active']);
        $target = $this->membership($school, $targetUser, 'guru');
        $this->membership(School::factory()->create(), $targetUser, 'siswa');

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'userStatus' => 'inactive',
        ])->assertStatus(409)
            ->assertJsonPath('code', 'IDENTITY_SHARED_USER_MUTATION_REQUIRES_GLOBAL_AUTHORITY');

        $this->assertSame('active', $targetUser->fresh()->status);
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_shared_user_can_still_receive_current_school_membership_and_role_changes(): void
    {
        $school = School::factory()->create();
        $this->authenticateSuperAdmin($school);

        $targetUser = User::factory()->create([
            'name' => 'Shared User',
            'email' => 'shared@example.test',
        ]);
        $target = $this->membership($school, $targetUser, 'guru');
        $other = $this->membership(School::factory()->create(), $targetUser, 'siswa');

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'membershipStatus' => 'inactive',
            'roleKeys' => ['teknisi'],
        ])->assertOk()
            ->assertJsonPath('data.status', 'inactive')
            ->assertJsonPath('data.roles.0.key', 'teknisi')
            ->assertJsonPath('data.user.name', 'Shared User')
            ->assertJsonPath('data.user.email', 'shared@example.test');

        $target->refresh()->load('roles');
        $other->refresh()->load('roles');
        $targetUser->refresh();

        $this->assertSame('inactive', $target->status);
        $this->assertSame(['teknisi'], $target->roles->pluck('key')->all());
        $this->assertSame('active', $other->status);
        $this->assertSame(['siswa'], $other->roles->pluck('key')->all());
        $this->assertSame('Shared User', $targetUser->name);
        $this->assertSame('shared@example.test', $targetUser->email);
        $this->assertSame(1, IdentityChangeEvent::query()->count());
    }

    public function test_shared_user_effective_global_noop_does_not_disclose_or_emit_an_event(): void
    {
        $school = School::factory()->create();
        $this->authenticateSuperAdmin($school);

        $targetUser = User::factory()->create(['name' => 'Shared User']);
        $target = $this->membership($school, $targetUser, 'guru');
        $this->membership(School::factory()->create(), $targetUser, 'siswa');

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'name' => '  Shared User  ',
        ])->assertOk()
            ->assertJsonPath('data.user.name', 'Shared User');

        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    private function authenticateSuperAdmin(School $school): void
    {
        $user = User::factory()->create();
        $membership = $this->membership($school, $user, 'super-admin');
        Sanctum::actingAs($user);
        $membership->load('roles.permissions');
    }

    private function membership(
        School $school,
        User $user,
        string $roleKey,
        string $status = 'active',
    ): SchoolMembership {
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => $status,
        ]);
        $role = Role::query()->where('key', $roleKey)->firstOrFail();
        $membership->roles()->attach($role->id);

        return $membership;
    }
}
