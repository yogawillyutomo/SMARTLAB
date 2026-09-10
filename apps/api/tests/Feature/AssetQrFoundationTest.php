<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\AssetQrLabelBatch;
use App\Models\AssetQrLabelBatchEvent;
use App\Models\AssetQrLabelBatchItem;
use App\Models\Laboratory;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class AssetQrFoundationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_permissions_are_least_privilege_and_super_admin_remains_catalog_driven(): void
    {
        $admin = Role::query()->where('key', 'admin-lab')->sole()->permissions()->pluck('key')->all();
        $head = Role::query()->where('key', 'kepala-lab')->sole()->permissions()->pluck('key')->all();
        $technician = Role::query()->where('key', 'teknisi')->sole()->permissions()->pluck('key')->all();
        $teacher = Role::query()->where('key', 'guru')->sole()->permissions()->pluck('key')->all();

        foreach (['assets.manage-qr', 'assets.generate-labels'] as $permission) {
            $this->assertContains($permission, $admin);
            $this->assertContains($permission, $head);
            $this->assertNotContains($permission, $technician);
            $this->assertNotContains($permission, $teacher);
        }
    }

    public function test_one_asset_has_at_most_one_active_qr_identity_and_history_cannot_be_deleted(): void
    {
        [$school, $user, $membership] = $this->actor();
        $asset = Asset::factory()->create(['school_id' => $school->id]);

        $this->identity($asset, $user, $membership, 1);

        try {
            $this->identity($asset, $user, $membership, 2);
            $this->fail('Expected database to reject a second active Asset QR identity.');
        } catch (QueryException) {
        }

        $identity = AssetQrIdentity::query()->where('asset_id', $asset->id)->sole();

        try {
            $identity->delete();
            $this->fail('Expected Asset QR identity history delete to fail.');
        } catch (QueryException) {
        }
    }

    public function test_identity_allows_only_evidenced_active_to_revoked_transition(): void
    {
        [$school, $user, $membership] = $this->actor();
        $asset = Asset::factory()->create(['school_id' => $school->id]);
        $identity = $this->identity($asset, $user, $membership, 1);

        $identity->status = 'revoked';
        $identity->revoked_by_user_id = $user->id;
        $identity->revoked_by_membership_id = $membership->id;
        $identity->revoked_by_user_id_snapshot = $user->id;
        $identity->revoked_by_membership_id_snapshot = $membership->id;
        $identity->revoked_by_name_snapshot = $user->name;
        $identity->revoked_reason = 'Rotate label after confirmed exposure.';
        $identity->revoked_at = now();
        $identity->save();

        $this->assertSame('revoked', $identity->refresh()->status);

        try {
            $identity->update(['status' => 'active']);
            $this->fail('Expected revoked Asset QR identity to remain terminal.');
        } catch (QueryException) {
        }

        $replacement = $this->identity($asset, $user, $membership, 2);
        $this->assertSame(2, $replacement->token_version);
    }

    public function test_label_batch_items_and_events_are_exact_snapshot_evidence_and_immutable(): void
    {
        [$school, $user, $membership] = $this->actor();
        $lab = Laboratory::factory()->create([
            'school_id' => $school->id,
            'code' => 'QR-LAB',
            'name' => 'QR Lab',
            'status' => 'active',
        ]);
        $asset = Asset::factory()->create([
            'school_id' => $school->id,
            'asset_code' => 'AST-QR-001',
            'name' => 'PC QR UAT',
            'home_laboratory_id' => $lab->id,
        ]);
        $identity = $this->identity($asset, $user, $membership, 1);

        $batch = AssetQrLabelBatch::query()->create([
            'school_id' => $school->id,
            'laboratory_id' => $lab->id,
            'laboratory_code_snapshot' => $lab->code,
            'laboratory_name_snapshot' => $lab->name,
            'template_key' => '50x30',
            'filters' => ['laboratoryId' => (string) $lab->id],
            'asset_count' => 1,
            'generated_by_user_id' => $user->id,
            'generated_by_membership_id' => $membership->id,
            'generated_by_user_id_snapshot' => $user->id,
            'generated_by_membership_id_snapshot' => $membership->id,
            'generated_by_name_snapshot' => $user->name,
            'generated_at' => now(),
        ]);

        $item = AssetQrLabelBatchItem::query()->create([
            'school_id' => $school->id,
            'asset_qr_label_batch_id' => $batch->id,
            'asset_id' => $asset->id,
            'asset_qr_identity_id' => $identity->id,
            'ordinal' => 1,
            'asset_code_snapshot' => $asset->asset_code,
            'asset_name_snapshot' => $asset->name,
            'laboratory_id_snapshot' => $lab->id,
            'laboratory_code_snapshot' => $lab->code,
            'laboratory_name_snapshot' => $lab->name,
            'public_id_snapshot' => $identity->public_id,
            'token_version_snapshot' => $identity->token_version,
            'created_at' => now(),
        ]);

        $event = AssetQrLabelBatchEvent::query()->create([
            'school_id' => $school->id,
            'asset_qr_label_batch_id' => $batch->id,
            'event_type' => 'generated',
            'actor_user_id' => $user->id,
            'actor_membership_id' => $membership->id,
            'actor_user_id_snapshot' => $user->id,
            'actor_membership_id_snapshot' => $membership->id,
            'actor_name_snapshot' => $user->name,
            'payload' => ['assetCount' => 1, 'templateKey' => '50x30'],
            'created_at' => now(),
        ]);

        foreach ([
            fn () => $batch->update(['asset_count' => 2]),
            fn () => $item->update(['asset_name_snapshot' => 'Tampered']),
            fn () => $event->delete(),
        ] as $mutation) {
            try {
                $mutation();
                $this->fail('Expected QR label evidence mutation to fail.');
            } catch (QueryException) {
            }
        }

        $this->assertSame('PC QR UAT', $item->fresh()->asset_name_snapshot);
        $this->assertSame(1, $batch->fresh()->asset_count);
        $this->assertTrue(AssetQrLabelBatchEvent::query()->whereKey($event->id)->exists());
    }

    /** @return array{School,User,SchoolMembership} */
    private function actor(): array
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        return [$school, $user, $membership];
    }

    private function identity(Asset $asset, User $user, SchoolMembership $membership, int $version): AssetQrIdentity
    {
        return AssetQrIdentity::query()->create([
            'school_id' => $asset->school_id,
            'asset_id' => $asset->id,
            'public_id' => (string) Str::uuid(),
            'token_version' => $version,
            'status' => 'active',
            'issued_by_user_id' => $user->id,
            'issued_by_membership_id' => $membership->id,
            'issued_by_user_id_snapshot' => $user->id,
            'issued_by_membership_id_snapshot' => $membership->id,
            'issued_by_name_snapshot' => $user->name,
            'issued_at' => now(),
        ]);
    }
}
