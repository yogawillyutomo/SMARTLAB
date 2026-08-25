<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\DeviceChangeEvent;
use App\Models\DeviceTransfer;
use App\Models\Laboratory;
use App\Models\Layout;
use App\Models\LayoutDevicePlacement;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\PermissionSeeder;
use Database\Seeders\RolePermissionSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DeviceTransferApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_transfer_changes_only_home_laboratory_and_writes_snapshot_history_and_one_audit_event(): void
    {
        [$user, $school, $membership] = $this->authenticate(['device-transfers.create', 'device-transfers.view']);
        $source = Laboratory::factory()->for($school)->create(['code' => 'LAB-A', 'name' => 'Source Lab']);
        $destination = Laboratory::factory()->for($school)->create(['code' => 'LAB-B', 'name' => 'Destination Lab']);
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id, 'brand' => 'Original']);

        $response = $this->postJson('/api/v1/devices/'.$device->id.'/transfers', [
            'destinationLaboratoryId' => $destination->id,
            'reason' => '  Relokasi kelas  ',
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.deviceId', $device->id)
            ->assertJsonPath('data.deviceCode', $device->device_code)
            ->assertJsonPath('data.sourceLaboratory.id', $source->id)
            ->assertJsonPath('data.sourceLaboratory.name', 'Source Lab')
            ->assertJsonPath('data.destinationLaboratory.id', $destination->id)
            ->assertJsonPath('data.reason', 'Relokasi kelas')
            ->assertJsonPath('data.actor.id', $user->id)
            ->assertJsonPath('data.deviceVersionBefore', 1)
            ->assertJsonPath('data.deviceVersionAfter', 2);

        $this->assertDatabaseHas('devices', [
            'id' => $device->id,
            'home_laboratory_id' => $destination->id,
            'version' => 2,
            'brand' => 'Original',
        ]);
        $this->assertDatabaseCount('device_transfers', 1);
        $this->assertDatabaseHas('device_transfers', [
            'school_id' => $school->id,
            'device_id' => $device->id,
            'source_laboratory_id' => $source->id,
            'destination_laboratory_id' => $destination->id,
            'device_version_before' => 1,
            'device_version_after' => 2,
        ]);
        $event = DeviceChangeEvent::query()->where('event_type', 'device.transferred')->sole();
        $this->assertSame($membership->id, $event->actor_membership_id);
        $this->assertSame(['homeLaboratoryId'], $event->changed_fields);
        $this->assertSame($response->json('data.id'), $event->changes['transferId']);
    }

    public function test_transfer_requires_exact_create_permission_and_history_requires_exact_view_permission(): void
    {
        [, $school] = $this->authenticate([]);
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);

        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', ['destinationLaboratoryId' => $destination->id], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
        $this->getJson('/api/v1/devices/'.$device->id.'/transfers')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
        $this->assertDatabaseCount('device_transfers', 0);
    }

    public function test_history_view_permission_does_not_require_device_or_laboratory_view_permissions(): void
    {
        $this->authenticate(['device-transfers.view']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);
        DeviceTransfer::query()->create([
            'school_id' => $school->id,
            'device_id' => $device->id,
            'device_id_snapshot' => $device->id,
            'device_code_snapshot' => $device->device_code,
            'source_laboratory_id' => $source->id,
            'source_laboratory_id_snapshot' => $source->id,
            'source_laboratory_code_snapshot' => $source->code,
            'source_laboratory_name_snapshot' => $source->name,
            'destination_laboratory_id' => $destination->id,
            'destination_laboratory_id_snapshot' => $destination->id,
            'destination_laboratory_code_snapshot' => $destination->code,
            'destination_laboratory_name_snapshot' => $destination->name,
            'actor_user_id' => null,
            'actor_user_id_snapshot' => (string) Str::ulid(),
            'actor_name_snapshot' => 'Historical Actor',
            'reason' => null,
            'device_version_before' => 1,
            'device_version_after' => 2,
            'created_at' => now(),
        ]);

        $this->getJson('/api/v1/devices/'.$device->id.'/transfers')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
    }

    public function test_transfer_rejects_unassigned_same_destination_inactive_destination_and_ineligible_lifecycle(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $destination = Laboratory::factory()->for($school)->create();
        $unassigned = Device::factory()->for($school)->create();
        $this->transfer($unassigned, $destination)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_SOURCE_UNASSIGNED');

        $source = Laboratory::factory()->for($school)->create();
        $same = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);
        $this->transfer($same, $source)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_SAME_LABORATORY');

        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $active = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);
        $this->transfer($active, $inactive)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_DESTINATION_INELIGIBLE');

        $retired = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id, 'lifecycle_status' => 'decommissioned']);
        $this->transfer($retired, $destination)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_DEVICE_NOT_ELIGIBLE');
    }

    public function test_active_and_current_draft_layout_references_block_transfer_but_archived_reference_does_not(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);

        $active = Layout::factory()->active()->create(['school_id' => $school->id, 'laboratory_id' => $source->id]);
        $this->place($active, $device);
        $this->transfer($device, $destination)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_ACTIVE_PLACEMENT_EXISTS');

        $active->devicePlacements()->delete();
        $active->delete();
        $draft = Layout::factory()->create(['school_id' => $school->id, 'laboratory_id' => $source->id]);
        $this->place($draft, $device);
        $this->transfer($device, $destination)->assertStatus(409)->assertJsonPath('code', 'TRANSFER_DRAFT_REFERENCE_EXISTS');

        $draft->update(['status' => 'archived', 'activated_at' => now()->subDay(), 'archived_at' => now()]);
        $this->transfer($device, $destination)->assertCreated();
        $this->assertDatabaseHas('layout_device_placements', [
            'layout_id' => $draft->id,
            'device_id' => $device->id,
        ]);
    }

    public function test_stale_version_is_rejected_before_transfer_invariants_and_does_not_mutate(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id, 'version' => 3]);

        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', ['destinationLaboratoryId' => (string) Str::ulid()], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'DEVICE_VERSION_CONFLICT');
        $this->assertDatabaseCount('device_transfers', 0);
        $this->assertDatabaseHas('devices', ['id' => $device->id, 'home_laboratory_id' => $source->id, 'version' => 3]);

        $unassigned = Device::factory()->for($school)->create(['home_laboratory_id' => null, 'version' => 3]);
        $this->postJson('/api/v1/devices/'.$unassigned->id.'/transfers', ['destinationLaboratoryId' => (string) Str::ulid()], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'DEVICE_VERSION_CONFLICT');
    }

    public function test_history_is_snapshot_based_deterministic_and_tenant_scoped(): void
    {
        $this->authenticate(['device-transfers.create', 'device-transfers.view']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create(['name' => 'Old Source']);
        $destination = Laboratory::factory()->for($school)->create(['name' => 'Old Destination']);
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);
        $this->transfer($device, $destination)->assertCreated();
        $source->update(['name' => 'Changed Source']);
        $destination->update(['name' => 'Changed Destination']);

        $this->getJson('/api/v1/devices/'.$device->id.'/transfers?perPage=1')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.sourceLaboratory.name', 'Old Source')
            ->assertJsonPath('data.0.destinationLaboratory.name', 'Old Destination');
    }

    public function test_reason_omitted_and_blank_are_null_and_overlong_reason_is_rejected(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $firstDestination = Laboratory::factory()->for($school)->create();
        $secondDestination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);

        $this->transfer($device, $firstDestination)
            ->assertCreated()
            ->assertJsonPath('data.reason', null);
        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', [
            'destinationLaboratoryId' => $secondDestination->id,
            'reason' => '   ',
        ], ['If-Match' => '"2"'])
            ->assertCreated()
            ->assertJsonPath('data.reason', null);

        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', [
            'destinationLaboratoryId' => $firstDestination->id,
            'reason' => str_repeat('x', 501),
        ], ['If-Match' => '"3"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('reason');
        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 3, 'home_laboratory_id' => $secondDestination->id]);
    }

    public function test_inactive_source_to_active_destination_is_allowed_and_spare_and_retired_lifecycles_are_preserved(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $inactiveSource = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $destination = Laboratory::factory()->for($school)->create(['status' => 'active']);

        foreach (['spare', 'retired'] as $lifecycle) {
            $device = Device::factory()->for($school)->create([
                'home_laboratory_id' => $inactiveSource->id,
                'lifecycle_status' => $lifecycle,
            ]);
            $this->transfer($device, $destination)->assertCreated();
            $this->assertDatabaseHas('devices', [
                'id' => $device->id,
                'home_laboratory_id' => $destination->id,
                'lifecycle_status' => $lifecycle,
                'version' => 2,
            ]);
        }
    }

    public function test_retired_devices_are_not_unplaced_layout_candidates_after_transfer(): void
    {
        $this->authenticate(['device-transfers.create', 'devices.view', 'layouts.view']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $layout = Layout::factory()->create(['school_id' => $school->id, 'laboratory_id' => $destination->id]);
        $spare = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id, 'lifecycle_status' => 'spare']);
        $retired = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id, 'lifecycle_status' => 'retired']);
        $this->transfer($spare, $destination)->assertCreated();
        $this->transfer($retired, $destination)->assertCreated();

        $response = $this->getJson('/api/v1/layouts/'.$layout->id.'/unplaced-devices')->assertOk();
        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($spare->id, $ids);
        $this->assertNotContains($retired->id, $ids);
    }

    public function test_manual_replay_with_old_if_match_is_stale_and_does_not_duplicate_history(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);
        $payload = ['destinationLaboratoryId' => $destination->id];

        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', $payload, ['If-Match' => '"1"'])->assertCreated();
        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', $payload, ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'DEVICE_VERSION_CONFLICT');
        $this->assertDatabaseCount('device_transfers', 1);
        $this->assertDatabaseCount('device_change_events', 1);
    }

    public function test_seeded_roles_receive_only_the_locked_transfer_permissions(): void
    {
        $this->seed([RoleSeeder::class, PermissionSeeder::class, RolePermissionSeeder::class]);

        $expected = [
            'admin-lab' => ['device-transfers.create', 'device-transfers.view'],
            'kepala-lab' => ['device-transfers.view'],
            'teknisi' => ['device-transfers.view'],
            'pimpinan' => ['device-transfers.view'],
            'guru' => [],
            'ketua-kelas' => [],
            'siswa' => [],
        ];
        foreach ($expected as $roleKey => $transferPermissions) {
            $role = Role::query()->where('key', $roleKey)->firstOrFail();
            $actual = $role->permissions->pluck('key')->filter(fn (string $key): bool => str_starts_with($key, 'device-transfers.'))->values()->all();
            sort($actual);
            $expectedPermissions = $transferPermissions;
            sort($expectedPermissions);
            $this->assertSame($expectedPermissions, $actual, $roleKey);
        }

        $superAdmin = Role::query()->where('key', 'super-admin')->firstOrFail();
        $this->assertTrue($superAdmin->permissions->contains('key', 'device-transfers.create'));
        $this->assertTrue($superAdmin->permissions->contains('key', 'device-transfers.view'));
        $this->assertFalse(Role::query()->where('key', 'teknisi')->firstOrFail()->permissions->contains('key', 'device-transfers.create'));
    }

    public function test_unknown_payload_fields_and_malformed_precondition_are_rejected_without_mutation(): void
    {
        $this->authenticate(['device-transfers.create']);
        $school = School::query()->latest('created_at')->firstOrFail();
        $source = Laboratory::factory()->for($school)->create();
        $destination = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $source->id]);

        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', [
            'destinationLaboratoryId' => $destination->id,
            'schoolId' => $school->id,
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('schoolId');
        $this->postJson('/api/v1/devices/'.$device->id.'/transfers', ['destinationLaboratoryId' => $destination->id])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');
        $this->assertDatabaseCount('device_transfers', 0);
    }

    public function test_cross_school_device_and_destination_are_indistinguishable_from_missing(): void
    {
        [, $school] = $this->authenticate(['device-transfers.create', 'device-transfers.view']);
        $foreignSchool = School::factory()->create();
        $foreignSource = Laboratory::factory()->for($foreignSchool)->create();
        $foreignDestination = Laboratory::factory()->for($foreignSchool)->create();
        $foreignDevice = Device::factory()->for($foreignSchool)->create(['home_laboratory_id' => $foreignSource->id]);
        $localSource = Laboratory::factory()->for($school)->create();
        $localDevice = Device::factory()->for($school)->create(['home_laboratory_id' => $localSource->id]);

        $this->getJson('/api/v1/devices/'.$foreignDevice->id.'/transfers')
            ->assertNotFound()
            ->assertJsonPath('code', 'DEVICE_NOT_FOUND');
        $this->postJson('/api/v1/devices/'.$localDevice->id.'/transfers', [
            'destinationLaboratoryId' => $foreignDestination->id,
        ], ['If-Match' => '"1"'])
            ->assertNotFound()
            ->assertJsonPath('code', 'LABORATORY_NOT_FOUND');
    }

    private function transfer(Device $device, Laboratory $destination): TestResponse
    {
        return $this->postJson('/api/v1/devices/'.$device->id.'/transfers', [
            'destinationLaboratoryId' => $destination->id,
        ], ['If-Match' => '"'.$device->fresh()->version.'"']);
    }

    private function place(Layout $layout, Device $device): LayoutDevicePlacement
    {
        return LayoutDevicePlacement::query()->create([
            'school_id' => $layout->school_id,
            'layout_id' => $layout->id,
            'device_id' => $device->id,
            'role' => 'student_station',
            'label' => null,
            'row' => 1,
            'column' => 1,
            'row_span' => 1,
            'column_span' => 1,
            'rotation' => 0,
        ]);
    }

    /** @param list<string> $permissions @return array{User, School, SchoolMembership} */
    private function authenticate(array $permissions): array
    {
        $user = User::factory()->create(['name' => 'Transfer Actor']);
        $school = School::factory()->create();
        $membership = SchoolMembership::factory()->create(['school_id' => $school->id, 'user_id' => $user->id, 'status' => 'active']);
        if ($permissions !== []) {
            $role = Role::factory()->create();
            $ids = collect($permissions)->map(fn (string $key): string => Permission::query()->firstOrCreate(['key' => $key], ['name' => $key])->id);
            $membership->roles()->attach($role->id);
            $role->permissions()->attach($ids);
        }
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }
}
