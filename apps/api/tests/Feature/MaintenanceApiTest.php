<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetChangeEvent;
use App\Models\Device;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Loan;
use App\Models\MaintenanceEvent;
use App\Models\MaintenanceExecution;
use App\Models\MaintenancePlan;
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

class MaintenanceApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/maintenance-plans')->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/maintenance-plans')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_plan_creation_requires_asset_view_permission_for_exact_asset_selection(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view', 'maintenance.create-plan']);
        $asset = $this->asset($school);

        $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->assertDatabaseCount('maintenance_plans', 0);
    }

    public function test_plan_creation_binds_one_exact_school_asset_and_writes_history(): void
    {
        [$user, $school] = $this->authenticateWithPermissions(['assets.view', 'maintenance.create-plan']);
        $asset = $this->asset($school, ['asset_code' => 'AST-PM-001', 'name' => 'Laptop Preventive']);

        $response = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.assetId', $asset->id)
            ->assertJsonPath('data.assetCodeSnapshot', 'AST-PM-001')
            ->assertJsonPath('data.assetNameSnapshot', 'Laptop Preventive')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.version', 1);

        $this->assertTrue(Str::isUlid((string) $response->json('data.id')));
        $this->assertDatabaseHas('maintenance_events', [
            'maintenance_plan_id' => $response->json('data.id'),
            'event_type' => 'maintenance_plan.created',
            'actor_user_id_snapshot' => $user->id,
        ]);

        $otherAsset = $this->asset(School::factory()->create());
        $this->postJson('/api/v1/maintenance-plans', $this->planPayload($otherAsset->id))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $retired = $this->asset($school, ['lifecycle_status' => 'retired']);
        $this->postJson('/api/v1/maintenance-plans', $this->planPayload($retired->id))
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_UNAVAILABLE');
    }

    public function test_linked_device_lifecycle_is_fail_closed_for_plan_creation_and_start(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start']);
        $device = Device::factory()->for($school)->create(['lifecycle_status' => 'decommissioned']);
        $asset = $this->asset($school, ['linked_device_id' => $device->id]);

        $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_UNAVAILABLE');

        $device->update(['lifecycle_status' => 'in_service']);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();

        $device->update(['lifecycle_status' => 'decommissioned']);
        $this->postJson(
            '/api/v1/maintenance-executions/'.$execution->json('data.id').'/start',
            [],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_UNAVAILABLE');
    }

    public function test_plan_update_requires_exact_permission_if_match_and_keeps_asset_identity_immutable(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view', 'maintenance.create-plan']);
        $asset = $this->asset($school);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $id = (string) $plan->json('data.id');

        $this->patchJson("/api/v1/maintenance-plans/{$id}", ['name' => 'Updated Plan'], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['maintenance.update-plan'], $school);
        $this->patchJson("/api/v1/maintenance-plans/{$id}", ['name' => 'Updated Plan'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->patchJson("/api/v1/maintenance-plans/{$id}", ['name' => 'Updated Plan'], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'MAINTENANCE_PLAN_VERSION_CONFLICT');

        $this->patchJson("/api/v1/maintenance-plans/{$id}", ['name' => 'Updated Plan'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.name', 'Updated Plan')
            ->assertJsonPath('data.assetId', $asset->id);

        $this->patchJson("/api/v1/maintenance-plans/{$id}", ['assetId' => (string) Str::ulid()], ['If-Match' => '"2"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_custom_interval_rules_fail_closed_on_create_and_update(): void
    {
        [, $school] = $this->authenticateWithPermissions(['assets.view', 'maintenance.create-plan', 'maintenance.update-plan']);
        $asset = $this->asset($school);

        $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id, [
            'frequencyKind' => 'custom_interval',
        ]))->assertUnprocessable();

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $this->patchJson(
            '/api/v1/maintenance-plans/'.$plan->json('data.id'),
            ['intervalDays' => 17],
            ['If-Match' => '"1"'],
        )
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->patchJson(
            '/api/v1/maintenance-plans/'.$plan->json('data.id'),
            ['frequencyKind' => 'custom_interval', 'intervalDays' => 17],
            ['If-Match' => '"1"'],
        )
            ->assertOk()
            ->assertJsonPath('data.frequencyKind', 'custom_interval')
            ->assertJsonPath('data.intervalDays', 17);
    }

    public function test_scheduling_snapshots_plan_asset_and_checklist_and_later_plan_edits_do_not_rewrite_execution(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.view', 'maintenance.create-plan', 'maintenance.update-plan', 'maintenance.schedule',
        ]);
        $asset = $this->asset($school, ['asset_code' => 'AST-SNAP']);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id, [
            'checklistTemplate' => ['Bersihkan fan', 'Cek kabel'],
        ]))->assertCreated();
        $planId = (string) $plan->json('data.id');

        $execution = $this->schedule($planId, 1, ['technicianName' => 'Teknisi Satu'])
            ->assertCreated()
            ->assertJsonPath('data.assetId', $asset->id)
            ->assertJsonPath('data.assetCodeSnapshot', 'AST-SNAP')
            ->assertJsonPath('data.checklistSnapshot.0', 'Bersihkan fan')
            ->assertJsonPath('data.technicianNameSnapshot', 'Teknisi Satu');

        $this->patchJson(
            "/api/v1/maintenance-plans/{$planId}",
            ['checklistTemplate' => ['Checklist Baru']],
            ['If-Match' => '"1"'],
        )->assertOk();

        $this->getJson('/api/v1/maintenance-executions/'.$execution->json('data.id'))
            ->assertOk()
            ->assertJsonPath('data.checklistSnapshot.0', 'Bersihkan fan')
            ->assertJsonPath('data.checklistSnapshot.1', 'Cek kabel');
    }

    public function test_maintenance_start_fails_when_asset_is_under_active_loan_custody(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
            'loans.create', 'loans.approve', 'loans.checkout',
        ]);
        $asset = $this->asset($school);

        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($asset->id))->assertCreated();
        $loanId = (string) $loan->json('data.id');
        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();

        $this->postJson(
            '/api/v1/maintenance-executions/'.$execution->json('data.id').'/start',
            [],
            ['If-Match' => '"1"'],
        )
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_UNAVAILABLE');

        $this->assertFalse(MaintenanceExecution::query()->findOrFail($execution->json('data.id'))->custody_active);
    }

    public function test_active_maintenance_custody_blocks_loan_checkout_symmetrically(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
            'loans.create', 'loans.approve', 'loans.checkout',
        ]);
        $asset = $this->asset($school);

        $loan = $this->postJson('/api/v1/loans', $this->loanPayload($asset->id))->assertCreated();
        $loanId = (string) $loan->json('data.id');
        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])->assertOk();

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $this->postJson(
            '/api/v1/maintenance-executions/'.$execution->json('data.id').'/start',
            [],
            ['If-Match' => '"1"'],
        )
            ->assertOk()
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.conditionBefore', 'good');

        $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LOAN_ASSET_UNAVAILABLE');

        $this->assertSame('approved', Loan::query()->findOrFail($loanId)->status);
    }

    public function test_database_guard_blocks_two_active_maintenance_custodies_for_one_asset(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
        ]);
        $asset = $this->asset($school);

        $planA = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id, ['name' => 'Plan A']))->assertCreated();
        $planB = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id, ['name' => 'Plan B']))->assertCreated();

        $execA = $this->schedule((string) $planA->json('data.id'), 1, ['scheduledFor' => now()->toDateString()])->assertCreated();
        $execB = $this->schedule((string) $planB->json('data.id'), 1, ['scheduledFor' => now()->addDay()->toDateString()])->assertCreated();

        $this->postJson('/api/v1/maintenance-executions/'.$execA->json('data.id').'/start', [], ['If-Match' => '"1"'])->assertOk();

        $second = MaintenanceExecution::query()->findOrFail($execB->json('data.id'));
        $this->expectException(QueryException::class);
        $second->update([
            'status' => 'in_progress',
            'condition_before' => 'good',
            'asset_version_at_start' => 1,
            'custody_active' => true,
            'started_at' => now(),
            'version' => 2,
        ]);
    }

    public function test_completion_atomically_updates_asset_condition_consumes_inventory_and_advances_plan(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
            'maintenance.complete', 'maintenance.consume-stock',
            'stock.create', 'stock.transact',
        ]);
        $asset = $this->asset($school, ['condition' => 'good', 'version' => 3]);
        $stock = $this->stockWithOpening('5.000');

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id, [
            'frequencyKind' => 'monthly',
            'nextDueDate' => now()->toDateString(),
            'checklistTemplate' => ['Bersihkan fan', 'Cek suhu'],
        ]))->assertCreated();
        $planId = (string) $plan->json('data.id');

        $execution = $this->schedule($planId, 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $started = $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.assetVersionAtStart', 3);

        $mutationId = (string) Str::uuid();
        $complete = $this->postJson("/api/v1/maintenance-executions/{$executionId}/complete", [
            'checklistResults' => [true, true],
            'findings' => 'Debu ringan.',
            'actionTaken' => 'Pembersihan preventif dan penggantian thermal pad.',
            'conditionAfter' => 'minor_damage',
            'inventoryIssues' => [[
                'inventoryItemId' => $stock->id,
                'clientMutationId' => $mutationId,
                'quantity' => 2,
            ]],
        ], ['If-Match' => '"'.$started->json('data.version').'"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.conditionBefore', 'good')
            ->assertJsonPath('data.conditionAfter', 'minor_damage')
            ->assertJsonPath('data.checklistResults.0.item', 'Bersihkan fan')
            ->assertJsonPath('data.checklistResults.0.done', true)
            ->assertJsonPath('data.inventoryTransactions.0.inventoryItemId', $stock->id)
            ->assertJsonPath('data.inventoryTransactions.0.quantity', 2);

        $asset->refresh();
        $stock->refresh();
        $planModel = MaintenancePlan::query()->findOrFail($planId);

        $this->assertSame('minor_damage', $asset->condition);
        $this->assertSame(4, $asset->version);
        $this->assertSame('3.000', $stock->on_hand_quantity);
        $this->assertSame(now()->addMonthNoOverflow()->toDateString(), $planModel->next_due_date->toDateString());
        $this->assertDatabaseHas('inventory_transactions', [
            'client_mutation_id' => $mutationId,
            'kind' => 'issue',
            'source_type' => 'maintenance_execution',
            'source_id' => $executionId,
            'balance_before' => '5.000',
            'balance_after' => '3.000',
        ]);
        $this->assertDatabaseHas('asset_change_events', [
            'asset_id' => $asset->id,
            'event_type' => 'asset.maintenance_condition_updated',
        ]);
        $this->assertDatabaseHas('maintenance_events', [
            'maintenance_execution_id' => $executionId,
            'event_type' => 'maintenance_execution.completed',
        ]);
    }

    public function test_insufficient_inventory_rolls_back_completion_asset_condition_plan_due_and_custody_release(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
            'maintenance.complete', 'maintenance.consume-stock',
            'stock.create', 'stock.transact',
        ]);
        $asset = $this->asset($school, ['condition' => 'good', 'version' => 2]);
        $stock = $this->stockWithOpening('1.000');

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $planId = (string) $plan->json('data.id');
        $dueBefore = (string) $plan->json('data.nextDueDate');
        $execution = $this->schedule($planId, 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/maintenance-executions/{$executionId}/complete", [
            'checklistResults' => [true, true],
            'actionTaken' => 'Preventive cleaning.',
            'conditionAfter' => 'minor_damage',
            'inventoryIssues' => [[
                'inventoryItemId' => $stock->id,
                'clientMutationId' => (string) Str::uuid(),
                'quantity' => 2,
            ]],
        ], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'STOCK_INSUFFICIENT');

        $executionModel = MaintenanceExecution::query()->findOrFail($executionId);
        $asset->refresh();
        $stock->refresh();
        $planModel = MaintenancePlan::query()->findOrFail($planId);

        $this->assertSame('in_progress', $executionModel->status);
        $this->assertTrue($executionModel->custody_active);
        $this->assertNull($executionModel->condition_after);
        $this->assertSame('good', $asset->condition);
        $this->assertSame(2, $asset->version);
        $this->assertSame('1.000', $stock->on_hand_quantity);
        $this->assertSame($dueBefore, $planModel->next_due_date->toDateString());
        $this->assertDatabaseMissing('maintenance_events', [
            'maintenance_execution_id' => $executionId,
            'event_type' => 'maintenance_execution.completed',
        ]);
    }

    public function test_asset_version_drift_after_start_fails_closed_before_stock_consumption(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start',
            'maintenance.complete', 'maintenance.consume-stock',
            'stock.create', 'stock.transact',
        ]);
        $asset = $this->asset($school, ['version' => 1]);
        $stock = $this->stockWithOpening('5.000');

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])->assertOk();

        Asset::query()->whereKey($asset->id)->update(['version' => 2]);

        $this->postJson("/api/v1/maintenance-executions/{$executionId}/complete", [
            'checklistResults' => [true, true],
            'actionTaken' => 'Preventive cleaning.',
            'conditionAfter' => 'good',
            'inventoryIssues' => [[
                'inventoryItemId' => $stock->id,
                'clientMutationId' => (string) Str::uuid(),
                'quantity' => 1,
            ]],
        ], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_VERSION_CONFLICT');

        $stock->refresh();
        $this->assertSame('5.000', $stock->on_hand_quantity);
        $this->assertSame('in_progress', MaintenanceExecution::query()->findOrFail($executionId)->status);
    }

    public function test_spare_part_consumption_requires_explicit_maintenance_permission(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start', 'maintenance.complete',
            'stock.create', 'stock.transact',
        ]);
        $asset = $this->asset($school);
        $stock = $this->stockWithOpening('2.000');

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/maintenance-executions/{$executionId}/complete", [
            'checklistResults' => [true, true],
            'actionTaken' => 'Preventive cleaning.',
            'conditionAfter' => 'good',
            'inventoryIssues' => [[
                'inventoryItemId' => $stock->id,
                'clientMutationId' => (string) Str::uuid(),
                'quantity' => 1,
            ]],
        ], ['If-Match' => '"2"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'MAINTENANCE_STOCK_PERMISSION_REQUIRED');

        $stock->refresh();
        $this->assertSame('2.000', $stock->on_hand_quantity);
    }

    public function test_cancel_requires_reason_and_releases_in_progress_custody_without_mutating_asset(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule', 'maintenance.start', 'maintenance.cancel',
        ]);
        $asset = $this->asset($school, ['condition' => 'minor_damage', 'version' => 4]);

        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $execution = $this->schedule((string) $plan->json('data.id'), 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');
        $this->postJson("/api/v1/maintenance-executions/{$executionId}/start", [], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/maintenance-executions/{$executionId}/cancel", [], ['If-Match' => '"2"'])
            ->assertUnprocessable();

        $this->postJson(
            "/api/v1/maintenance-executions/{$executionId}/cancel",
            ['reason' => 'Jadwal operasional berubah'],
            ['If-Match' => '"2"'],
        )
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.conditionBefore', 'minor_damage')
            ->assertJsonPath('data.conditionAfter', null);

        $asset->refresh();
        $this->assertSame('minor_damage', $asset->condition);
        $this->assertSame(4, $asset->version);
    }

    public function test_maintenance_history_and_captured_identity_are_database_protected_and_no_hard_delete_routes_exist(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'assets.view', 'maintenance.create-plan', 'maintenance.schedule',
        ]);
        $asset = $this->asset($school);
        $plan = $this->postJson('/api/v1/maintenance-plans', $this->planPayload($asset->id))->assertCreated();
        $planId = (string) $plan->json('data.id');
        $execution = $this->schedule($planId, 1)->assertCreated();
        $executionId = (string) $execution->json('data.id');

        $planModel = MaintenancePlan::query()->findOrFail($planId);
        try {
            $planModel->update(['asset_id' => $this->asset($school)->id]);
            $this->fail('Expected MaintenancePlan identity to be immutable.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $executionModel = MaintenanceExecution::query()->findOrFail($executionId);
        try {
            $executionModel->update(['asset_code_snapshot' => 'TAMPERED']);
            $this->fail('Expected MaintenanceExecution captured identity to be immutable.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $event = MaintenanceEvent::query()->where('maintenance_execution_id', $executionId)->firstOrFail();
        try {
            $event->update(['payload' => ['tampered' => true]]);
            $this->fail('Expected MaintenanceEvent to be immutable.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->deleteJson("/api/v1/maintenance-plans/{$planId}")->assertStatus(405);
        $this->deleteJson("/api/v1/maintenance-executions/{$executionId}")->assertStatus(405);

        $this->expectException(QueryException::class);
        $executionModel->delete();
    }

    public function test_maintenance_routes_use_server_permissions_and_version_preconditions(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/maintenance-'))
            ->values();

        $this->assertCount(12, $routes);
        $map = $routes->mapWithKeys(fn ($route): array => [
            implode(',', $route->methods()).' '.$route->uri() => $route->gatherMiddleware(),
        ]);

        $this->assertContains('permission:maintenance.view', $map->first(fn ($mw, $key) => str_contains($key, 'GET,HEAD api/v1/maintenance-plans')));
        $this->assertContains('permission:maintenance.create-plan', $map->first(fn ($mw, $key) => $key === 'POST api/v1/maintenance-plans'));
        $this->assertContains('permission:maintenance.update-plan', $map->first(fn ($mw, $key) => str_contains($key, 'PATCH api/v1/maintenance-plans/{planId}')));
        $this->assertContains('permission:maintenance.schedule', $map->first(fn ($mw, $key) => str_contains($key, '/executions')));
        $this->assertContains('permission:maintenance.start', $map->first(fn ($mw, $key) => str_contains($key, '/start')));
        $this->assertContains('permission:maintenance.complete', $map->first(fn ($mw, $key) => str_contains($key, '/complete')));
        $this->assertContains('permission:maintenance.cancel', $map->first(fn ($mw, $key) => str_contains($key, '/cancel')));
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

    /** @param array<string,mixed> $overrides */
    private function asset(School $school, array $overrides = []): Asset
    {
        return Asset::factory()->for($school)->create([
            'condition' => 'good',
            'lifecycle_status' => 'active',
            ...$overrides,
        ]);
    }

    /** @param array<string,mixed> $overrides @return array<string,mixed> */
    private function planPayload(string $assetId, array $overrides = []): array
    {
        return [
            'assetId' => $assetId,
            'name' => 'Preventive Laptop',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Bersihkan fan', 'Cek kabel'],
            'assignedTechnicianName' => 'Andi Teknisi',
            'nextDueDate' => now()->addDays(7)->toDateString(),
            ...$overrides,
        ];
    }

    private function schedule(string $planId, int $planVersion, array $overrides = [])
    {
        return $this->postJson("/api/v1/maintenance-plans/{$planId}/executions", [
            'scheduledFor' => now()->toDateString(),
            'technicianName' => 'Andi Teknisi',
            ...$overrides,
        ], ['If-Match' => '"'.$planVersion.'"']);
    }

    /** @return array<string,mixed> */
    private function loanPayload(string $assetId): array
    {
        return [
            'borrowerName' => 'Budi Santoso',
            'borrowerUnit' => 'XI PPLG 1',
            'purpose' => 'Praktikum',
            'requestedReturnAt' => now()->addDay()->toISOString(),
            'assetIds' => [$assetId],
        ];
    }

    private function stockWithOpening(string $quantity): InventoryItem
    {
        $item = $this->postJson('/api/v1/stock-items', [
            'itemCode' => 'SP-'.strtoupper(substr((string) Str::ulid(), -8)),
            'name' => 'Thermal Pad',
            'category' => 'Spare Part',
            'unit' => 'pcs',
            'minimumStock' => 0,
        ])->assertCreated();

        $id = (string) $item->json('data.id');
        $this->postJson('/api/v1/stock-transactions', [
            'inventoryItemId' => $id,
            'clientMutationId' => (string) Str::uuid(),
            'kind' => 'opening',
            'quantity' => $quantity,
            'reason' => 'Saldo awal pengujian maintenance',
        ])->assertCreated();

        return InventoryItem::query()->findOrFail($id);
    }
}
