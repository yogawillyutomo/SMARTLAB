<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AuthenticatedAssetQrApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_resolver_only_returns_canonical_asset_id_inside_active_school_and_assets_view_permission(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.manage-qr', 'assets.view']);
        $asset = Asset::factory()->for($school)->create();

        $issued = $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities')
            ->assertCreated();
        $publicId = (string) $issued->json('data.publicId');

        $this->getJson('/api/v1/asset-qr/'.$publicId)
            ->assertOk()
            ->assertExactJson([
                'data' => [
                    'assetId' => $asset->id,
                ],
            ]);

        $this->authenticateWithPermissions([], $school);
        $this->getJson('/api/v1/asset-qr/'.$publicId)
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['assets.view']);
        $this->getJson('/api/v1/asset-qr/'.$publicId)
            ->assertNotFound()
            ->assertExactJson([
                'message' => 'Asset QR not found.',
                'code' => 'ASSET_QR_NOT_FOUND',
            ]);
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
