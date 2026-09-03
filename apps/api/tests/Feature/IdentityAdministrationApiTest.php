<?php

namespace Tests\Feature;

use App\Domain\Identity\IdentityChangeEventType;
use App\Models\IdentityChangeEvent;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IdentityAdministrationApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_authentication_and_permission_precede_identity_request_validation(): void
    {
        $this->postJson('/api/v1/identity/memberships', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'siswa');
        $this->postJson('/api/v1/identity/memberships', ['unexpected' => true])
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);

        $this->actingAsRole($school, 'admin-lab');
        $this->postJson('/api/v1/identity/memberships', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors(['name', 'email', 'password', 'roleKeys', 'unexpected']);
    }

    public function test_membership_list_is_tenant_scoped_filterable_and_paginated_deterministically(): void
    {
        $school = School::factory()->create();
        $this->actingAsRole($school, 'admin-lab', ['name' => 'Zed Administrator']);

        $bob = $this->membershipWithRoles(
            $school,
            ['guru'],
            ['name' => 'Bob Guru', 'email' => 'bob@example.test'],
            ['status' => 'inactive'],
        );
        $this->membershipWithRoles(
            $school,
            ['guru'],
            ['name' => 'Alice Guru', 'email' => 'alice@example.test'],
        );

        $otherSchool = School::factory()->create();
        $this->membershipWithRoles(
            $otherSchool,
            ['guru'],
            ['name' => 'Bob Other', 'email' => 'other@example.test'],
            ['status' => 'inactive'],
        );

        $response = $this->getJson('/api/v1/identity/memberships?search=Bob&status=inactive&roleKey=guru&page=1&perPage=10')
            ->assertOk()
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('meta.perPage', 10)
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('meta.lastPage', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $bob->id)
            ->assertJsonPath('data.0.user.name', 'Bob Guru')
            ->assertJsonPath('data.0.status', 'inactive');

        $this->assertSame(
            ['id', 'status', 'user', 'roles', 'createdAt', 'updatedAt'],
            array_keys($response->json('data.0')),
        );
        $this->assertSame(
            ['id', 'name', 'email', 'nip', 'nis', 'phone', 'status', 'lastLoginAt'],
            array_keys($response->json('data.0.user')),
        );

        $this->getJson('/api/v1/identity/memberships?unknown=1')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['unknown']);
    }

    public function test_create_membership_normalizes_identity_hashes_password_and_records_one_safe_event(): void
    {
        [$actor, $school] = $this->actingAsRole(School::factory()->create(), 'super-admin');

        $response = $this->postJson('/api/v1/identity/memberships', [
            'name' => '  Rina Teknisi  ',
            'email' => '  RINA.TEKNISI@EXAMPLE.TEST ',
            'password' => 'VerySafePass123!',
            'nip' => '   ',
            'nis' => ' NIS-001 ',
            'phone' => ' 08123456789 ',
            'roleKeys' => ['guru', 'admin-lab'],
        ])->assertCreated()
            ->assertJsonPath('data.user.name', 'Rina Teknisi')
            ->assertJsonPath('data.user.email', 'rina.teknisi@example.test')
            ->assertJsonPath('data.user.nip', null)
            ->assertJsonPath('data.user.nis', 'NIS-001')
            ->assertJsonPath('data.user.phone', '08123456789')
            ->assertJsonPath('data.user.status', 'active')
            ->assertJsonPath('data.status', 'active');

        $membershipId = $response->json('data.id');
        $userId = $response->json('data.user.id');
        $user = User::query()->findOrFail($userId);
        $membership = SchoolMembership::query()->findOrFail($membershipId);

        $this->assertSame($school->id, $membership->school_id);
        $this->assertTrue(Hash::check('VerySafePass123!', $user->password));
        $this->assertSame(
            ['admin-lab', 'guru'],
            $membership->roles()->pluck('key')->sort()->values()->all(),
        );
        $this->assertArrayNotHasKey('password', $response->json('data.user'));

        $event = IdentityChangeEvent::query()->sole();
        $this->assertSame(IdentityChangeEventType::MembershipCreated, $event->event_type);
        $this->assertSame($school->id, $event->school_id);
        $this->assertSame($actor->id, $event->actor_user_id_snapshot);
        $this->assertSame($membershipId, $event->target_membership_id_snapshot);
        $this->assertSame([
            'userStatus' => 'active',
            'membershipStatus' => 'active',
            'roleKeys' => ['admin-lab', 'guru'],
        ], $event->payload);
        $this->assertStringNotContainsString('password', json_encode($event->payload, JSON_THROW_ON_ERROR));
    }

    public function test_create_rejects_noncanonical_role_unknown_fields_and_case_insensitive_email_conflicts(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        User::factory()->create(['email' => 'Existing@Example.Test']);

        $payload = [
            'name' => 'Another User',
            'email' => 'existing@example.test',
            'password' => 'VerySafePass123!',
            'roleKeys' => ['not-a-role'],
            'actor' => 'forbidden',
        ];

        $this->postJson('/api/v1/identity/memberships', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['roleKeys.0', 'actor']);

        $payload['roleKeys'] = ['guru'];
        unset($payload['actor']);
        $this->postJson('/api/v1/identity/memberships', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['email']);

        $this->assertSame(1, SchoolMembership::query()->where('school_id', $school->id)->count());
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_show_and_update_do_not_disclose_cross_school_memberships(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $otherSchool = School::factory()->create();
        $foreign = $this->membershipWithRoles($otherSchool, ['guru']);

        $this->getJson("/api/v1/identity/memberships/{$foreign->id}")
            ->assertNotFound()
            ->assertExactJson([
                'message' => 'School membership not found.',
                'code' => 'IDENTITY_MEMBERSHIP_NOT_FOUND',
            ]);

        $this->patchJson("/api/v1/identity/memberships/{$foreign->id}", ['name' => 'Leaked'])
            ->assertNotFound()
            ->assertJsonPath('code', 'IDENTITY_MEMBERSHIP_NOT_FOUND');

        $this->assertSame(1, SchoolMembership::query()->where('school_id', $school->id)->count());
        $this->assertNotSame('Leaked', $foreign->user()->value('name'));
    }

    public function test_update_changes_only_requested_state_records_exact_diff_and_effective_noop_adds_no_event(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        $target = $this->membershipWithRoles(
            $school,
            ['guru'],
            [
                'name' => 'Old Name',
                'email' => 'old@example.test',
                'nip' => 'NIP-OLD',
            ],
        );

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'name' => '  New Name ',
            'roleKeys' => ['teknisi'],
        ])->assertOk()
            ->assertJsonPath('data.user.name', 'New Name')
            ->assertJsonPath('data.user.email', 'old@example.test')
            ->assertJsonPath('data.user.nip', 'NIP-OLD')
            ->assertJsonPath('data.roles.0.key', 'teknisi');

        $event = IdentityChangeEvent::query()->sole();
        $this->assertSame(IdentityChangeEventType::MembershipUpdated, $event->event_type);
        $this->assertSame([
            'before' => [
                'name' => 'Old Name',
                'roleKeys' => ['guru'],
            ],
            'after' => [
                'name' => 'New Name',
                'roleKeys' => ['teknisi'],
            ],
        ], $event->payload);

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'name' => ' New Name ',
            'roleKeys' => ['teknisi'],
        ])->assertOk();

        $this->assertSame(1, IdentityChangeEvent::query()->count());

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['request']);
    }

    public function test_update_rejects_case_insensitive_email_conflict_without_partial_change(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        $target = $this->membershipWithRoles($school, ['guru'], ['email' => 'target@example.test']);
        User::factory()->create(['email' => 'Taken@Example.Test']);

        $this->patchJson("/api/v1/identity/memberships/{$target->id}", [
            'email' => ' taken@example.test ',
            'phone' => '999',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['email']);

        $target->user->refresh();
        $this->assertSame('target@example.test', $target->user->email);
        $this->assertNull($target->user->phone);
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_last_active_super_admin_cannot_be_removed_deactivated_or_disabled(): void
    {
        [, , $membership] = $this->actingAsRole(School::factory()->create(), 'super-admin');

        foreach ([
            ['roleKeys' => ['admin-lab']],
            ['membershipStatus' => 'inactive'],
            ['userStatus' => 'inactive'],
        ] as $payload) {
            $this->patchJson("/api/v1/identity/memberships/{$membership->id}", $payload)
                ->assertStatus(409)
                ->assertExactJson([
                    'message' => 'At least one active Super Admin membership is required for this school.',
                    'code' => 'IDENTITY_LAST_SUPER_ADMIN_REQUIRED',
                ]);
        }

        $membership->refresh()->load('roles');
        $membership->user->refresh();
        $this->assertSame('active', $membership->status);
        $this->assertSame('active', $membership->user->status);
        $this->assertSame(['super-admin'], $membership->roles->pluck('key')->all());
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_super_admin_can_be_deactivated_when_another_active_super_admin_remains(): void
    {
        [, $school, $first] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        $second = $this->membershipWithRoles($school, ['super-admin']);

        $this->patchJson("/api/v1/identity/memberships/{$first->id}", [
            'membershipStatus' => 'inactive',
        ])->assertOk()
            ->assertJsonPath('data.status', 'inactive');

        $this->assertSame('active', $second->fresh()->status);
        $this->assertSame(1, IdentityChangeEvent::query()->count());
    }

    public function test_role_catalog_is_server_authoritative_sorted_and_tenant_counted(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'kepala-lab');
        $this->membershipWithRoles($school, ['admin-lab']);
        $this->membershipWithRoles($school, ['admin-lab'], ['status' => 'inactive']);
        $otherSchool = School::factory()->create();
        $this->membershipWithRoles($otherSchool, ['admin-lab']);

        $response = $this->getJson('/api/v1/identity/roles')
            ->assertOk()
            ->assertJsonCount(8, 'data');

        $rows = collect($response->json('data'));
        $names = $rows->pluck('name')->all();
        $sortedNames = $names;
        sort($sortedNames);
        $this->assertSame($sortedNames, $names);

        $admin = $rows->firstWhere('key', 'admin-lab');
        $this->assertNotNull($admin);
        $this->assertSame(2, $admin['membershipCount']);
        $this->assertSame(1, $admin['activeMembershipCount']);
        $this->assertContains('users.view', $admin['permissions']);
        $this->assertContains('users.create', $admin['permissions']);
        $this->assertContains('users.update', $admin['permissions']);
        $this->assertContains('roles.view', $admin['permissions']);
        $permissions = $admin['permissions'];
        $sortedPermissions = $permissions;
        sort($sortedPermissions);
        $this->assertSame($sortedPermissions, $permissions);
    }

    public function test_identity_change_events_are_immutable_at_database_level(): void
    {
        [$actor, $school, $membership] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        $event = IdentityChangeEvent::query()->create([
            'school_id' => $school->id,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $membership->id,
            'actor_name_snapshot' => $actor->name,
            'target_user_id' => $actor->id,
            'target_membership_id' => $membership->id,
            'target_user_id_snapshot' => $actor->id,
            'target_membership_id_snapshot' => $membership->id,
            'target_name_snapshot' => $actor->name,
            'event_type' => IdentityChangeEventType::MembershipCreated,
            'payload' => [
                'userStatus' => 'active',
                'membershipStatus' => 'active',
                'roleKeys' => ['super-admin'],
            ],
            'created_at' => now(),
        ]);

        $updateBlocked = false;
        try {
            DB::table('identity_change_events')->where('id', $event->id)->update(['event_type' => 'tampered']);
        } catch (QueryException) {
            $updateBlocked = true;
        }
        $this->assertTrue($updateBlocked);

        $deleteBlocked = false;
        try {
            DB::table('identity_change_events')->where('id', $event->id)->delete();
        } catch (QueryException) {
            $deleteBlocked = true;
        }
        $this->assertTrue($deleteBlocked);
        $this->assertDatabaseHas('identity_change_events', ['id' => $event->id]);
    }

    public function test_event_insert_failure_rolls_back_user_membership_and_roles(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('Portable rollback fault injection is implemented for SQLite test runs.');
        }

        [, $school] = $this->actingAsRole(School::factory()->create(), 'super-admin');
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER identity_change_events_test_insert_failure
            BEFORE INSERT ON identity_change_events
            BEGIN
                SELECT RAISE(ABORT, 'forced identity audit insert failure');
            END;
        SQL);

        try {
            $this->postJson('/api/v1/identity/memberships', [
                'name' => 'Rollback User',
                'email' => 'rollback@example.test',
                'password' => 'VerySafePass123!',
                'roleKeys' => ['guru'],
            ])->assertStatus(500);
        } finally {
            DB::unprepared('DROP TRIGGER IF EXISTS identity_change_events_test_insert_failure');
        }

        $this->assertDatabaseMissing('users', ['email' => 'rollback@example.test']);
        $this->assertSame(1, SchoolMembership::query()->where('school_id', $school->id)->count());
        $this->assertSame(0, IdentityChangeEvent::query()->count());
    }

    public function test_identity_routes_have_exact_server_permissions_and_no_delete_route(): void
    {
        $routes = collect(app('router')->getRoutes()->getRoutes())
            ->filter(fn ($route) => str_starts_with($route->uri(), 'api/v1/identity/'))
            ->values();

        $this->assertSame([
            'api/v1/identity/memberships',
            'api/v1/identity/memberships',
            'api/v1/identity/memberships/{membershipId}',
            'api/v1/identity/memberships/{membershipId}',
            'api/v1/identity/roles',
        ], $routes->map(fn ($route): string => $route->uri())->all());

        $this->assertContains('permission:users.view', $routes[0]->gatherMiddleware());
        $this->assertContains('permission:users.create', $routes[1]->gatherMiddleware());
        $this->assertContains('permission:users.view', $routes[2]->gatherMiddleware());
        $this->assertContains('permission:users.update', $routes[3]->gatherMiddleware());
        $this->assertContains('permission:roles.view', $routes[4]->gatherMiddleware());
        $this->assertTrue($routes->every(fn ($route) => in_array('auth:sanctum', $route->gatherMiddleware(), true)));
        $this->assertTrue($routes->every(fn ($route) => ! in_array('DELETE', $route->methods(), true)));
    }

    /** @return array{User, School, SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey, array $userAttributes = []): array
    {
        $user = User::factory()->create($userAttributes);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $role = Role::query()->where('key', $roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        $membership->setRelation('user', $user);

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    private function membershipWithRoles(
        School $school,
        array $roleKeys,
        array $userAttributes = [],
        array $membershipAttributes = [],
    ): SchoolMembership {
        $user = User::factory()->create($userAttributes);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => $membershipAttributes['status'] ?? 'active',
        ]);
        $roleIds = Role::query()->whereIn('key', $roleKeys)->pluck('id');
        $membership->roles()->sync($roleIds);

        return $membership->load('user', 'roles');
    }
}
