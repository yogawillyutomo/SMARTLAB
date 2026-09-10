<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssetQrApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_public_scan_is_anonymous_safe_minimal_and_never_reuses_asset_resource(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['assets.manage-qr']);
        $lab = Laboratory::factory()->for($school)->create(['code' => 'RPL1', 'name' => 'Lab RPL 1']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'serial_number' => 'DEVICE-SECRET',
            'technical_profile' => ['ramGB' => 16],
        ]);
        $asset = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-QR-SAFE',
            'name' => 'PC Guru',
            'category' => 'Komputer',
            'home_laboratory_id' => $lab->id,
            'serial_number' => 'ASSET-SECRET',
            'funding_source' => 'SECRET-FUND',
            'purchase_price' => 9999999,
            'supplier_name' => 'SECRET-SUPPLIER',
            'notes' => 'SECRET-NOTES',
            'linked_device_id' => $device->id,
        ]);

        $issued = $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')
            ->assertCreated();

        $publicId = (string) $issued->json('data.publicId');

        auth()->forgetGuards();

        $response = $this->getJson('/api/v1/public/assets/qr/'.$publicId)
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'school' => [
                        'code' => $school->code,
                        'name' => $school->name,
                    ],
                    'asset' => [
                        'assetCode' => 'AST-QR-SAFE',
                        'name' => 'PC Guru',
                        'category' => 'Komputer',
                        'condition' => $asset->condition,
                        'lifecycleStatus' => 'active',
                        'homeLaboratory' => [
                            'code' => 'RPL1',
                            'name' => 'Lab RPL 1',
                        ],
                    ],
                ],
            ]);

        $json = json_encode($response->json(), JSON_THROW_ON_ERROR);
        foreach ([
            $asset->id, $school->id, $device->id,
            'ASSET-SECRET', 'DEVICE-SECRET', 'SECRET-FUND', 'SECRET-SUPPLIER', 'SECRET-NOTES',
            '9999999', 'ramGB',
        ] as $forbidden) {
            $this->assertStringNotContainsString((string) $forbidden, $json);
        }

        $this->assertDatabaseHas('assets', ['id' => $asset->id, 'version' => 1]);
        $this->assertDatabaseHas('asset_qr_identities', [
            'asset_id' => $asset->id,
            'issued_by_user_id_snapshot' => $user->id,
            'issued_by_membership_id_snapshot' => $membership->id,
        ]);
    }

    public function test_malformed_unknown_and_revoked_public_ids_are_indistinguishable_not_found(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.manage-qr']);
        $asset = Asset::factory()->for($school)->create();

        $issued = $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')->assertCreated();
        $publicId = (string) $issued->json('data.publicId');

        $notFound = ['message' => 'Asset QR not found.', 'code' => 'ASSET_QR_NOT_FOUND'];

        $this->getJson('/api/v1/public/assets/qr/not-a-uuid')->assertNotFound()->assertExactJson($notFound);
        $this->getJson('/api/v1/public/assets/qr/'.Str::uuid())->assertNotFound()->assertExactJson($notFound);

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/revoke', [
            'reason' => 'Sticker photographed outside approved use.',
        ])->assertOk();

        $this->getJson('/api/v1/public/assets/qr/'.$publicId)->assertNotFound()->assertExactJson($notFound);
    }

    public function test_qr_management_requires_active_membership_and_exact_permission(): void
    {
        $asset = Asset::factory()->create();

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());
        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');

        [, $school] = $this->authenticateWithPermissions(['assets.view']);
        $mine = Asset::factory()->for($school)->create();
        $this->postJson('/api/v1/assets/'.$mine->id.'/qr-identities')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_issue_is_school_scoped_creates_one_active_identity_and_does_not_mutate_asset_version(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['assets.manage-qr']);
        $mine = Asset::factory()->for($school)->create(['version' => 7]);
        $other = Asset::factory()->create();

        $this->postJson('/api/v1/assets/'.$other->id.'/qr-identities')
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_NOT_FOUND');

        $response = $this->postJson('/api/v1/assets/'.$mine->id.'/qr-identities')
            ->assertCreated()
            ->assertJsonPath('data.assetId', $mine->id)
            ->assertJsonPath('data.tokenVersion', 1)
            ->assertJsonPath('data.status', 'active');

        $this->assertTrue(Str::isUuid((string) $response->json('data.publicId')));
        $this->assertDatabaseHas('asset_qr_identities', [
            'asset_id' => $mine->id,
            'school_id' => $school->id,
            'token_version' => 1,
            'status' => 'active',
            'issued_by_user_id_snapshot' => $user->id,
            'issued_by_membership_id_snapshot' => $membership->id,
        ]);
        $this->assertDatabaseHas('assets', ['id' => $mine->id, 'version' => 7]);

        $this->postJson('/api/v1/assets/'.$mine->id.'/qr-identities')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_QR_ALREADY_ACTIVE');

        $this->assertDatabaseCount('asset_qr_identities', 1);
    }

    public function test_rotate_is_atomic_terminalizes_old_token_and_increments_qr_version_only(): void
    {
        [$user, $school] = $this->authenticateWithPermissions(['assets.manage-qr']);
        $asset = Asset::factory()->for($school)->create(['version' => 4]);

        $first = $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')->assertCreated();
        $oldId = (string) $first->json('data.publicId');

        $second = $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/rotate', [
            'reason' => 'Prevent reuse after label exposure.',
        ])
            ->assertOk()
            ->assertJsonPath('data.tokenVersion', 2)
            ->assertJsonPath('data.status', 'active');

        $newId = (string) $second->json('data.publicId');
        $this->assertNotSame($oldId, $newId);

        $this->getJson('/api/v1/public/assets/qr/'.$oldId)
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_QR_NOT_FOUND');
        $this->getJson('/api/v1/public/assets/qr/'.$newId)
            ->assertOk()
            ->assertJsonPath('data.asset.assetCode', $asset->asset_code);

        $old = AssetQrIdentity::query()->where('public_id', $oldId)->sole();
        $this->assertSame('revoked', $old->status);
        $this->assertSame('Prevent reuse after label exposure.', $old->revoked_reason);
        $this->assertSame($user->id, $old->revoked_by_user_id_snapshot);
        $this->assertDatabaseHas('assets', ['id' => $asset->id, 'version' => 4]);
        $this->assertSame(1, AssetQrIdentity::query()->where('asset_id', $asset->id)->where('status', 'active')->count());
    }

    public function test_revoke_requires_reason_and_history_remains_queryable_by_manager(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.manage-qr']);
        $asset = Asset::factory()->for($school)->create(['version' => 3]);

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')->assertCreated();

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/revoke', [])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/revoke', [
            'reason' => 'Asset label physically destroyed.',
        ])
            ->assertOk()
            ->assertJsonPath('data.status', 'revoked');

        $this->getJson('/api/v1/assets/'.$asset->id.'/qr-identities')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.status', 'revoked')
            ->assertJsonPath('data.0.revokedReason', 'Asset label physically destroyed.');

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/revoke', [
            'reason' => 'Second revoke must fail.',
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_QR_NOT_ACTIVE');

        $this->assertDatabaseHas('assets', ['id' => $asset->id, 'version' => 3]);
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
