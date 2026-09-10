<?php

namespace Tests\Feature;

use App\Application\Asset\AssetMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Application\Inventory\InventoryMutationService;
use App\Application\Loan\LoanMutationService;
use App\Application\Maintenance\MaintenanceCampaignService;
use App\Application\Maintenance\MaintenanceMutationService;
use App\Application\WorkOrder\WorkOrderMutationService;
use App\Models\Asset;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Loan;
use App\Models\LoanItem;
use App\Models\MaintenanceCampaign;
use App\Models\MaintenanceCampaignEvent;
use App\Models\MaintenanceExecution;
use App\Models\Laboratory;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use App\Models\WorkOrder;
use App\Models\WorkOrderPartUsage;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;
use Throwable;

#[Group('postgres-concurrency')]
class S4PostgresConcurrencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('S4 contention proof runs only on PostgreSQL.');
        }

        if (! function_exists('pcntl_fork')) {
            $this->fail('pcntl_fork is required for the PostgreSQL S4 contention proof.');
        }
    }

    public function test_concurrent_inventory_issues_never_make_stock_negative(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $item = InventoryItem::factory()->create([
            'school_id' => $schoolId,
            'on_hand_quantity' => '0.000',
            'version' => 1,
        ]);

        app(InventoryMutationService::class)->transact(
            $this->context($membershipId, ['stock.transact']),
            User::query()->findOrFail($userId),
            [
                'inventoryItemId' => $item->id,
                'clientMutationId' => (string) Str::uuid(),
                'kind' => 'opening',
                'quantity' => '5.000',
                'reason' => 'S4 PostgreSQL contention opening',
            ],
        );

        $leftMutation = (string) Str::uuid();
        $rightMutation = (string) Str::uuid();

        $results = $this->race(
            fn () => app(InventoryMutationService::class)->transact(
                $this->context($membershipId, ['stock.transact']),
                User::query()->findOrFail($userId),
                [
                    'inventoryItemId' => $item->id,
                    'clientMutationId' => $leftMutation,
                    'kind' => 'issue',
                    'quantity' => '4.000',
                    'reason' => 'S4 concurrent issue A',
                ],
            ),
            fn () => app(InventoryMutationService::class)->transact(
                $this->context($membershipId, ['stock.transact']),
                User::query()->findOrFail($userId),
                [
                    'inventoryItemId' => $item->id,
                    'clientMutationId' => $rightMutation,
                    'kind' => 'issue',
                    'quantity' => '4.000',
                    'reason' => 'S4 concurrent issue B',
                ],
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['STOCK_INSUFFICIENT'], $this->failureCodes($results));

        $fresh = InventoryItem::query()->findOrFail($item->id);
        $this->assertSame('1.000', $fresh->on_hand_quantity);
        $this->assertGreaterThanOrEqual(0, $this->toMilli($fresh->on_hand_quantity));

        $transactions = InventoryTransaction::query()
            ->where('inventory_item_id', $item->id)
            ->orderBy('created_at')
            ->get();

        $this->assertCount(2, $transactions);
        $this->assertSame(1, $transactions->where('kind', 'issue')->count());
        $this->assertSame(
            $this->toMilli($fresh->on_hand_quantity),
            $transactions->sum(fn (InventoryTransaction $transaction): int => $this->toMilli($transaction->signed_delta)),
        );
    }

    public function test_concurrent_checkout_of_the_same_asset_allows_at_most_one_loan(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $service = app(LoanMutationService::class);
        $context = $this->context($membershipId, []);
        $actor = User::query()->findOrFail($userId);

        $first = $service->create($context, $actor, $this->loanPayload((string) $asset->id, 'Concurrent Borrower A'));
        $second = $service->create($context, $actor, $this->loanPayload((string) $asset->id, 'Concurrent Borrower B'));
        $service->approve($context, $actor, (string) $first->id, 1);
        $service->approve($context, $actor, (string) $second->id, 1);

        $results = $this->race(
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $first->id,
                2,
            ),
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $second->id,
                2,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['LOAN_ASSET_UNAVAILABLE'], $this->failureCodes($results));
        $this->assertSame(1, LoanItem::query()->where('asset_id', $asset->id)->where('custody_active', true)->count());

        $statuses = Loan::query()
            ->whereIn('id', [$first->id, $second->id])
            ->pluck('status')
            ->sort()
            ->values()
            ->all();

        $this->assertSame(['approved', 'checked_out'], $statuses);
    }

    public function test_concurrent_loan_checkout_and_maintenance_start_never_create_dual_custody(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $actor = User::query()->findOrFail($userId);
        $context = $this->context($membershipId, []);

        $loanService = app(LoanMutationService::class);
        $loan = $loanService->create($context, $actor, $this->loanPayload((string) $asset->id, 'Loan vs Maintenance'));
        $loanService->approve($context, $actor, (string) $loan->id, 1);

        $maintenanceService = app(MaintenanceMutationService::class);
        $plan = $maintenanceService->createPlan($context, $actor, [
            'assetId' => (string) $asset->id,
            'name' => 'S4 race plan',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Check custody'],
            'assignedTechnicianName' => 'S4 Technician',
            'nextDueDate' => now()->addWeek()->toDateString(),
        ]);
        $execution = $maintenanceService->scheduleExecution($context, $actor, (string) $plan->id, 1, [
            'scheduledFor' => now()->toDateString(),
            'technicianName' => 'S4 Technician',
        ]);

        $results = $this->race(
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $loan->id,
                2,
            ),
            fn () => app(MaintenanceMutationService::class)->startExecution(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $execution->id,
                1,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failureCodes = $this->failureCodes($results);
        $this->assertCount(1, $failureCodes);
        $this->assertContains($failureCodes[0], ['LOAN_ASSET_UNAVAILABLE', 'MAINTENANCE_ASSET_UNAVAILABLE']);

        $loanActive = LoanItem::query()
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->count();
        $maintenanceActive = MaintenanceExecution::query()
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->count();

        $this->assertSame(1, $loanActive + $maintenanceActive);
        $this->assertFalse($loanActive === 1 && $maintenanceActive === 1);

        $loan->refresh();
        $execution->refresh();

        if ($loanActive === 1) {
            $this->assertSame('checked_out', $loan->status);
            $this->assertSame('scheduled', $execution->status);
        } else {
            $this->assertSame('approved', $loan->status);
            $this->assertSame('in_progress', $execution->status);
        }
    }

    public function test_two_work_orders_cannot_start_corrective_custody_for_the_same_asset_concurrently(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
        ]);

        $first = $this->assignedWorkOrder($userId, $membershipId, $schoolId, (string) $asset->id, 'Race repair A');
        $second = $this->assignedWorkOrder($userId, $membershipId, $schoolId, (string) $asset->id, 'Race repair B');

        $results = $this->race(
            fn () => app(WorkOrderMutationService::class)->start(
                $this->context($membershipId, ['work-orders.assign']),
                User::query()->findOrFail($userId),
                (string) $first->id,
                1,
            ),
            fn () => app(WorkOrderMutationService::class)->start(
                $this->context($membershipId, ['work-orders.assign']),
                User::query()->findOrFail($userId),
                (string) $second->id,
                1,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['WORK_ORDER_ACTIVE_CUSTODY_CONFLICT'], $this->failureCodes($results));
        $this->assertSame(1, WorkOrder::query()->where('asset_id', $asset->id)->where('custody_active', true)->count());
    }

    public function test_concurrent_loan_checkout_and_work_order_start_never_create_dual_custody(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $actor = User::query()->findOrFail($userId);
        $context = $this->context($membershipId, []);

        $loanService = app(LoanMutationService::class);
        $loan = $loanService->create($context, $actor, $this->loanPayload((string) $asset->id, 'Loan vs Work Order'));
        $loanService->approve($context, $actor, (string) $loan->id, 1);

        $workOrder = $this->assignedWorkOrder(
            $userId,
            $membershipId,
            $schoolId,
            (string) $asset->id,
            'Loan vs corrective repair',
        );

        $results = $this->race(
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $loan->id,
                2,
            ),
            fn () => app(WorkOrderMutationService::class)->start(
                $this->context($membershipId, ['work-orders.assign']),
                User::query()->findOrFail($userId),
                (string) $workOrder->id,
                1,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failureCodes = $this->failureCodes($results);
        $this->assertCount(1, $failureCodes);
        $this->assertContains($failureCodes[0], ['LOAN_ASSET_UNAVAILABLE', 'WORK_ORDER_ACTIVE_CUSTODY_CONFLICT']);

        $loanActive = LoanItem::query()->where('asset_id', $asset->id)->where('custody_active', true)->count();
        $workOrderActive = WorkOrder::query()->where('asset_id', $asset->id)->where('custody_active', true)->count();
        $this->assertSame(1, $loanActive + $workOrderActive);
    }

    public function test_concurrent_maintenance_and_work_order_start_never_create_dual_custody(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $actor = User::query()->findOrFail($userId);
        $context = $this->context($membershipId, []);

        $maintenance = app(MaintenanceMutationService::class);
        $plan = $maintenance->createPlan($context, $actor, [
            'assetId' => (string) $asset->id,
            'name' => 'S5 race maintenance plan',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Check custody'],
            'assignedTechnicianName' => 'Race Technician',
            'nextDueDate' => now()->addWeek()->toDateString(),
        ]);
        $execution = $maintenance->scheduleExecution($context, $actor, (string) $plan->id, 1, [
            'scheduledFor' => now()->toDateString(),
            'technicianName' => 'Race Technician',
        ]);

        $workOrder = $this->assignedWorkOrder(
            $userId,
            $membershipId,
            $schoolId,
            (string) $asset->id,
            'Maintenance vs corrective repair',
        );

        $results = $this->race(
            fn () => app(MaintenanceMutationService::class)->startExecution(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $execution->id,
                1,
            ),
            fn () => app(WorkOrderMutationService::class)->start(
                $this->context($membershipId, ['work-orders.assign']),
                User::query()->findOrFail($userId),
                (string) $workOrder->id,
                1,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failureCodes = $this->failureCodes($results);
        $this->assertCount(1, $failureCodes);
        $this->assertContains($failureCodes[0], ['MAINTENANCE_ASSET_UNAVAILABLE', 'WORK_ORDER_ACTIVE_CUSTODY_CONFLICT']);

        $maintenanceActive = MaintenanceExecution::query()->where('asset_id', $asset->id)->where('custody_active', true)->count();
        $workOrderActive = WorkOrder::query()->where('asset_id', $asset->id)->where('custody_active', true)->count();
        $this->assertSame(1, $maintenanceActive + $workOrderActive);
    }

    public function test_concurrent_work_order_part_issues_never_make_stock_negative(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $firstAsset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
        ]);
        $secondAsset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
        ]);
        $item = InventoryItem::factory()->create([
            'school_id' => $schoolId,
            'on_hand_quantity' => '5.000',
            'version' => 1,
        ]);

        $first = $this->assignedWorkOrder($userId, $membershipId, $schoolId, (string) $firstAsset->id, 'Part race repair A');
        $second = $this->assignedWorkOrder($userId, $membershipId, $schoolId, (string) $secondAsset->id, 'Part race repair B');

        $service = app(WorkOrderMutationService::class);
        $actor = User::query()->findOrFail($userId);
        $service->start($this->context($membershipId, ['work-orders.assign']), $actor, (string) $first->id, 1);
        $service->start($this->context($membershipId, ['work-orders.assign']), $actor, (string) $second->id, 1);

        $results = $this->race(
            fn () => app(WorkOrderMutationService::class)->issuePart(
                $this->context($membershipId, ['work-orders.assign', 'work-orders.consume-stock']),
                User::query()->findOrFail($userId),
                (string) $first->id,
                2,
                [
                    'inventoryItemId' => (string) $item->id,
                    'clientMutationId' => (string) Str::uuid(),
                    'quantity' => '4.000',
                ],
            ),
            fn () => app(WorkOrderMutationService::class)->issuePart(
                $this->context($membershipId, ['work-orders.assign', 'work-orders.consume-stock']),
                User::query()->findOrFail($userId),
                (string) $second->id,
                2,
                [
                    'inventoryItemId' => (string) $item->id,
                    'clientMutationId' => (string) Str::uuid(),
                    'quantity' => '4.000',
                ],
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['STOCK_INSUFFICIENT'], $this->failureCodes($results));
        $this->assertSame('1.000', InventoryItem::query()->findOrFail($item->id)->on_hand_quantity);
        $this->assertSame(1, InventoryTransaction::query()->where('source_type', 'work_order')->count());
        $this->assertSame(1, WorkOrderPartUsage::query()->count());
    }

    public function test_concurrent_work_order_verify_and_asset_mutation_fail_closed_without_partial_commit(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
            'version' => 1,
        ]);

        $workOrder = $this->assignedWorkOrder(
            $userId,
            $membershipId,
            $schoolId,
            (string) $asset->id,
            'Verify vs Asset mutation race',
        );

        $service = app(WorkOrderMutationService::class);
        $actor = User::query()->findOrFail($userId);
        $service->start(
            $this->context($membershipId, ['work-orders.assign']),
            $actor,
            (string) $workOrder->id,
            1,
        );
        $service->complete(
            $this->context($membershipId, ['work-orders.assign']),
            $actor,
            (string) $workOrder->id,
            2,
            [
                'diagnosis' => 'Concurrent verification proof',
                'actionTaken' => 'Corrective action complete',
                'conditionAfter' => 'good',
            ],
        );

        $results = $this->race(
            fn () => app(WorkOrderMutationService::class)->verify(
                $this->context($membershipId, ['work-orders.approve']),
                User::query()->findOrFail($userId),
                (string) $workOrder->id,
                3,
            ),
            fn () => app(AssetMutationService::class)->update(
                $this->context($membershipId, []),
                (string) $asset->id,
                1,
                ['notes' => 'Concurrent Asset mutation won'],
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failureCodes = $this->failureCodes($results);
        $this->assertCount(1, $failureCodes);
        $this->assertContains($failureCodes[0], ['WORK_ORDER_ASSET_VERSION_DRIFT', 'ASSET_VERSION_CONFLICT']);

        $workOrder->refresh();
        $asset->refresh();

        if ($workOrder->status === 'verified') {
            $this->assertFalse($workOrder->custody_active);
            $this->assertSame('good', $asset->condition);
            $this->assertSame(2, $asset->version);
            $this->assertNotNull($workOrder->verified_at);
        } else {
            $this->assertSame('completed', $workOrder->status);
            $this->assertTrue($workOrder->custody_active);
            $this->assertSame('major_damage', $asset->condition);
            $this->assertSame('Concurrent Asset mutation won', $asset->notes);
            $this->assertSame(2, $asset->version);
            $this->assertNull($workOrder->verified_at);
        }
    }

    public function test_concurrent_campaign_batch_schedule_allows_only_one_same_version_batch(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $lab = Laboratory::factory()->create([
            'school_id' => $schoolId,
            'status' => 'active',
        ]);
        $assets = collect(range(1, 3))->map(fn (int $index) => Asset::factory()->create([
            'school_id' => $schoolId,
            'asset_code' => 'RACE-CAMP-00'.$index,
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]));

        $service = app(MaintenanceCampaignService::class);
        $campaign = $service->create(
            $this->context($membershipId, []),
            User::query()->findOrFail($userId),
            [
                'laboratoryId' => (string) $lab->id,
                'name' => 'Race Campaign',
                'frequencyKind' => 'monthly',
                'checklistTemplate' => ['Race checklist'],
                'assignedTechnicianName' => 'Race Technician',
                'nextDueDate' => now()->addWeek()->toDateString(),
                'assetIds' => $assets->pluck('id')->map(fn ($id): string => (string) $id)->all(),
            ],
        );

        $scheduledFor = now()->addDays(2)->toDateString();
        $results = $this->race(
            fn () => app(MaintenanceCampaignService::class)->scheduleBatch(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $campaign->id,
                1,
                [
                    'scheduledFor' => $scheduledFor,
                    'technicianName' => 'Race Technician A',
                ],
            ),
            fn () => app(MaintenanceCampaignService::class)->scheduleBatch(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $campaign->id,
                1,
                [
                    'scheduledFor' => $scheduledFor,
                    'technicianName' => 'Race Technician B',
                ],
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['MAINTENANCE_CAMPAIGN_VERSION_CONFLICT'], $this->failureCodes($results));
        $this->assertSame(3, MaintenanceExecution::query()
            ->whereIn('asset_id', $assets->pluck('id'))
            ->whereDate('scheduled_for', $scheduledFor)
            ->count());
        $this->assertSame(0, MaintenanceExecution::query()
            ->whereIn('asset_id', $assets->pluck('id'))
            ->where('custody_active', true)
            ->count());
        $this->assertSame(2, MaintenanceCampaign::query()->findOrFail($campaign->id)->version);
        $this->assertSame(1, MaintenanceCampaignEvent::query()
            ->where('maintenance_campaign_id', $campaign->id)
            ->where('event_type', 'maintenance_campaign.batch_scheduled')
            ->count());
    }

    public function test_postgres_corrective_custody_requires_start_evidence_at_database_layer(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'major_damage',
            'lifecycle_status' => 'active',
        ]);
        $lab = Laboratory::factory()->create([
            'school_id' => $schoolId,
            'status' => 'active',
        ]);

        $workOrder = app(WorkOrderMutationService::class)->create(
            $this->context($membershipId, []),
            User::query()->findOrFail($userId),
            [
                'assetId' => (string) $asset->id,
                'laboratoryId' => (string) $lab->id,
                'problemSummary' => 'PostgreSQL start evidence constraint proof',
                'priority' => 'high',
            ],
        );

        try {
            WorkOrder::query()->whereKey($workOrder->id)->update(['status' => 'assigned']);
            $this->fail('Expected PostgreSQL to reject assigned Work Order without assignee snapshots.');
        } catch (QueryException) {
        }

        try {
            WorkOrder::query()->whereKey($workOrder->id)->update([
                'status' => 'in_progress',
                'custody_active' => true,
            ]);
            $this->fail('Expected PostgreSQL to reject active corrective custody without start evidence.');
        } catch (QueryException) {
        }

        $workOrder->refresh();
        $this->assertSame('draft', $workOrder->status);
        $this->assertFalse($workOrder->custody_active);
        $this->assertNull($workOrder->started_at);
        $this->assertNull($workOrder->condition_before);
        $this->assertNull($workOrder->asset_version_at_start);

        try {
            WorkOrder::query()->whereKey($workOrder->id)->update([
                'status' => 'cancelled',
                'cancel_reason' => 'Invalid partial evidence',
                'cancelled_at' => now(),
                'started_at' => now(),
            ]);
            $this->fail('Expected PostgreSQL to reject cancelled Work Order with partial start evidence.');
        } catch (QueryException) {
        }

        $workOrder->refresh();
        $this->assertSame('draft', $workOrder->status);
    }

    /**
     * @return array{string,string,string}
     */
    private function actorContext(): array
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        return [(string) $user->id, (string) $membership->id, (string) $school->id];
    }

    /**
     * @param list<string> $permissions
     */
    private function context(string $membershipId, array $permissions): CurrentMembershipContext
    {
        return new CurrentMembershipContext(
            SchoolMembership::query()->findOrFail($membershipId),
            collect($permissions),
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function loanPayload(string $assetId, string $borrower): array
    {
        return [
            'borrowerName' => $borrower,
            'purpose' => 'S4 PostgreSQL concurrency proof',
            'requestedReturnAt' => now()->addDay()->toISOString(),
            'assetIds' => [$assetId],
        ];
    }

    private function assignedWorkOrder(
        string $userId,
        string $membershipId,
        string $schoolId,
        string $assetId,
        string $summary,
    ): WorkOrder {
        $lab = Laboratory::factory()->create([
            'school_id' => $schoolId,
            'status' => 'active',
        ]);
        $workOrder = app(WorkOrderMutationService::class)->create(
            $this->context($membershipId, []),
            User::query()->findOrFail($userId),
            [
                'assetId' => $assetId,
                'laboratoryId' => (string) $lab->id,
                'problemSummary' => $summary,
                'priority' => 'high',
            ],
        );

        $actor = User::query()->findOrFail($userId);
        $workOrder->status = 'assigned';
        $workOrder->assignee_membership_id = $membershipId;
        $workOrder->assignee_membership_id_snapshot = $membershipId;
        $workOrder->assignee_user_id_snapshot = $userId;
        $workOrder->assignee_name_snapshot = $actor->name;
        $workOrder->save();

        return $workOrder->refresh();
    }

    /**
     * @return array{0:array<string,mixed>,1:array<string,mixed>}
     */
    private function race(callable $left, callable $right): array
    {
        $token = (string) Str::uuid();
        $barrier = sys_get_temp_dir().'/smartlab-s4-'.$token.'.go';
        $resultFiles = [
            sys_get_temp_dir().'/smartlab-s4-'.$token.'-left.json',
            sys_get_temp_dir().'/smartlab-s4-'.$token.'-right.json',
        ];
        @unlink($barrier);
        foreach ($resultFiles as $file) {
            @unlink($file);
        }

        $pids = [];
        foreach ([$left, $right] as $index => $callback) {
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('Unable to fork PostgreSQL contention worker.');
            }

            if ($pid === 0) {
                $this->runChild($barrier, $resultFiles[$index], $callback);
            }

            $pids[] = $pid;
        }

        usleep(100_000);
        touch($barrier);

        foreach ($pids as $pid) {
            $status = 0;
            pcntl_waitpid($pid, $status);
            $this->assertTrue(pcntl_wifexited($status), 'Contention worker did not exit normally.');
            $this->assertSame(0, pcntl_wexitstatus($status), 'Contention worker exited with failure.');
        }

        @unlink($barrier);
        $results = [];
        foreach ($resultFiles as $file) {
            $content = is_file($file) ? file_get_contents($file) : false;
            @unlink($file);
            $this->assertIsString($content, 'Contention worker did not emit a result.');
            $decoded = json_decode((string) $content, true, flags: JSON_THROW_ON_ERROR);
            $this->assertIsArray($decoded);
            $results[] = $decoded;
        }

        DB::purge();
        DB::reconnect();

        return [$results[0], $results[1]];
    }

    private function runChild(string $barrier, string $resultFile, callable $callback): never
    {
        while (! is_file($barrier)) {
            usleep(1_000);
        }

        DB::disconnect();
        DB::purge();
        DB::reconnect();
        DB::statement("SET lock_timeout = '5s'");
        DB::statement("SET statement_timeout = '15s'");

        try {
            $callback();
            $result = ['ok' => true, 'code' => null, 'class' => null, 'message' => null];
        } catch (Throwable $exception) {
            $result = [
                'ok' => false,
                'code' => property_exists($exception, 'errorCode') ? $exception->errorCode : null,
                'class' => $exception::class,
                'message' => $exception->getMessage(),
            ];
        }

        file_put_contents($resultFile, json_encode($result, JSON_THROW_ON_ERROR));
        DB::disconnect();

        exit(0);
    }

    /** @param array<int,array<string,mixed>> $results */
    private function successCount(array $results): int
    {
        return count(array_filter($results, fn (array $result): bool => $result['ok'] === true));
    }

    /** @param array<int,array<string,mixed>> $results @return list<string|null> */
    private function failureCodes(array $results): array
    {
        return array_values(array_map(
            fn (array $result): ?string => $result['code'],
            array_filter($results, fn (array $result): bool => $result['ok'] === false),
        ));
    }

    private function toMilli(mixed $value): int
    {
        return (int) str_replace('.', '', number_format((float) $value, 3, '.', ''));
    }
}
