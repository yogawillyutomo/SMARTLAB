<?php

namespace Tests\Feature;

use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LaboratoryApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_rejected(): void
    {
        $this->getJson('/api/v1/laboratories')
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_no_active_membership_returns_the_existing_context_error(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/laboratories')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'An active school membership is required.',
                'code' => 'ACTIVE_MEMBERSHIP_REQUIRED',
            ]);
    }

    public function test_multiple_active_memberships_return_the_existing_context_error(): void
    {
        $user = User::factory()->create();
        $this->activeMembership($user, School::factory()->create());
        $this->activeMembership($user, School::factory()->create());
        Sanctum::actingAs($user);

        $this->getJson('/api/v1/laboratories')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'A school context must be selected before this request can continue.',
                'code' => 'SCHOOL_CONTEXT_REQUIRED',
            ]);
    }

    public function test_laboratories_view_can_list_current_school_laboratories_in_code_order(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.view']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-B']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-A']);

        $response = $this->getJson('/api/v1/laboratories')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.code', 'LAB-A')
            ->assertJsonPath('data.1.code', 'LAB-B');

        $this->assertSame(['data'], array_keys($response->json()));
    }

    public function test_collection_contains_only_the_current_schools_laboratories(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.view']);
        $current = Laboratory::factory()->for($school)->create(['code' => 'CURRENT']);
        $other = Laboratory::factory()->create(['code' => 'OTHER']);

        $this->getJson('/api/v1/laboratories')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $current->id)
            ->assertJsonMissing(['id' => $other->id]);
    }

    public function test_user_without_laboratories_view_receives_stable_forbidden_response(): void
    {
        $this->authenticateWithPermissions([]);

        $this->getJson('/api/v1/laboratories')
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);
    }

    public function test_laboratories_create_can_create_with_default_active_status(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.create']);

        $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.status', 'active');

        $this->assertDatabaseHas('laboratories', [
            'school_id' => $school->id,
            'code' => 'LAB-RPL-1',
            'status' => 'active',
        ]);
    }

    public function test_create_requires_laboratories_create_permission(): void
    {
        $this->authenticateWithPermissions(['laboratories.view']);

        $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);

        $this->assertDatabaseCount('laboratories', 0);
    }

    public function test_school_id_is_derived_from_the_membership_context(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.create']);

        $response = $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertCreated();

        $laboratory = Laboratory::query()->sole();

        $this->assertSame($school->id, $laboratory->school_id);
        $response->assertJsonPath('data.schoolId', $school->id);
    }

    public function test_client_cannot_choose_another_school_id(): void
    {
        $this->authenticateWithPermissions(['laboratories.create']);
        $otherSchool = School::factory()->create();

        $this->postJson('/api/v1/laboratories', [
            ...$this->validPayload(),
            'school_id' => $otherSchool->id,
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('school_id');

        $this->assertDatabaseCount('laboratories', 0);
    }

    public function test_read_only_identity_and_timestamp_fields_are_rejected(): void
    {
        $this->authenticateWithPermissions(['laboratories.create']);

        $this->postJson('/api/v1/laboratories', [
            ...$this->validPayload(),
            'id' => (string) Str::ulid(),
            'schoolId' => (string) Str::ulid(),
            'created_at' => now()->toISOString(),
            'createdAt' => now()->toISOString(),
            'updated_at' => now()->toISOString(),
            'updatedAt' => now()->toISOString(),
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'id',
                'schoolId',
                'created_at',
                'createdAt',
                'updated_at',
                'updatedAt',
            ]);

        $this->assertDatabaseCount('laboratories', 0);
    }

    public function test_unknown_mutation_fields_are_rejected_to_match_the_closed_openapi_schemas(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'laboratories.create',
            'laboratories.update',
        ]);

        $this->postJson('/api/v1/laboratories', [
            ...$this->validPayload(),
            'pcCount' => 36,
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('pcCount');

        $this->assertDatabaseCount('laboratories', 0);

        $laboratory = Laboratory::factory()->for($school)->create(['name' => 'Canonical Name']);

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, [
            'name' => 'Allowed Name',
            'layoutRows' => 8,
        ])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('layoutRows');

        $this->assertDatabaseHas('laboratories', [
            'id' => $laboratory->id,
            'name' => 'Canonical Name',
        ]);
    }

    public function test_duplicate_code_in_the_same_school_is_rejected(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.create']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-RPL-1']);

        $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('code');

        $this->assertDatabaseCount('laboratories', 1);
    }

    public function test_same_laboratory_code_in_different_schools_is_allowed(): void
    {
        Laboratory::factory()->create(['code' => 'LAB-RPL-1']);
        [, $school] = $this->authenticateWithPermissions(['laboratories.create']);

        $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertCreated();

        $this->assertDatabaseHas('laboratories', [
            'school_id' => $school->id,
            'code' => 'LAB-RPL-1',
        ]);
        $this->assertDatabaseCount('laboratories', 2);
    }

    public function test_show_returns_a_current_school_laboratory_in_the_stable_envelope(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.view']);
        $laboratory = Laboratory::factory()->for($school)->create([
            'code' => 'LAB-SHOW',
            'name' => 'Laboratorium Show',
            'location' => 'Gedung A',
            'capacity' => 32,
            'status' => 'inactive',
        ]);

        $this->getJson('/api/v1/laboratories/'.$laboratory->id)
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'id' => $laboratory->id,
                    'schoolId' => $school->id,
                    'code' => 'LAB-SHOW',
                    'name' => 'Laboratorium Show',
                    'location' => 'Gedung A',
                    'capacity' => 32,
                    'status' => 'inactive',
                    'createdAt' => $laboratory->created_at->toISOString(),
                    'updatedAt' => $laboratory->updated_at->toISOString(),
                ],
            ]);
    }

    public function test_show_for_another_schools_laboratory_returns_stable_not_found(): void
    {
        $this->authenticateWithPermissions(['laboratories.view']);
        $otherLaboratory = Laboratory::factory()->create();
        $expectedError = [
            'message' => 'Laboratory not found.',
            'code' => 'LABORATORY_NOT_FOUND',
        ];

        $this->getJson('/api/v1/laboratories/'.$otherLaboratory->id)
            ->assertNotFound()
            ->assertExactJson($expectedError);

        $this->getJson('/api/v1/laboratories/'.Str::ulid())
            ->assertNotFound()
            ->assertExactJson($expectedError);
    }

    public function test_update_requires_laboratories_update_permission(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.view']);
        $laboratory = Laboratory::factory()->for($school)->create();

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['name' => 'Updated'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->assertDatabaseMissing('laboratories', ['id' => $laboratory->id, 'name' => 'Updated']);
    }

    public function test_update_can_partially_change_a_current_school_laboratory(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $laboratory = Laboratory::factory()->for($school)->create([
            'code' => 'LAB-OLD',
            'name' => 'Old Name',
        ]);

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, [
            'name' => 'New Name',
            'status' => 'inactive',
        ])
            ->assertOk()
            ->assertJsonPath('data.code', 'LAB-OLD')
            ->assertJsonPath('data.name', 'New Name')
            ->assertJsonPath('data.status', 'inactive');

        $this->assertDatabaseHas('laboratories', [
            'id' => $laboratory->id,
            'name' => 'New Name',
            'status' => 'inactive',
        ]);
    }

    public function test_update_rejects_a_duplicate_code_inside_the_current_school(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-TAKEN']);
        $laboratory = Laboratory::factory()->for($school)->create(['code' => 'LAB-EDIT']);

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['code' => 'LAB-TAKEN'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('code');

        $this->assertDatabaseHas('laboratories', ['id' => $laboratory->id, 'code' => 'LAB-EDIT']);
    }

    public function test_update_uniqueness_excludes_the_current_laboratorys_own_code(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $laboratory = Laboratory::factory()->for($school)->create(['code' => 'LAB-KEEP']);

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['code' => 'LAB-KEEP'])
            ->assertOk()
            ->assertJsonPath('data.code', 'LAB-KEEP');

        $this->assertDatabaseCount('laboratories', 1);
    }

    public function test_update_allows_a_code_used_only_by_another_school(): void
    {
        Laboratory::factory()->create(['code' => 'LAB-SHARED']);
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $laboratory = Laboratory::factory()->for($school)->create(['code' => 'LAB-EDIT']);

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['code' => 'LAB-SHARED'])
            ->assertOk()
            ->assertJsonPath('data.code', 'LAB-SHARED');

        $this->assertDatabaseHas('laboratories', [
            'id' => $laboratory->id,
            'school_id' => $school->id,
            'code' => 'LAB-SHARED',
        ]);
    }

    public function test_update_rejects_tenant_ownership_mutation(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $otherSchool = School::factory()->create();
        $laboratory = Laboratory::factory()->for($school)->create();

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, [
            'schoolId' => $otherSchool->id,
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['schoolId', 'request']);

        $this->assertDatabaseHas('laboratories', [
            'id' => $laboratory->id,
            'school_id' => $school->id,
        ]);
    }

    public function test_update_cannot_cross_the_tenant_boundary(): void
    {
        $this->authenticateWithPermissions(['laboratories.update']);
        $otherLaboratory = Laboratory::factory()->create(['name' => 'Other School Lab']);
        $expectedError = [
            'message' => 'Laboratory not found.',
            'code' => 'LABORATORY_NOT_FOUND',
        ];

        $this->patchJson('/api/v1/laboratories/'.$otherLaboratory->id, ['name' => 'Leaked Update'])
            ->assertNotFound()
            ->assertExactJson($expectedError);

        $this->patchJson('/api/v1/laboratories/'.Str::ulid(), ['name' => 'Unknown Update'])
            ->assertNotFound()
            ->assertExactJson($expectedError);

        $this->assertDatabaseHas('laboratories', [
            'id' => $otherLaboratory->id,
            'name' => 'Other School Lab',
        ]);
    }

    public function test_update_rejects_an_effectively_empty_payload(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $laboratory = Laboratory::factory()->for($school)->create();

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, [])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('request');
    }

    public function test_status_only_allows_active_or_inactive_on_create_and_update(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'laboratories.create',
            'laboratories.update',
        ]);

        $this->postJson('/api/v1/laboratories', [
            ...$this->validPayload(),
            'status' => 'maintenance',
        ])->assertUnprocessable()->assertJsonValidationErrors('status');

        $laboratory = Laboratory::factory()->for($school)->create();

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['status' => 'deleted'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('status');
    }

    public function test_database_rejects_a_noncanonical_laboratory_status(): void
    {
        $this->expectException(QueryException::class);

        Laboratory::factory()->create(['status' => 'maintenance']);
    }

    public function test_capacity_rejects_non_positive_and_non_integer_values(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'laboratories.create',
            'laboratories.update',
        ]);

        $this->postJson('/api/v1/laboratories', [
            ...$this->validPayload(),
            'capacity' => 0,
        ])->assertUnprocessable()->assertJsonValidationErrors('capacity');

        $laboratory = Laboratory::factory()->for($school)->create();

        $this->patchJson('/api/v1/laboratories/'.$laboratory->id, ['capacity' => 1.5])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('capacity');
    }

    public function test_laboratory_ids_are_ulids(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.create']);

        $response = $this->postJson('/api/v1/laboratories', $this->validPayload())
            ->assertCreated();

        $this->assertTrue(Str::isUlid($response->json('data.id')));
        $this->assertTrue(Str::isUlid(Laboratory::query()->sole()->id));
        $this->assertSame($school->id, $response->json('data.schoolId'));
    }

    public function test_no_delete_laboratory_api_is_exposed(): void
    {
        [, $school] = $this->authenticateWithPermissions(['laboratories.update']);
        $laboratory = Laboratory::factory()->for($school)->create();

        $this->deleteJson('/api/v1/laboratories/'.$laboratory->id)
            ->assertStatus(405);

        $this->assertDatabaseHas('laboratories', ['id' => $laboratory->id]);
    }

    public function test_school_hard_delete_is_restricted_while_laboratories_exist(): void
    {
        $school = School::factory()->create();
        Laboratory::factory()->for($school)->create();

        $this->expectException(QueryException::class);
        $school->forceDelete();
    }

    /**
     * @param  list<string>  $permissions
     * @return array{User, School, SchoolMembership}
     */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = $this->activeMembership($user, $school);

        if ($permissions !== []) {
            $role = Role::factory()->create();
            $permissionIds = collect($permissions)->map(
                fn (string $key): string => Permission::factory()->create([
                    'key' => $key,
                    'name' => $key,
                ])->id,
            );

            $membership->roles()->attach($role->id);
            $role->permissions()->attach($permissionIds);
        }

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    private function activeMembership(User $user, School $school): SchoolMembership
    {
        return SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
    }

    /**
     * @return array{code: string, name: string, location: string, capacity: int}
     */
    private function validPayload(): array
    {
        return [
            'code' => 'LAB-RPL-1',
            'name' => 'Laboratorium RPL 1',
            'location' => 'Gedung Teknologi Lantai 2',
            'capacity' => 36,
        ];
    }
}
