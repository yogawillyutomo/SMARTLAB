<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\DeviceAgentEnrollment;
use App\Models\DeviceAgentInstallation;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\PermissionSeeder;
use Database\Seeders\RolePermissionSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class DeviceAgentIdentityApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_authorized_operator_creates_single_use_hashed_enrollment_for_exact_device(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage-agent']);
        $device = Device::factory()->for($school)->create();

        $response = $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')
            ->assertCreated()
            ->assertJsonPath('data.deviceId', $device->id)
            ->assertJsonPath('data.status', 'pending');

        $code = (string) $response->json('data.enrollmentCode');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', $code);

        $enrollment = DeviceAgentEnrollment::query()->firstOrFail();
        $this->assertSame(hash('sha256', $code), $enrollment->getRawOriginal('code_hash'));
        $this->assertNotSame($code, $enrollment->getRawOriginal('code_hash'));
        $this->assertSame($school->id, $enrollment->school_id);
    }

    public function test_human_enrollment_requires_permission_and_same_school_eligible_device(): void
    {
        [, $school] = $this->authenticateWithPermissions([]);
        $device = Device::factory()->for($school)->create();
        $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->assertForbidden();

        $this->authenticateWithPermissions(['devices.manage-agent'], $school);
        $otherDevice = Device::factory()->create();
        $this->postJson('/api/v1/devices/'.$otherDevice->id.'/agent-enrollments')
            ->assertNotFound()
            ->assertJsonPath('code', 'DEVICE_NOT_FOUND');

        $printer = Device::factory()->for($school)->create(['device_type' => 'printer']);
        $this->postJson('/api/v1/devices/'.$printer->id.'/agent-enrollments')
            ->assertStatus(409)
            ->assertJsonPath('code', 'DEVICE_AGENT_DEVICE_INELIGIBLE');

        $retired = Device::factory()->for($school)->create(['lifecycle_status' => 'retired']);
        $this->postJson('/api/v1/devices/'.$retired->id.'/agent-enrollments')
            ->assertStatus(409)
            ->assertJsonPath('code', 'DEVICE_AGENT_DEVICE_INELIGIBLE');
    }

    public function test_enrollment_redeems_once_and_machine_config_requires_the_returned_secret(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage-agent']);
        $device = Device::factory()->for($school)->create();
        $code = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');

        $redeemed = $this->postJson('/api/v1/pc-agent/v1/enroll', [
            'enrollmentCode' => $code,
            'agentVersion' => '0.1.0',
        ])->assertCreated()->assertJsonPath('data.deviceId', $device->id);

        $credential = (string) $redeemed->json('data.credential');
        [$credentialId, $secret] = explode('.', $credential, 2);
        $installation = DeviceAgentInstallation::query()->firstOrFail();
        $this->assertSame($credentialId, $installation->credential_id);
        $this->assertSame(hash('sha256', $secret), $installation->getRawOriginal('credential_secret_hash'));
        $this->assertNotSame($secret, $installation->getRawOriginal('credential_secret_hash'));

        $this->postJson('/api/v1/pc-agent/v1/enroll', [
            'enrollmentCode' => $code,
            'agentVersion' => '0.1.0',
        ])->assertUnauthorized()->assertJsonPath('code', 'DEVICE_AGENT_ENROLLMENT_INVALID');

        $this->withHeader('Authorization', 'Bearer '.$credential)
            ->getJson('/api/v1/pc-agent/v1/config')
            ->assertOk()
            ->assertJsonPath('data.installationId', $installation->id)
            ->assertJsonPath('data.policy.heartbeatIntervalSeconds', 60);

        $this->withoutHeader('Authorization')
            ->getJson('/api/v1/pc-agent/v1/config')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'DEVICE_AGENT_UNAUTHENTICATED');
        $this->withHeader('Authorization', 'Bearer '.$credentialId.'.'.str_repeat('A', 43))
            ->getJson('/api/v1/pc-agent/v1/config')
            ->assertUnauthorized();
    }

    public function test_expired_and_unexpected_enrollment_payloads_fail_closed(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage-agent']);
        $device = Device::factory()->for($school)->create();
        $code = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');
        DeviceAgentEnrollment::query()->firstOrFail()->update(['expires_at' => now()->subMinute()]);

        $this->postJson('/api/v1/pc-agent/v1/enroll', [
            'enrollmentCode' => $code,
            'agentVersion' => '0.1.0',
        ])->assertUnauthorized()->assertJsonPath('code', 'DEVICE_AGENT_ENROLLMENT_INVALID');
        $this->assertDatabaseHas('device_agent_enrollments', ['status' => 'expired']);

        $freshCode = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');
        $this->postJson('/api/v1/pc-agent/v1/enroll', [
            'enrollmentCode' => $freshCode,
            'agentVersion' => '0.1.0',
            'unexpected' => 'blocked',
        ])->assertUnprocessable()->assertJsonPath('code', 'DEVICE_AGENT_PAYLOAD_INVALID');
    }

    public function test_human_revocation_immediately_invalidates_machine_credential(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage-agent']);
        $device = Device::factory()->for($school)->create();
        $code = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');
        $redeemed = $this->postJson('/api/v1/pc-agent/v1/enroll', ['enrollmentCode' => $code, 'agentVersion' => '0.1.0']);
        $credential = (string) $redeemed->json('data.credential');
        $installationId = (string) $redeemed->json('data.installationId');

        $this->postJson('/api/v1/device-agent-installations/'.$installationId.'/revoke', ['reason' => 'Device dipensiunkan dari agent.'])
            ->assertOk()
            ->assertJsonPath('data.status', 'revoked');

        $this->withHeader('Authorization', 'Bearer '.$credential)
            ->getJson('/api/v1/pc-agent/v1/config')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'DEVICE_AGENT_UNAUTHENTICATED');
    }

    public function test_redeeming_new_enrollment_replaces_active_installation_and_preserves_history(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage-agent']);
        $device = Device::factory()->for($school)->create();

        $firstCode = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');
        $first = $this->postJson('/api/v1/pc-agent/v1/enroll', ['enrollmentCode' => $firstCode, 'agentVersion' => '0.1.0']);
        $firstCredential = (string) $first->json('data.credential');

        $secondCode = (string) $this->postJson('/api/v1/devices/'.$device->id.'/agent-enrollments')->json('data.enrollmentCode');
        $second = $this->postJson('/api/v1/pc-agent/v1/enroll', ['enrollmentCode' => $secondCode, 'agentVersion' => '0.2.0']);
        $secondCredential = (string) $second->json('data.credential');

        $this->assertSame(2, DeviceAgentInstallation::query()->count());
        $this->assertSame(1, DeviceAgentInstallation::query()->where('status', 'active')->count());
        $this->assertSame(1, DeviceAgentInstallation::query()->where('status', 'revoked')->count());

        $this->withHeader('Authorization', 'Bearer '.$firstCredential)->getJson('/api/v1/pc-agent/v1/config')->assertUnauthorized();
        $this->withHeader('Authorization', 'Bearer '.$secondCredential)->getJson('/api/v1/pc-agent/v1/config')->assertOk();

        $this->getJson('/api/v1/devices/'.$device->id.'/agent-installations')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonMissingPath('data.0.credentialSecretHash');
    }

    public function test_permission_seed_baseline_is_least_privilege(): void
    {
        $this->seed([PermissionSeeder::class, RoleSeeder::class, RolePermissionSeeder::class]);

        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $head = Role::query()->where('key', 'kepala-lab')->firstOrFail();
        $technician = Role::query()->where('key', 'teknisi')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();

        $this->assertTrue($admin->permissions()->where('key', 'devices.manage-agent')->exists());
        $this->assertTrue($admin->permissions()->where('key', 'telemetry.view')->exists());
        $this->assertFalse($head->permissions()->where('key', 'devices.manage-agent')->exists());
        $this->assertTrue($head->permissions()->where('key', 'telemetry.view')->exists());
        $this->assertTrue($technician->permissions()->where('key', 'devices.manage-agent')->exists());
        $this->assertTrue($technician->permissions()->where('key', 'telemetry.view')->exists());
        $this->assertFalse($teacher->permissions()->where('key', 'devices.manage-agent')->exists());
        $this->assertFalse($teacher->permissions()->where('key', 'telemetry.view')->exists());
    }

    /** @param list<string> $permissions @return array{User,School,SchoolMembership} */
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
}
