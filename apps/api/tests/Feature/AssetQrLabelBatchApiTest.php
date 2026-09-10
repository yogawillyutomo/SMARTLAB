<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\AssetQrLabelBatch;
use App\Models\AssetQrLabelBatchEvent;
use App\Models\AssetQrLabelBatchItem;
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

class AssetQrLabelBatchApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_candidate_projection_is_school_scoped_filterable_and_hides_sensitive_asset_fields(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.generate-labels', 'assets.manage-qr', 'assets.view',
        ]);
        $labA = Laboratory::factory()->for($school)->create(['code' => 'RPL1', 'name' => 'Lab RPL 1']);
        $labB = Laboratory::factory()->for($school)->create(['code' => 'RPL2', 'name' => 'Lab RPL 2']);
        $device = Device::factory()->for($school)->create(['home_laboratory_id' => $labA->id]);

        $printed = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-001',
            'name' => 'Printed PC',
            'category' => 'Komputer',
            'home_laboratory_id' => $labA->id,
            'linked_device_id' => $device->id,
            'serial_number' => 'SECRET-SERIAL',
            'purchase_price' => 9000000,
            'supplier_name' => 'SECRET-SUPPLIER',
        ]);
        $unprinted = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-002',
            'name' => 'Unprinted PC',
            'category' => 'Komputer',
            'home_laboratory_id' => $labA->id,
            'linked_device_id' => null,
        ]);
        Asset::factory()->for($school)->create([
            'asset_code' => 'AST-101',
            'name' => 'Other Lab PC',
            'category' => 'Komputer',
            'home_laboratory_id' => $labB->id,
        ]);
        Asset::factory()->create(['asset_code' => 'AST-OTHER-SCHOOL']);

        $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '50x30',
            'assetIds' => [$printed->id],
            'selection' => ['laboratoryId' => $labA->id],
        ])->assertCreated();

        $response = $this->getJson('/api/v1/asset-qr-label-candidates?laboratoryId='.$labA->id.'&category=Komputer&linkStatus=unlinked&printedStatus=unprinted')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $unprinted->id)
            ->assertJsonPath('data.0.qr.status', 'missing')
            ->assertJsonPath('data.0.qr.printed', false);

        $json = json_encode($response->json(), JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('SECRET-SERIAL', $json);
        $this->assertStringNotContainsString('SECRET-SUPPLIER', $json);
        $this->assertStringNotContainsString('9000000', $json);

        $this->getJson('/api/v1/asset-qr-label-candidates?laboratoryId='.$labA->id.'&printedStatus=printed')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $printed->id)
            ->assertJsonPath('data.0.qr.status', 'active')
            ->assertJsonPath('data.0.qr.printed', true);
    }

    public function test_generation_requires_label_qr_and_asset_permissions(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.generate-labels', 'assets.view']);
        $asset = Asset::factory()->for($school)->create();

        $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '50x30',
            'assetIds' => [$asset->id],
        ])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_generation_atomically_issues_missing_qr_and_freezes_deterministic_exact_snapshots(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions([
            'assets.generate-labels', 'assets.manage-qr', 'assets.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create(['code' => 'RPL1', 'name' => 'Lab RPL 1']);
        $assetB = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-002',
            'name' => 'PC 2',
            'home_laboratory_id' => $lab->id,
            'version' => 4,
        ]);
        $assetA = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-001',
            'name' => 'PC 1',
            'home_laboratory_id' => $lab->id,
            'version' => 7,
        ]);

        $response = $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '50x30',
            'assetIds' => [$assetB->id, $assetA->id],
            'selection' => [
                'laboratoryId' => $lab->id,
                'printedStatus' => 'unprinted',
            ],
        ])
            ->assertCreated()
            ->assertJsonPath('data.templateKey', '50x30')
            ->assertJsonPath('data.assetCount', 2)
            ->assertJsonPath('data.laboratory.id', $lab->id)
            ->assertJsonPath('data.items.0.assetCode', 'AST-001')
            ->assertJsonPath('data.items.0.ordinal', 1)
            ->assertJsonPath('data.items.1.assetCode', 'AST-002')
            ->assertJsonPath('data.items.1.ordinal', 2)
            ->assertJsonPath('data.events.0.type', 'generated')
            ->assertJsonPath('data.events.0.payload.autoIssuedQrCount', 2);

        $batchId = (string) $response->json('data.id');
        $this->assertTrue(Str::isUlid($batchId));
        $this->assertTrue(Str::isUuid((string) $response->json('data.items.0.publicId')));
        $this->assertSame('/api/v1/public/assets/qr/'.$response->json('data.items.0.publicId'), $response->json('data.items.0.scanPath'));

        $this->assertSame(2, AssetQrIdentity::query()->where('school_id', $school->id)->where('status', 'active')->count());
        $this->assertDatabaseHas('asset_qr_label_batches', [
            'id' => $batchId,
            'school_id' => $school->id,
            'asset_count' => 2,
            'generated_by_user_id_snapshot' => $user->id,
            'generated_by_membership_id_snapshot' => $membership->id,
        ]);
        $this->assertDatabaseHas('assets', ['id' => $assetA->id, 'version' => 7]);
        $this->assertDatabaseHas('assets', ['id' => $assetB->id, 'version' => 4]);
    }

    public function test_cross_school_or_stale_selection_rolls_back_batch_and_auto_issue(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.generate-labels', 'assets.manage-qr', 'assets.view',
        ]);
        $labA = Laboratory::factory()->for($school)->create();
        $labB = Laboratory::factory()->for($school)->create();
        $mine = Asset::factory()->for($school)->create(['home_laboratory_id' => $labA->id]);
        $other = Asset::factory()->create();

        $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '40x25',
            'assetIds' => [$mine->id, $other->id],
        ])
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_QR_LABEL_ASSET_NOT_FOUND');

        $this->assertDatabaseCount('asset_qr_label_batches', 0);
        $this->assertDatabaseCount('asset_qr_identities', 0);

        $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '40x25',
            'assetIds' => [$mine->id],
            'selection' => ['laboratoryId' => $labB->id],
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_QR_LABEL_SELECTION_STALE');

        $this->assertDatabaseCount('asset_qr_label_batches', 0);
        $this->assertDatabaseCount('asset_qr_identities', 0);
    }

    public function test_list_show_and_reprint_are_school_scoped_append_only_and_no_hard_delete_exists(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.generate-labels', 'assets.manage-qr', 'assets.view',
        ]);
        $asset = Asset::factory()->for($school)->create(['asset_code' => 'AST-REPRINT']);

        $created = $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '70x40',
            'assetIds' => [$asset->id],
        ])->assertCreated();
        $batchId = (string) $created->json('data.id');

        $this->getJson('/api/v1/asset-qr-label-batches')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $batchId);

        $this->getJson('/api/v1/asset-qr-label-batches/'.$batchId)
            ->assertOk()
            ->assertJsonPath('data.items.0.assetCode', 'AST-REPRINT');

        $this->postJson('/api/v1/asset-qr-label-batches/'.$batchId.'/reprint', [
            'reason' => 'Printer jammed after first sheet.',
        ])
            ->assertOk()
            ->assertJsonCount(2, 'data.events')
            ->assertJsonPath('data.events.1.type', 'reprinted')
            ->assertJsonPath('data.events.1.payload.reason', 'Printer jammed after first sheet.');

        $this->assertSame(1, AssetQrLabelBatch::query()->count());
        $this->assertSame(1, AssetQrLabelBatchItem::query()->count());
        $this->assertSame(2, AssetQrLabelBatchEvent::query()->count());
        $this->deleteJson('/api/v1/asset-qr-label-batches/'.$batchId)->assertStatus(405);

        $foreign = AssetQrLabelBatch::query()->create([
            'school_id' => School::factory()->create()->id,
            'laboratory_id' => null,
            'laboratory_code_snapshot' => null,
            'laboratory_name_snapshot' => null,
            'template_key' => '50x30',
            'filters' => (object) [],
            'asset_count' => 1,
            'generated_by_user_id' => null,
            'generated_by_membership_id' => null,
            'generated_by_user_id_snapshot' => (string) Str::ulid(),
            'generated_by_membership_id_snapshot' => (string) Str::ulid(),
            'generated_by_name_snapshot' => 'Foreign',
            'generated_at' => now(),
        ]);

        $this->getJson('/api/v1/asset-qr-label-batches/'.$foreign->id)
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_QR_LABEL_BATCH_NOT_FOUND');
    }

    public function test_reprint_fails_closed_after_qr_rotation_or_label_identity_drift(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.generate-labels', 'assets.manage-qr', 'assets.view',
        ]);
        $asset = Asset::factory()->for($school)->create([
            'asset_code' => 'AST-STALE',
            'name' => 'Before Name',
        ]);

        $created = $this->postJson('/api/v1/asset-qr-label-batches', [
            'templateKey' => '50x30',
            'assetIds' => [$asset->id],
        ])->assertCreated();
        $batchId = (string) $created->json('data.id');

        $this->postJson('/api/v1/assets/'.$asset->id.'/qr-identities/rotate', [
            'reason' => 'Confirmed QR exposure.',
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertHeader('ETag', '"2"');

        $this->postJson('/api/v1/asset-qr-label-batches/'.$batchId.'/reprint', [
            'reason' => 'Attempt stale reprint.',
        ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_QR_LABEL_BATCH_STALE');

        $this->assertSame(1, AssetQrLabelBatchEvent::query()->where('asset_qr_label_batch_id', $batchId)->count());
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
