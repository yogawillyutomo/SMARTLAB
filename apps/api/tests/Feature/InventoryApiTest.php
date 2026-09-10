<?php

namespace Tests\Feature;

use App\Models\InventoryItem;
use App\Models\InventoryItemChangeEvent;
use App\Models\InventoryTransaction;
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

class InventoryApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/stock-items')->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/stock-items')->assertStatus(409)->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_item_create_derives_school_zeroes_balance_and_writes_history(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['stock.create']);

        $response = $this->postJson('/api/v1/stock-items', $this->validItemPayload([
            'itemCode' => ' stk-0001 ',
            'minimumStock' => 2,
            'unitPriceSnapshot' => 650000,
        ]))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.itemCode', 'STK-0001')
            ->assertJsonPath('data.minimumStock', 2)
            ->assertJsonPath('data.unitPriceSnapshot', 650000)
            ->assertJsonPath('data.onHandQuantity', 0)
            ->assertJsonPath('data.version', 1);

        $this->assertDatabaseHas('inventory_items', [
            'id' => $response->json('data.id'),
            'school_id' => $school->id,
            'item_code' => 'STK-0001',
        ]);
        $this->assertDatabaseHas('inventory_item_change_events', [
            'inventory_item_id' => $response->json('data.id'),
            'actor_user_id' => $user->id,
            'actor_membership_id' => $membership->id,
            'event_type' => 'inventory_item.created',
        ]);
        $this->assertDatabaseCount('inventory_transactions', 0);
    }

    public function test_create_and_patch_reject_direct_balance_or_identity_control(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.create', 'stock.update']);

        $this->postJson('/api/v1/stock-items', $this->validItemPayload(['onHandQuantity' => 100]))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $item = InventoryItem::factory()->for($school)->create();

        foreach ([
            ['itemCode' => 'NEW-CODE'],
            ['onHandQuantity' => 10],
            ['schoolId' => $school->id],
            ['version' => 2],
        ] as $payload) {
            $this->patchJson('/api/v1/stock-items/'.$item->id, $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->assertSame('0.000', $item->fresh()->on_hand_quantity);
    }

    public function test_list_and_show_are_exact_school_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.view']);
        $mine = InventoryItem::factory()->for($school)->create(['item_code' => 'STK-MINE']);
        $other = InventoryItem::factory()->create(['item_code' => 'STK-OTHER']);

        $this->getJson('/api/v1/stock-items')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $mine->id);

        $this->getJson('/api/v1/stock-items/'.$other->id)
            ->assertNotFound()
            ->assertExactJson(['message' => 'Inventory item not found.', 'code' => 'STOCK_ITEM_NOT_FOUND']);
    }

    public function test_metadata_patch_requires_permission_and_if_match(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.view']);
        $item = InventoryItem::factory()->for($school)->create(['name' => 'Before']);

        $this->patchJson('/api/v1/stock-items/'.$item->id, ['name' => 'After'], ['If-Match' => '"1"'])
            ->assertForbidden();

        $this->authenticateWithPermissions(['stock.update'], $school);

        $this->patchJson('/api/v1/stock-items/'.$item->id, ['name' => 'After'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->patchJson('/api/v1/stock-items/'.$item->id, ['name' => 'After'], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'STOCK_ITEM_VERSION_CONFLICT');

        $this->patchJson('/api/v1/stock-items/'.$item->id, ['name' => 'After'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.name', 'After')
            ->assertJsonPath('data.version', 2);

        $this->assertDatabaseHas('inventory_item_change_events', [
            'inventory_item_id' => $item->id,
            'event_type' => 'inventory_item.updated',
        ]);
    }


    public function test_item_metadata_requires_whole_minimum_and_rupiah_price(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.create', 'stock.update']);

        $this->postJson('/api/v1/stock-items', $this->validItemPayload(['minimumStock' => '2.500']))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->postJson('/api/v1/stock-items', $this->validItemPayload(['unitPriceSnapshot' => '650000.50']))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $item = InventoryItem::factory()->for($school)->create();
        $this->patchJson('/api/v1/stock-items/'.$item->id, ['minimumStock' => 1.5], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->patchJson('/api/v1/stock-items/'.$item->id, ['unitPriceSnapshot' => 1000.25], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertSame('0.000', $item->fresh()->minimum_stock);
        $this->assertNull($item->fresh()->unit_price_snapshot);
    }

    public function test_discrete_normal_movements_require_whole_quantities_but_adjustments_can_reconcile_residue(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create(['unit' => 'pcs']);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'opening', '8.000'))
            ->assertCreated()
            ->assertJsonPath('data.balanceAfter', 8);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '0.001'))
            ->assertStatus(422)
            ->assertJsonPath('code', 'STOCK_DISCRETE_QUANTITY_REQUIRED');

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'adjustment_in', '0.001'))
            ->assertCreated()
            ->assertJsonPath('data.balanceAfter', 8.001);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'adjustment_out', '2.001'))
            ->assertCreated()
            ->assertJsonPath('data.balanceAfter', 6);

        $this->assertSame('6.000', $item->fresh()->on_hand_quantity);
        $this->assertDatabaseCount('inventory_transactions', 3);
    }

    public function test_fractional_receipt_and_issue_update_balance_atomically(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create(['unit' => 'meter']);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '2.750'))
            ->assertCreated()
            ->assertJsonPath('data.quantity', 2.75)
            ->assertJsonPath('data.signedDelta', 2.75)
            ->assertJsonPath('data.balanceBefore', 0)
            ->assertJsonPath('data.balanceAfter', 2.75)
            ->assertJsonPath('data.itemVersionAfter', 2)
            ->assertJsonPath('meta.replayed', false);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'issue', '0.625'))
            ->assertCreated()
            ->assertJsonPath('data.signedDelta', -0.625)
            ->assertJsonPath('data.balanceAfter', 2.125)
            ->assertJsonPath('data.itemVersionAfter', 3);

        $this->assertSame('2.125', $item->fresh()->on_hand_quantity);
        $this->assertSame(3, $item->fresh()->version);
        $this->assertDatabaseCount('inventory_transactions', 2);
    }

    public function test_insufficient_stock_rolls_back_everything(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create();

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'issue', '1.000'))
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_INSUFFICIENT');

        $item->refresh();
        $this->assertSame('0.000', $item->on_hand_quantity);
        $this->assertSame(1, $item->version);
        $this->assertDatabaseCount('inventory_transactions', 0);
    }

    public function test_same_mutation_replays_without_duplicate_balance_change(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create(['unit' => 'meter']);
        $mutationId = (string) Str::uuid();
        $payload = $this->movement($item, 'receipt', '3.500', $mutationId);

        $first = $this->postJson('/api/v1/stock-transactions', $payload)
            ->assertCreated()
            ->assertJsonPath('meta.replayed', false);

        $second = $this->postJson('/api/v1/stock-transactions', $payload)
            ->assertOk()
            ->assertJsonPath('meta.replayed', true);

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertDatabaseCount('inventory_transactions', 1);
        $this->assertSame('3.500', $item->fresh()->on_hand_quantity);
        $this->assertSame(2, $item->fresh()->version);
    }

    public function test_mutation_id_reuse_with_different_payload_is_integrity_conflict(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create();
        $mutationId = (string) Str::uuid();

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '1.000', $mutationId))
            ->assertCreated();

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '2.000', $mutationId))
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_MUTATION_REUSED');

        $this->assertDatabaseCount('inventory_transactions', 1);
        $this->assertSame('1.000', $item->fresh()->on_hand_quantity);
    }

    public function test_mutation_id_is_school_scoped_not_item_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $firstItem = InventoryItem::factory()->for($school)->create();
        $secondItem = InventoryItem::factory()->for($school)->create();
        $mutationId = (string) Str::uuid();

        $this->postJson('/api/v1/stock-transactions', $this->movement($firstItem, 'receipt', '1.000', $mutationId))
            ->assertCreated();

        $this->postJson('/api/v1/stock-transactions', $this->movement($secondItem, 'receipt', '1.000', $mutationId))
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_MUTATION_REUSED');

        $this->assertSame('0.000', $secondItem->fresh()->on_hand_quantity);
    }

    public function test_opening_is_only_allowed_as_first_zero_balance_movement(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create();

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'opening', '4.000'))
            ->assertCreated();

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'opening', '1.000'))
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_OPENING_CONFLICT');

        $this->assertSame('4.000', $item->fresh()->on_hand_quantity);
        $this->assertDatabaseCount('inventory_transactions', 1);
    }

    public function test_unit_is_locked_after_first_movement(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact', 'stock.update']);
        $item = InventoryItem::factory()->for($school)->create(['unit' => 'pcs']);

        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '1.000'))
            ->assertCreated();

        $this->patchJson('/api/v1/stock-items/'.$item->id, ['unit' => 'box'], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_UNIT_LOCKED');

        $this->assertSame('pcs', $item->fresh()->unit);
    }

    public function test_cross_school_transaction_item_is_not_disclosed(): void
    {
        $this->authenticateWithPermissions(['stock.transact']);
        $otherItem = InventoryItem::factory()->create();

        $this->postJson('/api/v1/stock-transactions', $this->movement($otherItem, 'receipt', '1.000'))
            ->assertNotFound()
            ->assertJsonPath('code', 'STOCK_ITEM_NOT_FOUND');

        $this->assertDatabaseCount('inventory_transactions', 0);
    }

    public function test_transaction_rows_are_database_immutable(): void
    {
        [, $school] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create();
        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '1.000'))->assertCreated();
        $transaction = InventoryTransaction::query()->sole();

        try {
            $transaction->update(['reason' => 'tamper']);
            $this->fail('Expected immutable InventoryTransaction update rejection.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        $transaction->delete();
    }

    public function test_actor_deletion_nulls_live_links_but_preserves_transaction_snapshots(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['stock.transact']);
        $item = InventoryItem::factory()->for($school)->create();
        $this->postJson('/api/v1/stock-transactions', $this->movement($item, 'receipt', '1.000'))->assertCreated();
        $transaction = InventoryTransaction::query()->sole();

        $userId = $user->id;
        $membershipId = $membership->id;
        $membership->delete();
        $user->delete();

        $transaction->refresh();
        $this->assertNull($transaction->actor_user_id);
        $this->assertNull($transaction->actor_membership_id);
        $this->assertSame($userId, $transaction->actor_user_id_snapshot);
        $this->assertSame($membershipId, $transaction->actor_membership_id_snapshot);
    }

    public function test_database_rejects_negative_item_balance_and_duplicate_school_item_code(): void
    {
        $school = School::factory()->create();
        InventoryItem::factory()->for($school)->create(['item_code' => 'STK-UNIQUE']);

        try {
            InventoryItem::factory()->for($school)->create(['item_code' => 'STK-UNIQUE']);
            $this->fail('Expected school-scoped item code uniqueness violation.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        try {
            InventoryItem::factory()->for($school)->create(['minimum_stock' => '0.500']);
            $this->fail('Expected whole-number minimum stock constraint.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        try {
            InventoryItem::factory()->for($school)->create(['unit_price_snapshot' => '1000.50']);
            $this->fail('Expected whole-number Rupiah price constraint.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        InventoryItem::factory()->for($school)->create(['on_hand_quantity' => '-0.001']);
    }

    public function test_stock_routes_have_exact_server_permissions_and_no_hard_delete(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/stock-'))
            ->values();

        $this->assertCount(6, $routes);

        $actual = $routes->map(fn ($route): array => [
            'methods' => $route->methods(),
            'uri' => $route->uri(),
            'middleware' => $route->gatherMiddleware(),
        ])->all();

        $this->assertSame('api/v1/stock-items', $actual[0]['uri']);
        $this->assertContains('permission:stock.view', $actual[0]['middleware']);
        $this->assertSame('api/v1/stock-items', $actual[1]['uri']);
        $this->assertContains('permission:stock.create', $actual[1]['middleware']);
        $this->assertSame('api/v1/stock-items/{itemId}', $actual[2]['uri']);
        $this->assertContains('permission:stock.view', $actual[2]['middleware']);
        $this->assertSame('api/v1/stock-items/{itemId}', $actual[3]['uri']);
        $this->assertContains('permission:stock.update', $actual[3]['middleware']);
        $this->assertSame('api/v1/stock-transactions', $actual[4]['uri']);
        $this->assertContains('permission:stock.view', $actual[4]['middleware']);
        $this->assertSame('api/v1/stock-transactions', $actual[5]['uri']);
        $this->assertContains('permission:stock.transact', $actual[5]['middleware']);

        [, $school] = $this->authenticateWithPermissions(['stock.update']);
        $item = InventoryItem::factory()->for($school)->create();
        $this->deleteJson('/api/v1/stock-items/'.$item->id)->assertStatus(405);
        $this->assertDatabaseHas('inventory_items', ['id' => $item->id]);
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
    private function validItemPayload(array $overrides = []): array
    {
        return [
            'itemCode' => 'STK-0001',
            'name' => 'RAM DDR4',
            'category' => 'Spare Part',
            'unit' => 'pcs',
            ...$overrides,
        ];
    }

    /** @return array<string, mixed> */
    private function movement(
        InventoryItem $item,
        string $kind,
        string $quantity,
        ?string $clientMutationId = null,
    ): array {
        return [
            'inventoryItemId' => $item->id,
            'clientMutationId' => $clientMutationId ?? (string) Str::uuid(),
            'kind' => $kind,
            'quantity' => $quantity,
            'reason' => 'Operational stock movement',
        ];
    }
}
