<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetChangeEvent;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use App\Models\WorkOrder;
use App\Models\WorkOrderEvent;
use App\Models\WorkOrderPartUsage;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WorkOrderApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/work-orders')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/work-orders')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_create_requires_exact_asset_and_dependency_permissions(): void
    {
        [, $school] = $this->authenticateWithPermissions(['work-orders.create']);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);

        $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertForbidden();

        $this->authenticateWithPermissions([
            'work-orders.create', 'assets.view', 'laboratories.view', 'work-orders.view',
        ], $school);

        $created = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.assetId', $asset->id)
            ->assertJsonPath('data.assetCodeSnapshot', $asset->asset_code)
            ->assertJsonPath('data.laboratoryId', $lab->id)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.version', 1);

        $this->assertMatchesRegularExpression('/^WO-\d{4}-\d{6}$/', (string) $created->json('data.workOrderNumber'));
        $this->assertDatabaseCount('work_orders', 1);
        $this->assertDatabaseHas('work_order_events', [
            'work_order_id' => $created->json('data.id'),
            'event_type' => 'work_order.created',
        ]);

        $this->postJson('/api/v1/work-orders', [
            ...$this->payload($asset, $lab),
            'assetCode' => $asset->asset_code,
        ])->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_work_orders_are_same_school_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create();

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $otherSchool = School::factory()->create();
        $this->authenticateWithPermissions(['work-orders.view'], $otherSchool);

        $this->getJson('/api/v1/work-orders')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/work-orders/'.$id)
            ->assertNotFound()
            ->assertJsonPath('code', 'WORK_ORDER_NOT_FOUND');
    }

    public function test_lifecycle_keeps_corrective_custody_until_future_verification(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.approve',
            'assets.view', 'assets.retire', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'condition' => 'moderate_damage',
            'lifecycle_status' => 'active',
            'version' => 1,
        ]);

        $created = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.version', 2);

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.conditionBefore', 'moderate_damage')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 3);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'in_repair')
            ->assertJsonPath('data.provenance.workOrderCustodies.0.workOrderId', $id);

        $this->postJson("/api/v1/work-orders/{$id}/hold", [
            'reason' => 'Perlu pemeriksaan lanjutan',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'on_hold')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 4);

        $this->postJson("/api/v1/work-orders/{$id}/resume", [], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 5);

        $this->postJson("/api/v1/work-orders/{$id}/waiting-part", [
            'reason' => 'Menunggu komponen pengganti',
        ], ['If-Match' => '"5"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'waiting_part')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 6);

        $this->postJson("/api/v1/work-orders/{$id}/resume", [], ['If-Match' => '"6"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 7);

        $completed = $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan komponen utama',
            'actionTaken' => 'Komponen diperiksa dan dikalibrasi',
            'conditionAfter' => 'good',
            'testResult' => 'Pengujian fungsi lulus',
        ], ['If-Match' => '"7"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.conditionAfter', 'good')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 8);

        $this->assertNotNull($completed->json('data.completedAt'));

        $asset->refresh();
        $this->assertSame('moderate_damage', $asset->condition);
        $this->assertSame(1, $asset->version);

        $this->postJson('/api/v1/assets/'.$asset->id.'/retire', [
            'reason' => 'Tidak boleh saat corrective custody aktif',
        ], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_ACTIVE_CUSTODY_CONFLICT');

        $this->postJson("/api/v1/work-orders/{$id}/rework", [
            'reason' => 'Uji akhir belum memuaskan',
        ], ['If-Match' => '"8"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.conditionAfter', null)
            ->assertJsonPath('data.completedAt', null)
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 9);

        $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan komponen utama',
            'actionTaken' => 'Kalibrasi ulang selesai',
            'conditionAfter' => 'good',
        ], ['If-Match' => '"9"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.version', 10);

        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'Tidak boleh membatalkan completed',
        ], ['If-Match' => '"10"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_INVALID_TRANSITION');

        $this->getJson("/api/v1/work-orders/{$id}/history")
            ->assertOk()
            ->assertJsonCount(10, 'data');
    }

    public function test_second_work_order_cannot_take_the_same_active_corrective_custody(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update', 'work-orders.assign',
            'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);

        $first = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))->assertCreated();
        $second = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab, [
            'problemSummary' => 'Perbaikan kedua untuk race guard',
        ]))->assertCreated();

        foreach ([$first, $second] as $response) {
            $this->postJson('/api/v1/work-orders/'.$response->json('data.id').'/assign', [
                'assigneeMembershipId' => $membership->id,
            ], ['If-Match' => '"1"'])->assertOk();
        }

        $this->postJson('/api/v1/work-orders/'.$first->json('data.id').'/start', [], ['If-Match' => '"2"'])
            ->assertOk();

        $this->postJson('/api/v1/work-orders/'.$second->json('data.id').'/start', [], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_ACTIVE_CUSTODY_CONFLICT');

        $this->assertSame(1, WorkOrder::query()->where('asset_id', $asset->id)->where('custody_active', true)->count());
    }

    public function test_version_precondition_and_cancel_release_custody_fail_closed(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create();

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ])->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'WORK_ORDER_VERSION_CONFLICT');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'Perbaikan dihentikan secara administratif',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.version', 4);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'blocked_condition');
    }

    public function test_cancel_accepts_assign_or_approve_authority_without_requiring_view(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'work-orders.create', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create();

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->authenticateWithPermissions(['work-orders.view'], $school);
        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'View-only actor must not cancel',
        ], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['work-orders.approve'], $school);
        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'Managerial cancellation',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.version', 2);
    }

    public function test_part_issue_is_inventory_authoritative_idempotent_and_least_privilege(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.consume-stock',
            'assets.view', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
        ]);
        $item = InventoryItem::factory()->for($school)->create([
            'item_code' => 'WO-PART-001',
            'name' => 'Corrective Spare Part',
            'unit' => 'pcs',
            'on_hand_quantity' => '5.000',
            'version' => 1,
        ]);

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertJsonPath('data.version', 3);

        $mutationId = (string) Str::uuid();
        $partPayload = [
            'inventoryItemId' => $item->id,
            'clientMutationId' => $mutationId,
            'quantity' => '2.000',
        ];

        $first = $this->postJson("/api/v1/work-orders/{$id}/parts", $partPayload, ['If-Match' => '"3"'])
            ->assertCreated()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 4)
            ->assertJsonPath('partUsage.inventoryItemId', $item->id)
            ->assertJsonPath('partUsage.clientMutationId', $mutationId)
            ->assertJsonPath('partUsage.quantity', 2)
            ->assertJsonPath('meta.replayed', false);

        $transactionId = (string) $first->json('partUsage.inventoryTransactionId');

        $this->assertDatabaseHas('inventory_transactions', [
            'id' => $transactionId,
            'inventory_item_id' => $item->id,
            'kind' => 'issue',
            'source_type' => 'work_order',
            'source_id' => $id,
        ]);
        $this->assertDatabaseHas('work_order_part_usages', [
            'work_order_id' => $id,
            'inventory_transaction_id' => $transactionId,
            'client_mutation_id' => $mutationId,
        ]);
        $this->assertSame('3.000', $item->fresh()->on_hand_quantity);
        $this->assertSame(4, WorkOrder::query()->findOrFail($id)->version);

        $replay = $this->postJson("/api/v1/work-orders/{$id}/parts", $partPayload, ['If-Match' => '"3"'])
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('partUsage.inventoryTransactionId', $transactionId)
            ->assertJsonPath('meta.replayed', true);

        $this->assertSame($transactionId, $replay->json('partUsage.inventoryTransactionId'));
        $this->assertDatabaseCount('work_order_part_usages', 1);
        $this->assertSame(1, InventoryTransaction::query()->where('source_type', 'work_order')->where('source_id', $id)->count());
        $this->assertSame('3.000', $item->fresh()->on_hand_quantity);
        $this->assertSame(4, WorkOrder::query()->findOrFail($id)->version);

        $this->postJson("/api/v1/work-orders/{$id}/parts", [
            ...$partPayload,
            'quantity' => '1.000',
        ], ['If-Match' => '"4"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_MUTATION_REUSED');

        $this->assertSame('3.000', $item->fresh()->on_hand_quantity);
        $this->assertDatabaseCount('work_order_part_usages', 1);

        $this->authenticateWithPermissions(['work-orders.update'], $school);
        $this->postJson("/api/v1/work-orders/{$id}/parts", [
            'inventoryItemId' => $item->id,
            'clientMutationId' => (string) Str::uuid(),
            'quantity' => '1.000',
        ], ['If-Match' => '"4"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->assertDatabaseHas('work_order_events', [
            'work_order_id' => $id,
            'event_type' => 'work_order.part_issued',
        ]);
    }

    public function test_part_issue_requires_in_progress_and_usage_evidence_is_database_immutable(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.consume-stock',
            'assets.view', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);
        $item = InventoryItem::factory()->for($school)->create([
            'on_hand_quantity' => '2.000',
            'version' => 1,
        ]);

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/parts", [
            'inventoryItemId' => $item->id,
            'clientMutationId' => (string) Str::uuid(),
            'quantity' => '1.000',
        ], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_INVALID_TRANSITION');

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/waiting-part", [
            'reason' => 'Menunggu spare part',
        ], ['If-Match' => '"3"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/parts", [
            'inventoryItemId' => $item->id,
            'clientMutationId' => (string) Str::uuid(),
            'quantity' => '1.000',
        ], ['If-Match' => '"4"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_INVALID_TRANSITION');

        $this->postJson("/api/v1/work-orders/{$id}/resume", [], ['If-Match' => '"4"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/parts", [
            'inventoryItemId' => $item->id,
            'clientMutationId' => (string) Str::uuid(),
            'quantity' => '1.000',
        ], ['If-Match' => '"5"'])->assertCreated();

        $usage = WorkOrderPartUsage::query()->sole();
        try {
            $usage->update(['quantity' => '9.000']);
            $this->fail('Expected WorkOrderPartUsage update to be rejected.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        $usage->delete();
    }

    public function test_database_rejects_part_usage_that_does_not_match_inventory_source_evidence(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.consume-stock',
            'assets.view', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);
        $item = InventoryItem::factory()->for($school)->create([
            'on_hand_quantity' => '2.000',
            'version' => 1,
        ]);

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');
        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();

        $response = $this->postJson("/api/v1/work-orders/{$id}/parts", [
            'inventoryItemId' => $item->id,
            'clientMutationId' => (string) Str::uuid(),
            'quantity' => '1.000',
        ], ['If-Match' => '"3"'])->assertCreated();

        $usage = WorkOrderPartUsage::query()->findOrFail((string) $response->json('partUsage.id'));
        $transaction = InventoryTransaction::query()->findOrFail($usage->inventory_transaction_id);

        try {
            WorkOrderPartUsage::query()->create([
                'school_id' => $school->id,
                'work_order_id' => $id,
                'inventory_transaction_id' => $transaction->id,
                'inventory_item_id' => $transaction->inventory_item_id,
                'client_mutation_id' => (string) Str::uuid(),
                'item_code_snapshot' => $transaction->item_code_snapshot,
                'item_name_snapshot' => $transaction->item_name_snapshot,
                'unit_snapshot' => $transaction->unit_snapshot,
                'quantity' => $transaction->quantity,
                'actor_user_id' => $membership->user_id,
                'actor_membership_id' => $membership->id,
                'actor_user_id_snapshot' => $transaction->actor_user_id_snapshot,
                'actor_membership_id_snapshot' => $transaction->actor_membership_id_snapshot,
                'actor_name_snapshot' => $transaction->actor_name_snapshot,
                'used_at' => now(),
                'created_at' => now(),
            ]);
            $this->fail('Expected DB source-evidence validation to reject mismatched clientMutationId.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->assertDatabaseCount('work_order_part_usages', 1);
    }

    public function test_verification_applies_asset_condition_through_asset_authority_and_releases_custody(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.approve',
            'assets.view', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
            'version' => 1,
        ]);

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan berhasil diisolasi',
            'actionTaken' => 'Komponen diperbaiki dan diuji',
            'conditionAfter' => 'good',
            'testResult' => 'Semua fungsi lulus',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 4);

        $this->assertSame('major_damage', $asset->fresh()->condition);
        $this->assertSame(1, $asset->fresh()->version);

        $this->postJson("/api/v1/work-orders/{$id}/verify", [], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.status', 'verified')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.conditionAfter', 'good')
            ->assertJsonPath('data.version', 5);

        $asset->refresh();
        $this->assertSame('good', $asset->condition);
        $this->assertSame(2, $asset->version);

        $assetEvent = AssetChangeEvent::query()
            ->where('asset_id', $asset->id)
            ->where('event_type', 'asset.work_order_condition_updated')
            ->latest('created_at')
            ->firstOrFail();

        $this->assertSame($id, $assetEvent->changes['workOrderId']['after'] ?? null);
        $this->assertSame('major_damage', $assetEvent->changes['condition']['before'] ?? null);
        $this->assertSame('good', $assetEvent->changes['condition']['after'] ?? null);

        $this->assertDatabaseHas('work_order_events', [
            'work_order_id' => $id,
            'event_type' => 'work_order.verified',
            'after_status' => 'verified',
        ]);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'available')
            ->assertJsonCount(0, 'data.provenance.workOrderCustodies');
    }

    public function test_verification_fails_closed_on_asset_version_drift_without_partial_commit(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.approve',
            'assets.view', 'assets.update', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
            'version' => 1,
        ]);

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();
        $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan utama',
            'actionTaken' => 'Perbaikan corrective selesai',
            'conditionAfter' => 'good',
        ], ['If-Match' => '"3"'])->assertOk();

        $this->patchJson('/api/v1/assets/'.$asset->id, [
            'notes' => 'Concurrent administrative Asset edit',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.version', 2);

        $this->postJson("/api/v1/work-orders/{$id}/verify", [], ['If-Match' => '"4"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_ASSET_VERSION_DRIFT');

        $workOrder = WorkOrder::query()->findOrFail($id);
        $this->assertSame('completed', $workOrder->status);
        $this->assertTrue($workOrder->custody_active);
        $this->assertNull($workOrder->verified_at);

        $asset->refresh();
        $this->assertSame('major_damage', $asset->condition);
        $this->assertSame(2, $asset->version);
        $this->assertSame(0, AssetChangeEvent::query()
            ->where('asset_id', $asset->id)
            ->where('event_type', 'asset.work_order_condition_updated')
            ->count());
    }

    public function test_database_guards_start_evidence_and_allows_only_live_event_fk_cleanup(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update', 'work-orders.assign',
            'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);

        $created = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))->assertCreated();
        $id = (string) $created->json('data.id');

        try {
            WorkOrder::query()->whereKey($id)->update(['status' => 'assigned']);
            $this->fail('Expected DB assignment-evidence guard to reject assigned Work Order without assignee snapshots.');
        } catch (QueryException) {
        }

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        try {
            WorkOrder::query()->whereKey($id)->update([
                'status' => 'in_progress',
                'custody_active' => true,
            ]);
            $this->fail('Expected DB start-evidence guard to reject impossible active Work Order custody.');
        } catch (QueryException) {
        }

        $workOrder = WorkOrder::query()->findOrFail($id);
        $this->assertSame('assigned', $workOrder->status);
        $this->assertFalse($workOrder->custody_active);

        $event = WorkOrderEvent::query()
            ->where('work_order_id', $id)
            ->where('event_type', 'work_order.created')
            ->firstOrFail();

        $userSnapshot = $event->actor_user_id_snapshot;
        $membershipSnapshot = $event->actor_membership_id_snapshot;
        $nameSnapshot = $event->actor_name_snapshot;

        $event->update([
            'actor_user_id' => null,
            'actor_membership_id' => null,
        ]);
        $event->refresh();

        $this->assertNull($event->actor_user_id);
        $this->assertNull($event->actor_membership_id);
        $this->assertSame($userSnapshot, $event->actor_user_id_snapshot);
        $this->assertSame($membershipSnapshot, $event->actor_membership_id_snapshot);
        $this->assertSame($nameSnapshot, $event->actor_name_snapshot);

        $partialAsset = Asset::factory()->for($school)->create(['condition' => 'minor_damage']);
        $partial = $this->postJson('/api/v1/work-orders', $this->payload($partialAsset, $lab, [
            'problemSummary' => 'Cancelled evidence consistency proof',
        ]))->assertCreated();
        $partialId = (string) $partial->json('data.id');

        try {
            WorkOrder::query()->whereKey($partialId)->update([
                'status' => 'cancelled',
                'cancel_reason' => 'Invalid partial start evidence',
                'cancelled_at' => now(),
                'started_at' => now(),
            ]);
            $this->fail('Expected DB cancelled start-evidence guard to reject partial evidence.');
        } catch (QueryException) {
        }

        try {
            $event->update(['event_type' => 'work_order.tampered']);
            $this->fail('Expected immutable Work Order event evidence to reject mutation.');
        } catch (QueryException) {
        }
    }

    /** @param list<string> $permissions @return array{User,School,SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $school ??= School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        if ($permissions !== []) {
            $role = Role::factory()->create();
            $permissionIds = collect($permissions)->unique()->values()->map(fn (string $key): string => Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key],
            )->id);
            $membership->roles()->attach($role->id);
            $role->permissions()->attach($permissionIds);
        }

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    private function payload(Asset $asset, Laboratory $lab, array $overrides = []): array
    {
        return array_merge([
            'assetId' => $asset->id,
            'laboratoryId' => $lab->id,
            'problemSummary' => 'Perbaikan corrective Asset',
            'priority' => 'high',
            'scheduledFor' => now()->addDay()->toDateString(),
            'notes' => 'S5.2 API test',
        ], $overrides);
    }
}
