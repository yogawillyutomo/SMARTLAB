<?php

namespace Tests\Feature;

use App\Application\Device\DeviceMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Models\Device;
use App\Models\DeviceChangeEvent;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DeviceApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_rejected(): void
    {
        $this->getJson('/api/v1/devices')
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);
    }

    public function test_no_active_membership_returns_the_existing_context_error(): void
    {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/devices')
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

        $this->getJson('/api/v1/devices')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => 'A school context must be selected before this request can continue.',
                'code' => 'SCHOOL_CONTEXT_REQUIRED',
            ]);
    }

    public function test_patch_auth_context_permission_and_precondition_middleware_precedence(): void
    {
        $deviceId = (string) Str::ulid();

        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'])
            ->assertUnauthorized()
            ->assertExactJson([
                'message' => 'Authentication is required.',
                'code' => 'UNAUTHENTICATED',
            ]);

        $noMembership = User::factory()->create();
        Sanctum::actingAs($noMembership);
        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');

        $ambiguousUser = User::factory()->create();
        $this->activeMembership($ambiguousUser, School::factory()->create());
        $this->activeMembership($ambiguousUser, School::factory()->create());
        Sanctum::actingAs($ambiguousUser);
        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'SCHOOL_CONTEXT_REQUIRED');

        $unauthorizedUser = User::factory()->create();
        $this->activeMembership($unauthorizedUser, School::factory()->create());
        Sanctum::actingAs($unauthorizedUser);
        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['devices.update']);
        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->assertDatabaseCount('device_change_events', 0);
    }

    #[DataProvider('endpointPermissionProvider')]
    public function test_each_endpoint_requires_its_exact_permission(string $method, string $uri, string $permission): void
    {
        [, $school] = $this->authenticateWithPermissions([]);
        $device = Device::factory()->for($school)->create();
        $uri = str_replace('{deviceId}', $device->id, $uri);
        $payload = $method === 'POST' ? $this->validPayload() : ['brand' => 'Updated'];
        $headers = $method === 'PATCH' ? ['If-Match' => '"1"'] : [];

        $this->json($method, $uri, $payload, $headers)
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);

        $this->assertDatabaseMissing('devices', ['device_code' => 'DEV-000123']);
        $this->assertDatabaseHas('devices', ['id' => $device->id, 'brand' => $device->brand]);
        $this->assertContains($permission, ['devices.view', 'devices.create', 'devices.update']);
    }

    #[DataProvider('endpointPermissionProvider')]
    public function test_devices_manage_is_not_a_wildcard(string $method, string $uri, string $_permission): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.manage']);
        $device = Device::factory()->for($school)->create();
        $uri = str_replace('{deviceId}', $device->id, $uri);
        $payload = $method === 'POST' ? $this->validPayload() : ['brand' => 'Updated'];
        $headers = $method === 'PATCH' ? ['If-Match' => '"1"'] : [];

        $this->json($method, $uri, $payload, $headers)
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_create_derives_school_defaults_fields_generates_id_and_qr_and_writes_history(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['devices.create']);

        $response = $this->postJson('/api/v1/devices', $this->validPayload())
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.deviceCode', 'DEV-000123')
            ->assertJsonPath('data.lifecycleStatus', 'in_service')
            ->assertJsonPath('data.homeLaboratoryId', null)
            ->assertJsonPath('data.technicalProfileVersion', 1)
            ->assertJsonPath('data.technicalProfile', [])
            ->assertJsonPath('data.version', 1);

        $data = $response->json('data');
        $this->assertTrue(Str::isUlid($data['id']));
        $this->assertMatchesRegularExpression('/^devq_[A-Za-z0-9_-]{22}$/', $data['qrPublicId']);
        foreach (['homeLaboratoryId', 'serialNumber', 'hostname', 'brand', 'model'] as $nullableField) {
            $this->assertArrayHasKey($nullableField, $data);
            $this->assertNull($data[$nullableField]);
        }

        $this->assertDatabaseHas('devices', [
            'id' => $data['id'],
            'school_id' => $school->id,
            'device_code' => 'DEV-000123',
            'technical_profile_version' => 1,
            'version' => 1,
        ]);
        $this->assertDatabaseHas('device_change_events', [
            'school_id' => $school->id,
            'device_id' => $data['id'],
            'actor_user_id' => $user->id,
            'actor_membership_id' => $membership->id,
            'event_type' => 'device.created',
        ]);
    }

    public function test_empty_and_populated_technical_profiles_emit_raw_json_objects(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.create', 'devices.view', 'devices.update']);

        $create = $this->postJson('/api/v1/devices', $this->validPayload())->assertCreated();
        $this->assertRawTechnicalProfileObject($create, []);
        $deviceId = $create->json('data.id');

        $show = $this->getJson('/api/v1/devices/'.$deviceId)->assertOk();
        $this->assertRawTechnicalProfileObject($show, []);

        $patch = $this->patchJson(
            '/api/v1/devices/'.$deviceId,
            ['technicalProfile' => (object) []],
            ['If-Match' => '"1"'],
        )->assertOk();
        $this->assertRawTechnicalProfileObject($patch, []);

        $populated = $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceCode' => 'DEV-OBJECT',
            'technicalProfile' => ['processor' => 'Example CPU', 'ramGB' => 16],
        ]))->assertCreated();
        $this->assertRawTechnicalProfileObject($populated, ['processor' => 'Example CPU', 'ramGB' => 16]);

        $this->assertDatabaseHas('devices', ['school_id' => $school->id, 'device_code' => 'DEV-OBJECT']);
    }

    public function test_create_service_revalidates_home_laboratory_inside_its_transaction(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['devices.create']);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $context = new CurrentMembershipContext($membership, collect(['devices.create']));

        try {
            app(DeviceMutationService::class)->create($context, $this->validPayload([
                'homeLaboratoryId' => $inactive->id,
            ]));
            $this->fail('Expected transaction-level home Laboratory validation failure.');
        } catch (ValidationException $exception) {
            $this->assertSame(
                ['The selected home laboratory is invalid.'],
                $exception->errors()['homeLaboratoryId'],
            );
        }

        $this->assertDatabaseCount('devices', 0);
        $this->assertDatabaseCount('device_change_events', 0);
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_device_code_is_trimmed_uppercased_and_unique_inside_school(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.create']);

        $this->postJson('/api/v1/devices', $this->validPayload(['deviceCode' => '  pc-000123  ']))
            ->assertCreated()
            ->assertJsonPath('data.deviceCode', 'PC-000123');

        $this->postJson('/api/v1/devices', $this->validPayload(['deviceCode' => 'pc-000123']))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors('deviceCode');

        $this->assertDatabaseCount('devices', 1);
        $this->assertDatabaseHas('devices', ['school_id' => $school->id, 'device_code' => 'PC-000123']);
    }

    public function test_same_canonical_device_code_is_allowed_in_another_school(): void
    {
        Device::factory()->create(['device_code' => 'DEV-000123']);
        [, $school] = $this->authenticateWithPermissions(['devices.create']);

        $this->postJson('/api/v1/devices', $this->validPayload())
            ->assertCreated();

        $this->assertDatabaseHas('devices', ['school_id' => $school->id, 'device_code' => 'DEV-000123']);
        $this->assertDatabaseCount('devices', 2);
    }

    public function test_create_validates_device_code_pattern_length_and_required_type(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        foreach (['A', '-INVALID', 'HAS SPACE', str_repeat('A', 33), 'DEV_001', 'équipement'] as $invalidCode) {
            $this->postJson('/api/v1/devices', $this->validPayload(['deviceCode' => $invalidCode]))
                ->assertUnprocessable()
                ->assertJsonValidationErrors('deviceCode');
        }

        $this->postJson('/api/v1/devices', [])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['deviceCode', 'deviceType']);
    }

    public function test_create_payload_is_closed_and_rejects_server_owned_and_legacy_fields(): void
    {
        $this->authenticateWithPermissions(['devices.create']);
        $payload = [
            ...$this->validPayload(),
            'id' => (string) Str::ulid(),
            'school_id' => (string) Str::ulid(),
            'schoolId' => (string) Str::ulid(),
            'qr_public_id' => 'devq_client',
            'qrPublicId' => 'devq_client',
            'technical_profile_version' => 9,
            'technicalProfileVersion' => 9,
            'version' => 9,
            'createdAt' => now()->toISOString(),
            'assetId' => 'local-asset',
            'laboratoryId' => 'local-lab',
            'ipAddress' => '127.0.0.1',
            'status' => 'Online',
            'unknown' => true,
        ];

        $this->postJson('/api/v1/devices', $payload)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors([
                'id', 'school_id', 'schoolId', 'qr_public_id', 'qrPublicId',
                'technical_profile_version', 'technicalProfileVersion', 'version',
                'createdAt', 'assetId', 'laboratoryId', 'ipAddress', 'status', 'unknown',
            ]);

        $this->assertDatabaseCount('devices', 0);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_create_accepts_only_active_or_spare_lifecycle(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        $this->postJson('/api/v1/devices', $this->validPayload(['lifecycleStatus' => 'spare']))
            ->assertCreated()
            ->assertJsonPath('data.lifecycleStatus', 'spare');

        foreach (['retired', 'decommissioned', 'maintenance', 'online'] as $invalidLifecycle) {
            $this->postJson('/api/v1/devices', $this->validPayload([
                'deviceCode' => 'DEV-'.strtoupper(substr($invalidLifecycle, 0, 8)),
                'lifecycleStatus' => $invalidLifecycle,
            ]))->assertUnprocessable()->assertJsonValidationErrors('lifecycleStatus');
        }
    }

    public function test_all_ten_device_types_and_representative_profiles_are_accepted(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        foreach ($this->representativeProfiles() as $index => $case) {
            $this->postJson('/api/v1/devices', $this->validPayload([
                'deviceCode' => 'DEV-'.str_pad((string) ($index + 1), 6, '0', STR_PAD_LEFT),
                'deviceType' => $case['type'],
                'technicalProfile' => $case['profile'],
            ]))
                ->assertCreated()
                ->assertJsonPath('data.deviceType', $case['type'])
                ->assertJsonPath('data.technicalProfile', $case['profile']);
        }

        $this->assertDatabaseCount('devices', 10);
    }

    public function test_invalid_device_type_and_type_profile_mismatch_are_rejected(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        $this->postJson('/api/v1/devices', $this->validPayload(['deviceType' => 'phone']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('deviceType');

        $this->postJson('/api/v1/devices', $this->validPayload([
            'technicalProfile' => ['portCount' => 24],
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('technicalProfile.portCount');
    }

    public function test_profile_rejects_frontend_discriminator_embedded_version_runtime_and_invalid_json_types(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        foreach ([
            ['kind' => 'desktop_pc'],
            ['schemaVersion' => 1],
            ['cpuUsage' => 50],
            ['ramGB' => '16'],
        ] as $profile) {
            $this->postJson('/api/v1/devices', $this->validPayload(['technicalProfile' => $profile]))
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->postJson('/api/v1/devices', $this->validPayload(['technicalProfile' => []]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('technicalProfile');
    }

    public function test_other_profile_limits_are_enforced_through_http(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        $valid = [];
        for ($index = 1; $index <= 32; $index++) {
            $valid['property_'.$index] = $index;
        }

        $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceType' => 'other',
            'technicalProfile' => $valid,
        ]))->assertCreated();

        foreach ([
            [...$valid, 'property_33' => 33],
            ['1invalid' => true],
            ['nested' => ['value' => true]],
            ['items' => ['one']],
            ['notes' => str_repeat('x', 501)],
        ] as $index => $invalidProfile) {
            $this->postJson('/api/v1/devices', $this->validPayload([
                'deviceCode' => 'OTHER-'.str_pad((string) $index, 3, '0', STR_PAD_LEFT),
                'deviceType' => 'other',
                'technicalProfile' => $invalidProfile,
            ]))->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        }
    }

    public function test_create_home_laboratory_rules_are_tenant_scoped_and_require_active_laboratory(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.create']);
        $active = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $other = Laboratory::factory()->create(['status' => 'active']);

        $this->postJson('/api/v1/devices', $this->validPayload(['homeLaboratoryId' => $active->id]))
            ->assertCreated()
            ->assertJsonPath('data.homeLaboratoryId', $active->id);

        $unknownResponse = $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceCode' => 'DEV-UNKNOWN',
            'homeLaboratoryId' => (string) Str::ulid(),
        ]))->assertUnprocessable()->assertJsonValidationErrors('homeLaboratoryId');

        $crossTenantResponse = $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceCode' => 'DEV-CROSS',
            'homeLaboratoryId' => $other->id,
        ]))->assertUnprocessable()->assertJsonValidationErrors('homeLaboratoryId');

        $this->assertSame($unknownResponse->json('errors.homeLaboratoryId'), $crossTenantResponse->json('errors.homeLaboratoryId'));

        $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceCode' => 'DEV-INACTIVE',
            'homeLaboratoryId' => $inactive->id,
        ]))->assertUnprocessable()->assertJsonValidationErrors('homeLaboratoryId');
    }

    public function test_create_with_omitted_or_explicit_null_home_laboratory_is_allowed(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        $this->postJson('/api/v1/devices', $this->validPayload())
            ->assertCreated()
            ->assertJsonPath('data.homeLaboratoryId', null);
        $this->postJson('/api/v1/devices', $this->validPayload([
            'deviceCode' => 'DEV-000124',
            'homeLaboratoryId' => null,
        ]))->assertCreated()->assertJsonPath('data.homeLaboratoryId', null);
    }

    public function test_two_devices_receive_distinct_server_generated_qr_public_ids(): void
    {
        $this->authenticateWithPermissions(['devices.create']);

        $first = $this->postJson('/api/v1/devices', $this->validPayload())->assertCreated()->json('data.qrPublicId');
        $second = $this->postJson('/api/v1/devices', $this->validPayload(['deviceCode' => 'DEV-000124']))->assertCreated()->json('data.qrPublicId');

        $this->assertNotSame($first, $second);
        $this->assertDatabaseCount('devices', 2);
    }

    public function test_list_is_paginated_deterministic_and_tenant_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        Device::factory()->for($school)->create(['device_code' => 'DEV-B']);
        $firstA = Device::factory()->for($school)->create(['device_code' => 'DEV-A']);
        $secondA = Device::factory()->for($school)->create(['device_code' => 'DEV-A2']);
        Device::factory()->create(['device_code' => 'OTHER-SCHOOL']);

        $response = $this->getJson('/api/v1/devices')
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.id', $firstA->id)
            ->assertJsonPath('data.1.id', $secondA->id)
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('meta.perPage', 25)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.lastPage', 1);

        $this->assertSame(['data', 'meta'], array_keys($response->json()));
        $this->assertSame(['page', 'perPage', 'total', 'lastPage'], array_keys($response->json('meta')));
    }

    public function test_list_supports_custom_pagination_and_rejects_invalid_values(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        Device::factory()->count(3)->for($school)->create();

        $this->getJson('/api/v1/devices?page=2&perPage=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.page', 2)
            ->assertJsonPath('meta.perPage', 2)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.lastPage', 2);

        foreach (['page=0', 'page=x', 'perPage=0', 'perPage=101', 'perPage=1.5'] as $query) {
            $this->getJson('/api/v1/devices?'.$query)
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }
    }

    public function test_list_filters_by_laboratory_type_lifecycle_and_allows_inactive_home_laboratory(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        $inactiveLab = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $match = Device::factory()->for($school)->create([
            'home_laboratory_id' => $inactiveLab->id,
            'device_type' => 'router',
            'lifecycle_status' => 'retired',
        ]);
        Device::factory()->for($school)->create(['device_type' => 'desktop_pc']);

        $this->getJson('/api/v1/devices?homeLaboratoryId='.$inactiveLab->id.'&deviceType=router&lifecycleStatus=retired')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $match->id);
    }

    public function test_list_home_filter_unknown_and_cross_tenant_are_indistinguishable(): void
    {
        $this->authenticateWithPermissions(['devices.view']);
        $other = Laboratory::factory()->create();

        $unknownResponse = $this->getJson('/api/v1/devices?homeLaboratoryId='.Str::ulid())
            ->assertUnprocessable()
            ->assertJsonValidationErrors('homeLaboratoryId');
        $crossResponse = $this->getJson('/api/v1/devices?homeLaboratoryId='.$other->id)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('homeLaboratoryId');

        $this->assertSame($unknownResponse->json('errors.homeLaboratoryId'), $crossResponse->json('errors.homeLaboratoryId'));
    }

    public function test_list_search_is_bounded_case_insensitive_and_does_not_search_profile_json(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        $hostnameMatch = Device::factory()->for($school)->create(['hostname' => 'LAB-COMPUTER']);
        Device::factory()->for($school)->create(['technical_profile' => ['processor' => 'LAB-COMPUTER']]);

        $this->getJson('/api/v1/devices?search=computer')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $hostnameMatch->id);

        foreach (['search=', 'search='.str_repeat('x', 101)] as $query) {
            $this->getJson('/api/v1/devices?'.$query)
                ->assertUnprocessable()
                ->assertJsonValidationErrors('search');
        }
    }

    public function test_list_search_treats_sql_wildcards_and_escape_character_as_literals(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        $percent = Device::factory()->for($school)->create(['brand' => 'Efficiency 100%']);
        $underscore = Device::factory()->for($school)->create(['hostname' => 'LAB_UNIT']);
        $backslash = Device::factory()->for($school)->create(['model' => 'Path\\Server']);
        Device::factory()->for($school)->create(['brand' => 'Ordinary match']);

        foreach ([
            '%' => $percent->id,
            '_' => $underscore->id,
            '\\' => $backslash->id,
        ] as $search => $expectedId) {
            $response = $this->getJson('/api/v1/devices?'.http_build_query(['search' => $search]))
                ->assertOk()
                ->assertJsonCount(1, 'data');
            $this->assertSame($expectedId, $response->json('data.0.id'));
        }
    }

    public function test_list_rejects_unknown_query_parameters_and_array_filters(): void
    {
        $this->authenticateWithPermissions(['devices.view']);

        $this->getJson('/api/v1/devices?sort=-createdAt')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('sort');
        $this->getJson('/api/v1/devices?deviceType[]=router')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('deviceType');
    }

    public function test_show_returns_exact_stable_dto_and_matching_etag(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.view']);
        $device = Device::factory()->for($school)->create([
            'device_code' => 'DEV-SHOW',
            'device_type' => 'router',
            'lifecycle_status' => 'spare',
            'home_laboratory_id' => null,
            'serial_number' => null,
            'hostname' => null,
            'brand' => null,
            'model' => null,
            'technical_profile_version' => 1,
            'technical_profile' => [],
            'version' => 7,
        ]);

        $this->getJson('/api/v1/devices/'.$device->id)
            ->assertOk()
            ->assertHeader('ETag', '"7"')
            ->assertExactJson([
                'data' => [
                    'id' => $device->id,
                    'schoolId' => $school->id,
                    'deviceCode' => 'DEV-SHOW',
                    'qrPublicId' => $device->qr_public_id,
                    'deviceType' => 'router',
                    'lifecycleStatus' => 'spare',
                    'homeLaboratoryId' => null,
                    'serialNumber' => null,
                    'hostname' => null,
                    'brand' => null,
                    'model' => null,
                    'technicalProfileVersion' => 1,
                    'technicalProfile' => [],
                    'version' => 7,
                    'createdAt' => $device->created_at->toISOString(),
                    'updatedAt' => $device->updated_at->toISOString(),
                ],
            ]);
    }

    public function test_show_unknown_and_cross_tenant_are_identical(): void
    {
        $this->authenticateWithPermissions(['devices.view']);
        $other = Device::factory()->create();
        $expected = ['message' => 'Device not found.', 'code' => 'DEVICE_NOT_FOUND'];

        $this->getJson('/api/v1/devices/'.$other->id)->assertNotFound()->assertExactJson($expected);
        $this->getJson('/api/v1/devices/'.Str::ulid())->assertNotFound()->assertExactJson($expected);
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_patch_requires_exact_strong_if_match(?string $ifMatch): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create();
        $headers = $ifMatch === null ? [] : ['If-Match' => $ifMatch];

        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'Updated'], $headers)
            ->assertStatus(428)
            ->assertExactJson([
                'message' => 'A valid If-Match Device version is required.',
                'code' => 'PRECONDITION_REQUIRED',
            ]);

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 1]);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_patch_with_stale_version_returns_412_without_mutation(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create(['brand' => 'Original', 'version' => 2]);

        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'Changed'], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertExactJson([
                'message' => 'Device has changed since it was loaded.',
                'code' => 'DEVICE_VERSION_CONFLICT',
            ]);

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'brand' => 'Original', 'version' => 2]);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_patch_updates_multiple_fields_atomically_increments_once_and_writes_history(): void
    {
        [$user, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'serial_number' => 'OLD',
            'brand' => 'Old Brand',
            'version' => 4,
        ]);

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'serialNumber' => ' NEW-SERIAL ',
            'brand' => ' New Brand ',
            'model' => null,
        ], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.serialNumber', 'NEW-SERIAL')
            ->assertJsonPath('data.brand', 'New Brand')
            ->assertJsonPath('data.version', 5);

        $this->assertDatabaseHas('devices', [
            'id' => $device->id,
            'serial_number' => 'NEW-SERIAL',
            'brand' => 'New Brand',
            'version' => 5,
        ]);
        $event = DeviceChangeEvent::query()->sole();
        $this->assertSame('device.metadata_updated', $event->event_type);
        $this->assertSame($user->id, $event->actor_user_id);
        $this->assertEqualsCanonicalizing(['brand', 'serialNumber'], $event->changed_fields);
    }

    public function test_patch_payload_is_closed_requires_mutable_field_and_keeps_protected_fields_immutable(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create();

        $this->patchJson('/api/v1/devices/'.$device->id, [], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('request');

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'id' => (string) Str::ulid(),
            'schoolId' => (string) Str::ulid(),
            'qrPublicId' => 'devq_client',
            'deviceCode' => 'CHANGED',
            'deviceType' => 'router',
            'technicalProfileVersion' => 2,
            'version' => 1,
            'assetId' => 'local',
            'ipAddress' => '127.0.0.1',
            'unknown' => true,
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors([
                'id', 'schoolId', 'qrPublicId', 'deviceCode', 'deviceType',
                'technicalProfileVersion', 'version', 'assetId', 'ipAddress', 'unknown', 'request',
            ]);

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 1]);
    }

    public function test_patch_technical_profile_is_atomic_replacement_and_omission_preserves_it(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'technical_profile' => ['processor' => 'Old CPU', 'ramGB' => 8],
        ]);

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'technicalProfile' => ['ramGB' => 16],
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.technicalProfile', ['ramGB' => 16]);

        $this->assertSame(['ramGB' => 16], $device->refresh()->technical_profile);

        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'Brand'], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertJsonPath('data.technicalProfile', ['ramGB' => 16]);

        $this->assertSame(['ramGB' => 16], $device->refresh()->technical_profile);
        $this->assertSame(2, DeviceChangeEvent::query()->count());
    }

    public function test_invalid_multi_field_patch_is_fully_atomic(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'brand' => 'Original',
            'technical_profile' => ['ramGB' => 8],
        ]);

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'brand' => 'Changed',
            'technicalProfile' => ['portCount' => 24],
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('technicalProfile.portCount');

        $device->refresh();
        $this->assertSame('Original', $device->brand);
        $this->assertSame(['ramGB' => 8], $device->technical_profile);
        $this->assertSame(1, $device->version);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_patch_lifecycle_supports_only_active_spare_transitions_and_no_hidden_manage_authority(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create(['lifecycle_status' => 'in_service']);

        $this->patchJson('/api/v1/devices/'.$device->id, ['lifecycleStatus' => 'spare'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.lifecycleStatus', 'spare')
            ->assertJsonPath('data.version', 2);
        $this->patchJson('/api/v1/devices/'.$device->id, ['lifecycleStatus' => 'in_service'], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertJsonPath('data.lifecycleStatus', 'in_service')
            ->assertJsonPath('data.version', 3);

        foreach (['retired', 'decommissioned'] as $terminal) {
            $this->patchJson('/api/v1/devices/'.$device->id, ['lifecycleStatus' => $terminal], ['If-Match' => '"3"'])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('lifecycleStatus');
        }
    }

    public function test_terminal_existing_device_cannot_be_reactivated_by_generic_patch(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);

        foreach (['retired', 'decommissioned'] as $index => $terminal) {
            $device = Device::factory()->for($school)->create([
                'device_code' => 'TERMINAL-'.$index,
                'lifecycle_status' => $terminal,
            ]);

            $this->patchJson('/api/v1/devices/'.$device->id, ['lifecycleStatus' => 'in_service'], ['If-Match' => '"1"'])
                ->assertStatus(409)
                ->assertJsonPath('code', 'DEVICE_LIFECYCLE_TRANSITION_INVALID');

            $this->assertDatabaseHas('devices', ['id' => $device->id, 'lifecycle_status' => $terminal, 'version' => 1]);
        }
    }

    public function test_patch_allows_version_protected_initial_home_assignment_and_same_home_noop(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $lab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => null]);

        $this->patchJson('/api/v1/devices/'.$device->id, ['homeLaboratoryId' => $lab->id], ['If-Match' => '"0"'])
            ->assertStatus(428);

        $this->patchJson('/api/v1/devices/'.$device->id, ['homeLaboratoryId' => $lab->id], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.homeLaboratoryId', $lab->id)
            ->assertJsonPath('data.version', 2);

        $device->refresh()->updateQuietly(['updated_at' => now()->subHour()]);
        $unchangedUpdatedAt = $device->refresh()->updated_at->toISOString();
        $eventCount = DeviceChangeEvent::query()->count();

        $this->patchJson('/api/v1/devices/'.$device->id, ['homeLaboratoryId' => $lab->id], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.homeLaboratoryId', $lab->id)
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.updatedAt', $unchangedUpdatedAt);

        $device->refresh();
        $this->assertSame(2, $device->version);
        $this->assertSame($unchangedUpdatedAt, $device->updated_at->toISOString());
        $this->assertSame($eventCount, DeviceChangeEvent::query()->count());
    }

    public function test_same_lifecycle_metadata_and_null_values_are_effective_noops(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'lifecycle_status' => 'in_service',
            'brand' => 'Dell',
            'model' => null,
            'updated_at' => now()->subDay(),
        ]);
        $updatedAt = $device->updated_at->toISOString();

        foreach ([
            ['lifecycleStatus' => 'in_service'],
            ['brand' => 'Dell'],
            ['model' => null],
        ] as $payload) {
            $this->patchJson('/api/v1/devices/'.$device->id, $payload, ['If-Match' => '"1"'])
                ->assertOk()
                ->assertHeader('ETag', '"1"')
                ->assertJsonPath('data.version', 1)
                ->assertJsonPath('data.updatedAt', $updatedAt);
        }

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 1]);
        $this->assertSame($updatedAt, $device->refresh()->updated_at->toISOString());
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_reordered_identical_technical_profile_is_noop_but_list_order_remains_semantic(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'technical_profile' => ['processor' => 'CPU', 'ramGB' => 16],
            'updated_at' => now()->subDay(),
        ]);
        $updatedAt = $device->updated_at->toISOString();

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'technicalProfile' => ['ramGB' => 16, 'processor' => 'CPU'],
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.updatedAt', $updatedAt);

        $this->assertSame(['processor' => 'CPU', 'ramGB' => 16], $device->refresh()->technical_profile);
        $this->assertDatabaseCount('device_change_events', 0);

        $accessPoint = Device::factory()->for($school)->create([
            'device_type' => 'access_point',
            'technical_profile' => ['bands' => ['2.4GHz', '5GHz']],
        ]);
        $this->patchJson('/api/v1/devices/'.$accessPoint->id, [
            'technicalProfile' => ['bands' => ['5GHz', '2.4GHz']],
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2);
        $this->assertDatabaseCount('device_change_events', 1);
    }

    public function test_mixed_patch_mutates_once_and_history_contains_only_effective_changes(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create(['brand' => 'Dell', 'model' => 'Old']);

        $this->patchJson('/api/v1/devices/'.$device->id, [
            'brand' => 'Dell',
            'model' => 'New',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.brand', 'Dell')
            ->assertJsonPath('data.model', 'New');

        $event = DeviceChangeEvent::query()->sole();
        $this->assertSame(['model'], $event->changed_fields);
        $this->assertSame(['model'], array_keys($event->changes));
        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 2, 'model' => 'New']);
    }

    public function test_stale_noop_still_fails_optimistic_concurrency_without_history(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create([
            'brand' => 'Dell',
            'version' => 2,
            'updated_at' => now()->subDay(),
        ]);
        $updatedAt = $device->updated_at->toISOString();

        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'Dell'], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertExactJson([
                'message' => 'Device has changed since it was loaded.',
                'code' => 'DEVICE_VERSION_CONFLICT',
            ]);

        $device->refresh();
        $this->assertSame(2, $device->version);
        $this->assertSame($updatedAt, $device->updated_at->toISOString());
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_initial_home_assignment_rejects_inactive_unknown_and_cross_tenant_labs_identically(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $other = Laboratory::factory()->create(['status' => 'active']);

        foreach ([$inactive->id, $other->id, (string) Str::ulid()] as $index => $laboratoryId) {
            $device = Device::factory()->for($school)->create(['device_code' => 'UNASSIGNED-'.$index]);
            $response = $this->patchJson('/api/v1/devices/'.$device->id, [
                'homeLaboratoryId' => $laboratoryId,
            ], ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonValidationErrors('homeLaboratoryId');

            $this->assertSame(
                ['The selected home laboratory is invalid.'],
                $response->json('errors.homeLaboratoryId'),
            );
            $this->assertDatabaseHas('devices', ['id' => $device->id, 'home_laboratory_id' => null, 'version' => 1]);
        }
    }

    public function test_established_home_cannot_be_reassigned_or_cleared_through_generic_patch(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $labA = Laboratory::factory()->for($school)->create();
        $labB = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $labA->id]);

        foreach ([$labB->id, null] as $newHome) {
            $this->patchJson('/api/v1/devices/'.$device->id, ['homeLaboratoryId' => $newHome], ['If-Match' => '"1"'])
                ->assertStatus(409)
                ->assertExactJson([
                    'message' => 'Established Device home Laboratory changes require the Device Transfer domain.',
                    'code' => 'DEVICE_HOME_LABORATORY_TRANSFER_REQUIRED',
                ]);
        }

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'home_laboratory_id' => $labA->id, 'version' => 1]);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_patch_cross_tenant_and_unknown_device_are_identical_with_valid_precondition(): void
    {
        $this->authenticateWithPermissions(['devices.update']);
        $other = Device::factory()->create(['brand' => 'Other']);
        $expected = ['message' => 'Device not found.', 'code' => 'DEVICE_NOT_FOUND'];

        $this->patchJson('/api/v1/devices/'.$other->id, ['brand' => 'Leaked'], ['If-Match' => '"1"'])
            ->assertNotFound()->assertExactJson($expected);
        $this->patchJson('/api/v1/devices/'.Str::ulid(), ['brand' => 'Leaked'], ['If-Match' => '"1"'])
            ->assertNotFound()->assertExactJson($expected);

        $this->assertDatabaseHas('devices', ['id' => $other->id, 'brand' => 'Other']);
    }

    public function test_request_shape_validation_precedes_unknown_or_cross_tenant_patch_lookup_identically(): void
    {
        $this->authenticateWithPermissions(['devices.update']);
        $other = Device::factory()->create();

        $unknown = $this->patchJson('/api/v1/devices/'.Str::ulid(), ['brand' => ['invalid']], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('brand');
        $crossTenant = $this->patchJson('/api/v1/devices/'.$other->id, ['brand' => ['invalid']], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('brand');

        $this->assertSame($unknown->json(), $crossTenant->json());
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_each_successful_mutation_writes_exactly_one_safe_domain_event(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.create', 'devices.update']);
        $lab = Laboratory::factory()->for($school)->create();

        $deviceId = $this->postJson('/api/v1/devices', $this->validPayload())
            ->assertCreated()->json('data.id');
        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Brand'], ['If-Match' => '"1"'])->assertOk();
        $this->patchJson('/api/v1/devices/'.$deviceId, ['homeLaboratoryId' => $lab->id], ['If-Match' => '"2"'])->assertOk();
        $this->patchJson('/api/v1/devices/'.$deviceId, ['lifecycleStatus' => 'spare'], ['If-Match' => '"3"'])->assertOk();
        $this->patchJson('/api/v1/devices/'.$deviceId, ['technicalProfile' => ['ramGB' => 16]], ['If-Match' => '"4"'])->assertOk();

        $events = DeviceChangeEvent::query()->where('device_id', $deviceId)->orderBy('created_at')->orderBy('id')->get();
        $this->assertCount(5, $events);
        $this->assertEqualsCanonicalizing([
            'device.created',
            'device.metadata_updated',
            'device.home_assigned',
            'device.lifecycle_changed',
            'device.technical_profile_replaced',
        ], $events->pluck('event_type')->all());

        $serialized = $events->toJson();
        $this->assertStringNotContainsString('qrPublicId', $serialized);
        $this->assertStringNotContainsString('ipAddress', $serialized);
        $this->assertStringNotContainsString('macAddress', $serialized);
        $profileChanges = $events->firstWhere('event_type', 'device.technical_profile_replaced')->changes;
        $this->assertArrayHasKey('beforeHash', $profileChanges['technicalProfile']);
        $this->assertArrayHasKey('afterHash', $profileChanges['technicalProfile']);
        $this->assertArrayNotHasKey('before', $profileChanges['technicalProfile']);
        $this->assertArrayNotHasKey('after', $profileChanges['technicalProfile']);
    }

    public function test_failed_patch_statuses_do_not_write_history(): void
    {
        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $home = Laboratory::factory()->for($school)->create();
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $home->id]);

        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'x'])->assertStatus(428);
        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'x'], ['If-Match' => '"2"'])->assertStatus(412);
        $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => ['x']], ['If-Match' => '"1"'])->assertStatus(422);
        $this->patchJson('/api/v1/devices/'.Str::ulid(), ['brand' => 'x'], ['If-Match' => '"1"'])->assertStatus(404);
        $this->patchJson('/api/v1/devices/'.$device->id, ['homeLaboratoryId' => null], ['If-Match' => '"1"'])->assertStatus(409);

        $this->assertDatabaseCount('device_change_events', 0);
        $this->assertDatabaseHas('devices', ['id' => $device->id, 'version' => 1, 'brand' => $device->brand]);
    }

    public function test_event_insert_failure_rolls_back_device_mutation(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('SQLite-only failure injection for the portable test suite.');
        }

        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create(['brand' => 'Original']);
        DB::unprepared("CREATE TRIGGER reject_device_history BEFORE INSERT ON device_change_events BEGIN SELECT RAISE(ABORT, 'forced history failure'); END");

        try {
            $this->patchJson('/api/v1/devices/'.$device->id, ['brand' => 'Changed'], ['If-Match' => '"1"'])
                ->assertServerError();
        } finally {
            DB::unprepared('DROP TRIGGER IF EXISTS reject_device_history');
        }

        $this->assertDatabaseHas('devices', ['id' => $device->id, 'brand' => 'Original', 'version' => 1]);
        $this->assertDatabaseCount('device_change_events', 0);
    }

    public function test_actor_deletion_nulls_live_history_links_but_preserves_snapshots(): void
    {
        [$user, , $membership] = $this->authenticateWithPermissions(['devices.create']);
        $this->postJson('/api/v1/devices', $this->validPayload())->assertCreated();
        $event = DeviceChangeEvent::query()->sole();

        $membershipId = $membership->id;
        $userId = $user->id;
        $membership->delete();
        $user->delete();

        $event->refresh();
        $this->assertNull($event->actor_membership_id);
        $this->assertNull($event->actor_user_id);
        $this->assertSame($membershipId, $event->actor_membership_id_snapshot);
        $this->assertSame($userId, $event->actor_user_id_snapshot);
    }

    public function test_etag_sequence_matches_versions_and_stale_retry_does_not_mutate(): void
    {
        $this->authenticateWithPermissions(['devices.create', 'devices.view', 'devices.update']);
        $created = $this->postJson('/api/v1/devices', $this->validPayload())->assertCreated();
        $deviceId = $created->json('data.id');
        $this->assertSame('"1"', $created->headers->get('ETag'));
        $this->assertSame(1, $created->json('data.version'));

        $shown = $this->getJson('/api/v1/devices/'.$deviceId)->assertOk();
        $this->assertSame('"1"', $shown->headers->get('ETag'));
        $this->assertSame(1, $shown->json('data.version'));

        $updated = $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Updated'], ['If-Match' => '"1"'])
            ->assertOk();
        $this->assertSame('"2"', $updated->headers->get('ETag'));
        $this->assertSame(2, $updated->json('data.version'));

        $this->patchJson('/api/v1/devices/'.$deviceId, ['brand' => 'Stale'], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'DEVICE_VERSION_CONFLICT');
        $this->assertDatabaseHas('devices', ['id' => $deviceId, 'brand' => 'Updated', 'version' => 2]);
        $this->assertDatabaseCount('device_change_events', 2);
    }

    public function test_database_enforces_school_code_and_global_qr_uniqueness(): void
    {
        $school = School::factory()->create();
        $existing = Device::factory()->for($school)->create([
            'device_code' => 'UNIQUE-DEVICE',
            'qr_public_id' => 'devq_aaaaaaaaaaaaaaaaaaaaaa',
        ]);

        try {
            Device::factory()->for($school)->create(['device_code' => $existing->device_code]);
            $this->fail('Expected school-scoped Device code uniqueness violation.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        Device::factory()->create(['qr_public_id' => $existing->qr_public_id]);
    }

    public function test_database_rejects_invalid_type_lifecycle_versions_and_json_array_profile(): void
    {
        foreach ([
            ['device_type' => 'phone'],
            ['lifecycle_status' => 'maintenance'],
            ['version' => 0],
            ['technical_profile_version' => 0],
            ['technical_profile' => ['list-item']],
        ] as $attributes) {
            try {
                Device::factory()->create($attributes);
                $this->fail('Expected Device database integrity violation.');
            } catch (QueryException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_school_and_home_laboratory_deletion_are_restricted_while_devices_exist(): void
    {
        $school = School::factory()->create();
        $lab = Laboratory::factory()->for($school)->create();
        Device::factory()->for($school)->create(['home_laboratory_id' => $lab->id]);

        try {
            $lab->delete();
            $this->fail('Expected home Laboratory delete restriction.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        $school->forceDelete();
    }

    public function test_exactly_four_device_routes_exist_with_exact_permission_middleware_and_no_delete(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/devices'))
            ->values();

        $this->assertCount(4, $routes);
        $actual = $routes->map(fn ($route): array => [
            'methods' => $route->methods(),
            'uri' => $route->uri(),
            'middleware' => $route->gatherMiddleware(),
        ])->all();

        $this->assertSame('api/v1/devices', $actual[0]['uri']);
        $this->assertContains('permission:devices.view', $actual[0]['middleware']);
        $this->assertSame('api/v1/devices', $actual[1]['uri']);
        $this->assertContains('permission:devices.create', $actual[1]['middleware']);
        $this->assertSame('api/v1/devices/{deviceId}', $actual[2]['uri']);
        $this->assertContains('permission:devices.view', $actual[2]['middleware']);
        $this->assertSame('api/v1/devices/{deviceId}', $actual[3]['uri']);
        $this->assertContains('permission:devices.update', $actual[3]['middleware']);

        [, $school] = $this->authenticateWithPermissions(['devices.update']);
        $device = Device::factory()->for($school)->create();
        $this->deleteJson('/api/v1/devices/'.$device->id)->assertStatus(405);
        $this->assertDatabaseHas('devices', ['id' => $device->id]);
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function endpointPermissionProvider(): array
    {
        return [
            'list' => ['GET', '/api/v1/devices', 'devices.view'],
            'create' => ['POST', '/api/v1/devices', 'devices.create'],
            'show' => ['GET', '/api/v1/devices/{deviceId}', 'devices.view'],
            'patch' => ['PATCH', '/api/v1/devices/{deviceId}', 'devices.update'],
        ];
    }

    /**
     * @return array<string, array{string|null}>
     */
    public static function invalidIfMatchProvider(): array
    {
        return [
            'missing' => [null],
            'empty' => [''],
            'weak' => ['W/"1"'],
            'wildcard' => ['*'],
            'unquoted' => ['1'],
            'multiple' => ['"1", "2"'],
            'zero' => ['"0"'],
            'negative' => ['"-1"'],
            'non numeric' => ['"one"'],
            'malformed' => ['"1'],
        ];
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
            $permissionIds = collect($permissions)->map(function (string $key): string {
                return Permission::query()->firstOrCreate(
                    ['key' => $key],
                    ['name' => $key],
                )->id;
            });

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
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function validPayload(array $overrides = []): array
    {
        return [
            'deviceCode' => 'DEV-000123',
            'deviceType' => 'desktop_pc',
            ...$overrides,
        ];
    }

    /** @param array<string, mixed> $expected */
    private function assertRawTechnicalProfileObject(TestResponse $response, array $expected): void
    {
        $decoded = json_decode($response->getContent(), false, 512, JSON_THROW_ON_ERROR);
        $this->assertIsObject($decoded->data->technicalProfile);
        $this->assertSame($expected, (array) $decoded->data->technicalProfile);
    }

    /**
     * @return list<array{type: string, profile: array<string, mixed>}>
     */
    private function representativeProfiles(): array
    {
        return [
            ['type' => 'desktop_pc', 'profile' => ['processor' => 'Core i5', 'ramGB' => 16, 'storageGB' => 512, 'gpu' => 'Integrated', 'os' => 'Linux']],
            ['type' => 'laptop', 'profile' => ['processor' => 'Ryzen 5', 'ramGB' => 16, 'storageGB' => 512, 'gpu' => 'Integrated', 'os' => 'Linux', 'display' => '14 inch']],
            ['type' => 'server', 'profile' => ['processor' => 'Xeon', 'cpuSockets' => 2, 'cpuCores' => 16, 'ramGB' => 64, 'storageGB' => 2048, 'raidLevel' => 'RAID 1', 'os' => 'Linux']],
            ['type' => 'network_switch', 'profile' => ['portCount' => 24, 'managed' => true, 'poe' => true, 'poeBudgetWatts' => 180, 'switchingCapacityGbps' => 56.5, 'uplinkSpeedGbps' => 10, 'firmwareVersion' => '1.2.3']],
            ['type' => 'router', 'profile' => ['wanPortCount' => 2, 'lanPortCount' => 4, 'throughputMbps' => 1000.5, 'wifiCapable' => true, 'firmwareVersion' => '2.0']],
            ['type' => 'access_point', 'profile' => ['wifiStandard' => 'Wi-Fi 6', 'bands' => ['2.4GHz', '5GHz'], 'maxClients' => 128, 'poe' => true, 'firmwareVersion' => '3.0']],
            ['type' => 'printer', 'profile' => ['technology' => 'laser', 'color' => true, 'duplex' => true, 'networkCapable' => true, 'paperSize' => 'A4']],
            ['type' => 'projector', 'profile' => ['technology' => 'DLP', 'brightnessLumens' => 4200, 'nativeResolution' => '1920x1080']],
            ['type' => 'ups', 'profile' => ['capacityVA' => 1500, 'powerWatts' => 900, 'batteryCount' => 2, 'batteryVoltage' => 12, 'runtimeMinutes' => 30.5]],
            ['type' => 'other', 'profile' => ['customProperty' => 'custom value', 'quantity' => 2, 'enabled' => false, 'notes' => null]],
        ];
    }
}
