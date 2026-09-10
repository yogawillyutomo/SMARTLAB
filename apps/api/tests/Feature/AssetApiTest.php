<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetChangeEvent;
use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssetApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/assets')->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/assets')->assertStatus(409)->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_create_derives_school_normalizes_code_defaults_state_and_writes_event(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['assets.create']);

        $response = $this->postJson('/api/v1/assets', $this->validPayload([
            'assetCode' => ' ast-000123 ',
            'purchasePrice' => 1250000,
        ]))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.assetCode', 'AST-000123')
            ->assertJsonPath('data.condition', 'unknown')
            ->assertJsonPath('data.lifecycleStatus', 'active')
            ->assertJsonPath('data.linkedDeviceId', null)
            ->assertJsonPath('data.version', 1);

        $this->assertTrue(Str::isUlid((string) $response->json('data.id')));
        $this->assertDatabaseHas('assets', [
            'school_id' => $school->id,
            'asset_code' => 'AST-000123',
            'version' => 1,
        ]);
        $this->assertDatabaseHas('asset_change_events', [
            'asset_id' => $response->json('data.id'),
            'actor_user_id' => $user->id,
            'actor_membership_id' => $membership->id,
            'event_type' => 'asset.created',
        ]);
    }

    public function test_create_rejects_cross_school_or_inactive_home_laboratory(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.create']);
        $other = Laboratory::factory()->create();
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);

        $this->postJson('/api/v1/assets', $this->validPayload(['homeLaboratoryId' => $other->id]))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->postJson('/api/v1/assets', $this->validPayload(['homeLaboratoryId' => $inactive->id]))
            ->assertUnprocessable();

        $this->assertDatabaseCount('assets', 0);
        $this->assertDatabaseCount('asset_change_events', 0);
    }

    public function test_list_and_show_are_school_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view']);
        $mine = Asset::factory()->for($school)->create(['asset_code' => 'AST-MINE']);
        $other = Asset::factory()->create(['asset_code' => 'AST-OTHER']);

        $this->getJson('/api/v1/assets')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);

        $this->getJson('/api/v1/assets/'.$other->id)
            ->assertNotFound()
            ->assertExactJson(['message' => 'Asset not found.', 'code' => 'ASSET_NOT_FOUND']);
    }

    public function test_patch_requires_exact_permission_if_match_and_current_version(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view']);
        $asset = Asset::factory()->for($school)->create(['name' => 'Before']);

        $this->patchJson('/api/v1/assets/'.$asset->id, ['name' => 'After'], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['assets.update'], $school);
        $this->patchJson('/api/v1/assets/'.$asset->id, ['name' => 'After'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->patchJson('/api/v1/assets/'.$asset->id, ['name' => 'After'], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'ASSET_VERSION_CONFLICT');

        $this->patchJson('/api/v1/assets/'.$asset->id, ['name' => 'After'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.name', 'After')
            ->assertJsonPath('data.version', 2);

        $this->assertDatabaseCount('asset_change_events', 1);
    }

    public function test_asset_code_and_lifecycle_link_fields_cannot_be_patched(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.update']);
        $asset = Asset::factory()->for($school)->create();

        foreach ([
            ['assetCode' => 'NEW-CODE'],
            ['lifecycleStatus' => 'retired'],
            ['linkedDeviceId' => (string) Str::ulid()],
            ['schoolId' => $school->id],
        ] as $payload) {
            $this->patchJson('/api/v1/assets/'.$asset->id, $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->assertDatabaseHas('assets', ['id' => $asset->id, 'version' => 1]);
    }

    public function test_link_device_is_exact_one_to_one_and_audited(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.link-device', 'devices.view']);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['home_laboratory_id' => $lab->id]);
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $lab->id]);

        $this->postJson(
            '/api/v1/assets/'.$asset->id.'/device-link',
            ['deviceId' => $device->id],
            ['If-Match' => '"1"'],
        )
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.linkedDeviceId', $device->id);

        $this->assertDatabaseHas('assets', ['id' => $asset->id, 'linked_device_id' => $device->id, 'version' => 2]);
        $this->assertDatabaseHas('asset_change_events', ['asset_id' => $asset->id, 'event_type' => 'asset.device_linked']);

        $otherAsset = Asset::factory()->for($school)->create();
        $this->postJson(
            '/api/v1/assets/'.$otherAsset->id.'/device-link',
            ['deviceId' => $device->id],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_DEVICE_LINK_CONFLICT');
    }

    public function test_link_device_rejects_cross_school_lab_mismatch_and_decommissioned_device(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.link-device', 'devices.view']);
        $labA = Laboratory::factory()->for($school)->create();
        $labB = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['home_laboratory_id' => $labA->id]);

        $crossSchoolDevice = Device::factory()->create();
        $this->postJson('/api/v1/assets/'.$asset->id.'/device-link', ['deviceId' => $crossSchoolDevice->id], ['If-Match' => '"1"'])
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_DEVICE_NOT_FOUND');

        $mismatch = Device::factory()->for($school)->create(['home_laboratory_id' => $labB->id]);
        $this->postJson('/api/v1/assets/'.$asset->id.'/device-link', ['deviceId' => $mismatch->id], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_DEVICE_LINK_CONFLICT');

        $decommissioned = Device::factory()->for($school)->create(['lifecycle_status' => 'decommissioned']);
        $this->postJson('/api/v1/assets/'.$asset->id.'/device-link', ['deviceId' => $decommissioned->id], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_DEVICE_LINK_CONFLICT');
    }

    public function test_linked_identity_fields_cannot_drift_but_condition_can_change(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.update']);
        $lab = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $lab->id]);
        $asset = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'linked_device_id' => $device->id,
            'brand' => 'Brand A',
        ]);

        $this->patchJson('/api/v1/assets/'.$asset->id, ['brand' => 'Brand B'], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_LINKED_IDENTITY_CHANGE_FORBIDDEN');

        $this->patchJson('/api/v1/assets/'.$asset->id, ['condition' => 'minor_damage'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.condition', 'minor_damage')
            ->assertJsonPath('data.version', 2);
    }

    public function test_unlink_requires_reason_and_preserves_device(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.link-device']);
        $device = Device::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['linked_device_id' => $device->id]);

        $this->postJson('/api/v1/assets/'.$asset->id.'/device-unlink', [], ['If-Match' => '"1"'])
            ->assertUnprocessable();

        $this->postJson('/api/v1/assets/'.$asset->id.'/device-unlink', ['reason' => 'Correction'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.linkedDeviceId', null);

        $this->assertDatabaseHas('devices', ['id' => $device->id]);
        $this->assertDatabaseHas('asset_change_events', ['asset_id' => $asset->id, 'event_type' => 'asset.device_unlinked']);
    }

    public function test_retire_and_dispose_are_action_specific_and_fail_closed_on_linked_device_lifecycle(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.retire', 'assets.dispose']);
        $device = Device::factory()->for($school)->create(['lifecycle_status' => 'in_service']);
        $asset = Asset::factory()->for($school)->create(['linked_device_id' => $device->id]);

        $this->postJson('/api/v1/assets/'.$asset->id.'/retire', ['reason' => 'End of life'], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_DEVICE_LIFECYCLE_CONFLICT');

        $device->update(['lifecycle_status' => 'retired']);
        $this->postJson('/api/v1/assets/'.$asset->id.'/retire', ['reason' => 'End of life'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.lifecycleStatus', 'retired');

        $this->postJson('/api/v1/assets/'.$asset->id.'/dispose', ['reason' => 'Approved disposal'], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_DEVICE_LIFECYCLE_CONFLICT');

        $device->update(['lifecycle_status' => 'decommissioned']);
        $this->postJson('/api/v1/assets/'.$asset->id.'/dispose', ['reason' => 'Approved disposal'], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.lifecycleStatus', 'disposed');
    }

    public function test_database_enforces_asset_code_and_link_uniqueness(): void
    {
        $school = School::factory()->create();
        $device = Device::factory()->for($school)->create();
        Asset::factory()->for($school)->create([
            'asset_code' => 'AST-UNIQUE',
            'linked_device_id' => $device->id,
        ]);

        try {
            Asset::factory()->for($school)->create(['asset_code' => 'AST-UNIQUE']);
            $this->fail('Expected school-scoped Asset code uniqueness violation.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        Asset::factory()->for($school)->create(['linked_device_id' => $device->id]);
    }

    public function test_asset_routes_have_no_hard_delete(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/assets'))
            ->values();

        $this->assertCount(13, $routes);

        [, $school] = $this->authenticateWithPermissions(['assets.update']);
        $asset = Asset::factory()->for($school)->create();
        $this->deleteJson('/api/v1/assets/'.$asset->id)->assertStatus(405);
        $this->assertDatabaseHas('assets', ['id' => $asset->id]);
    }

    /** @param list<string> $permissions @return array{User, School, SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        if ($permissions !== []) {
            $role = Role::factory()->create();
            $permissionIds = collect($permissions)->map(fn (string $key): string => Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key],
            )->id);

            $membership->roles()->attach($role->id);
            $role->permissions()->attach($permissionIds);
        }

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @param array<string, mixed> $overrides @return array<string, mixed> */
    private function validPayload(array $overrides = []): array
    {
        return [
            'assetCode' => 'AST-000123',
            'name' => 'Desktop Lab',
            'category' => 'Komputer',
            ...$overrides,
        ];
    }
}
