<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Device;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\LoanItem;
use App\Models\MaintenanceExecution;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class S4ReconciliationApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_operational_state_is_read_only_derived_and_school_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view', 'assets.update']);
        $asset = $this->asset($school, ['condition' => 'good']);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'available')
            ->assertJsonPath('data.integrityCode', null)
            ->assertJsonPath('data.provenance.asset.lifecycleStatus', 'active')
            ->assertJsonPath('data.provenance.asset.condition', 'good')
            ->assertJsonCount(0, 'data.provenance.loanCustodies')
            ->assertJsonCount(0, 'data.provenance.maintenanceCustodies');

        $this->patchJson(
            '/api/v1/assets/'.$asset->id,
            ['operationalState' => 'on_loan'],
            ['If-Match' => '"1"'],
        )
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $asset->update(['condition' => 'moderate_damage']);
        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'blocked_condition');

        $asset->update(['lifecycle_status' => 'retired']);
        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'retired');

        $asset->update(['lifecycle_status' => 'disposed']);
        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'disposed');

        $other = $this->asset(School::factory()->create());
        $this->getJson('/api/v1/assets/'.$other->id.'/operational-state')
            ->assertNotFound()
            ->assertJsonPath('code', 'ASSET_NOT_FOUND');
    }

    public function test_projection_derives_on_loan_and_in_maintenance_from_exact_custody(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view',
            'loans.create', 'loans.approve', 'loans.checkout',
            'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
        ]);

        $loanAsset = $this->asset($school, ['asset_code' => 'AST-S4-LOAN']);
        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($loanAsset->id))->assertCreated();
        $loanId = (string) $loan->json('data.id');
        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $checkout = $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        $this->getJson('/api/v1/assets/'.$loanAsset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'on_loan')
            ->assertJsonPath('data.provenance.loanCustodies.0.loanId', $loanId)
            ->assertJsonPath('data.provenance.loanCustodies.0.loanItemId', $checkout->json('data.items.0.id'))
            ->assertJsonPath('data.provenance.loanCustodies.0.status', 'checked_out');

        $maintenanceAsset = $this->asset($school, ['asset_code' => 'AST-S4-MAINT']);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($maintenanceAsset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])->assertOk();

        $this->getJson('/api/v1/assets/'.$maintenanceAsset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'in_maintenance')
            ->assertJsonPath('data.provenance.maintenanceCustodies.0.executionId', $executionId)
            ->assertJsonPath('data.provenance.maintenanceCustodies.0.status', 'in_progress');
    }

    public function test_projection_surfaces_conflicting_cross_domain_custody_as_unknown(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view',
            'loans.create', 'loans.approve', 'loans.checkout',
            'maintenance.create-plan', 'maintenance.schedule',
        ]);
        $asset = $this->asset($school);

        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($asset->id))->assertCreated();
        $loanId = (string) $loan->json('data.id');
        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        MaintenanceExecution::query()->whereKey($execution->json('data.id'))->update([
            'status' => 'in_progress',
            'condition_before' => $asset->condition,
            'asset_version_at_start' => $asset->version,
            'custody_active' => true,
            'started_at' => now(),
            'version' => 2,
        ]);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'unknown')
            ->assertJsonPath('data.integrityCode', 'CONFLICTING_ACTIVE_CUSTODY')
            ->assertJsonCount(1, 'data.provenance.loanCustodies')
            ->assertJsonCount(1, 'data.provenance.maintenanceCustodies');
    }

    public function test_asset_retire_and_unlink_fail_closed_while_loan_or_maintenance_custody_is_active(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'assets.link-device', 'assets.retire',
            'loans.create', 'loans.approve', 'loans.checkout',
            'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
        ]);

        $device = Device::factory()->for($school)->create(['lifecycle_status' => 'in_service']);
        $loanAsset = $this->asset($school, ['linked_device_id' => $device->id]);
        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($loanAsset->id))->assertCreated();
        $loanId = (string) $loan->json('data.id');
        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson(
            '/api/v1/assets/'.$loanAsset->id.'/device-unlink',
            ['reason' => 'Unsafe while borrowed'],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_ACTIVE_CUSTODY_CONFLICT');

        $this->postJson(
            '/api/v1/assets/'.$loanAsset->id.'/retire',
            ['reason' => 'Unsafe while borrowed'],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_ACTIVE_CUSTODY_CONFLICT');

        $maintenanceAsset = $this->asset($school, ['asset_code' => 'AST-CUST-MAINT']);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($maintenanceAsset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $this->postJson(
            '/api/v1/maintenance-executions/'.$execution->json('data.id').'/start',
            [],
            ['If-Match' => '"1"'],
        )->assertOk();

        $this->postJson(
            '/api/v1/assets/'.$maintenanceAsset->id.'/retire',
            ['reason' => 'Unsafe while maintained'],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_ACTIVE_CUSTODY_CONFLICT');
    }

    public function test_historical_snapshots_survive_master_changes_and_inventory_ledger_reconstructs_balance(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'assets.update',
            'loans.create',
            'maintenance.create-plan', 'maintenance.schedule',
            'stock.create', 'stock.update', 'stock.transact',
        ]);

        $asset = $this->asset($school, ['asset_code' => 'AST-HISTORY', 'name' => 'Asset Lama']);
        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($asset->id))->assertCreated();
        $loanItemId = (string) $loan->json('data.items.0.id');

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');

        $item = $this->postJson('/api/v1/stock-items', [
            'itemCode' => 'STK-HISTORY',
            'name' => 'Spare Lama',
            'category' => 'Spare Part',
            'unit' => 'pcs',
            'minimumStock' => 0,
        ])->assertCreated();
        $itemId = (string) $item->json('data.id');

        $this->postJson('/api/v1/stock-transactions', [
            'inventoryItemId' => $itemId,
            'clientMutationId' => (string) Str::uuid(),
            'kind' => 'opening',
            'quantity' => '3.000',
            'reason' => 'Opening S4 reconciliation',
        ])->assertCreated();
        $this->postJson('/api/v1/stock-transactions', [
            'inventoryItemId' => $itemId,
            'clientMutationId' => (string) Str::uuid(),
            'kind' => 'issue',
            'quantity' => '1.000',
            'reason' => 'Issue S4 reconciliation',
        ])->assertCreated();

        $this->patchJson(
            '/api/v1/assets/'.$asset->id,
            ['name' => 'Asset Baru'],
            ['If-Match' => '"1"'],
        )->assertOk();

        $this->patchJson(
            '/api/v1/stock-items/'.$itemId,
            ['name' => 'Spare Baru'],
            ['If-Match' => '"3"'],
        )->assertOk();

        $this->assertSame('Asset Lama', LoanItem::query()->findOrFail($loanItemId)->asset_name_snapshot);
        $this->assertSame('Asset Lama', MaintenanceExecution::query()->findOrFail($executionId)->asset_name_snapshot);

        $transactions = InventoryTransaction::query()
            ->where('inventory_item_id', $itemId)
            ->orderBy('created_at')
            ->get();
        $this->assertCount(2, $transactions);
        $this->assertTrue($transactions->every(fn (InventoryTransaction $tx): bool => $tx->item_name_snapshot === 'Spare Lama'));

        $signedMilli = $transactions->sum(fn (InventoryTransaction $tx): int => $this->toMilli($tx->signed_delta));
        $current = InventoryItem::query()->findOrFail($itemId);
        $this->assertSame($this->toMilli($current->on_hand_quantity), $signedMilli);
        $this->assertSame('2.000', $current->on_hand_quantity);
    }

    /** @param list<string> $permissions @return array{User,School,SchoolMembership} */
    private function authenticateWithPermissions(array $permissions): array
    {
        $user = User::factory()->create();
        $school = School::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        $role = Role::factory()->create();
        $permissionIds = collect($permissions)->unique()->values()->map(fn (string $key): string => Permission::query()->firstOrCreate(
            ['key' => $key],
            ['name' => $key],
        )->id);
        $membership->roles()->attach($role->id);
        $role->permissions()->attach($permissionIds);
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @param array<string,mixed> $overrides */
    private function asset(School $school, array $overrides = []): Asset
    {
        return Asset::factory()->for($school)->create([
            'condition' => 'good',
            'lifecycle_status' => 'active',
            ...$overrides,
        ]);
    }

    /** @return array<string,mixed> */
    private function loanPayload(string $assetId): array
    {
        return [
            'borrowerName' => 'S4 Reconciliation Borrower',
            'purpose' => 'S4 reconciliation proof',
            'requestedReturnAt' => now()->addDay()->toISOString(),
            'assetIds' => [$assetId],
        ];
    }

    /** @return array<string,mixed> */
    private function planPayload(string $assetId): array
    {
        return [
            'assetId' => $assetId,
            'name' => 'S4 Preventive Proof',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Check one', 'Check two'],
            'assignedTechnicianName' => 'S4 Technician',
            'nextDueDate' => now()->addWeek()->toDateString(),
        ];
    }

    private function schedule(string $planId, int $version)
    {
        return $this->postJson("/api/v1/maintenance-plans/{$planId}/executions", [
            'scheduledFor' => now()->toDateString(),
            'technicianName' => 'S4 Technician',
        ], ['If-Match' => '"'.$version.'"']);
    }

    private function toMilli(mixed $value): int
    {
        $text = number_format((float) $value, 3, '.', '');

        return (int) str_replace('.', '', $text);
    }
}
