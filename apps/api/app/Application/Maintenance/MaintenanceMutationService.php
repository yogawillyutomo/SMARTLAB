<?php

namespace App\Application\Maintenance;

use App\Application\Asset\AssetMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Application\Inventory\InventoryMutationService;
use App\Domain\Maintenance\MaintenanceDomainException;
use App\Models\Asset;
use App\Models\Device;
use App\Models\LoanItem;
use App\Models\MaintenanceEvent;
use App\Models\MaintenanceExecution;
use App\Models\MaintenancePlan;
use App\Models\WorkOrder;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class MaintenanceMutationService
{
    public function __construct(
        private readonly AssetMutationService $assetService,
        private readonly InventoryMutationService $inventoryService,
    ) {
    }

    /** @param array<string, mixed> $data */
    public function createPlan(CurrentMembershipContext $context, User $actor, array $data): MaintenancePlan
    {
        return DB::transaction(function () use ($context, $actor, $data): MaintenancePlan {
            $asset = $this->lockAsset($context, (string) $data['assetId']);
            $this->assertAssetEligible($context, $asset);
            $this->assertFrequency((string) $data['frequencyKind'], $data['intervalDays'] ?? null);

            $id = (string) Str::ulid();
            $plan = new MaintenancePlan([
                'school_id' => $context->membership->school_id,
                'plan_code' => $this->planNumber($id),
                'asset_id' => $asset->id,
                'asset_code_snapshot' => $asset->asset_code,
                'asset_name_snapshot' => $asset->name,
                'name' => trim((string) $data['name']),
                'frequency_kind' => $data['frequencyKind'],
                'interval_days' => $data['frequencyKind'] === 'custom_interval' ? (int) $data['intervalDays'] : null,
                'checklist_template' => $this->normalizeChecklist($data['checklistTemplate']),
                'assigned_technician_reference' => $this->nullableTrim($data['assignedTechnicianReference'] ?? null),
                'assigned_technician_name_snapshot' => $this->nullableTrim($data['assignedTechnicianName'] ?? null),
                'next_due_date' => $data['nextDueDate'],
                'status' => 'active',
                'version' => 1,
            ]);
            $plan->id = $id;
            $plan->save();

            $this->writePlanEvent($context, $actor, $plan, 'maintenance_plan.created', null, 'active', [
                'assetId' => $asset->id,
                'assetCodeSnapshot' => $asset->asset_code,
                'checklistTemplate' => $plan->checklist_template,
            ]);

            return $plan->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function updatePlan(
        CurrentMembershipContext $context,
        User $actor,
        string $planId,
        int $expectedVersion,
        array $data,
    ): MaintenancePlan {
        return DB::transaction(function () use ($context, $actor, $planId, $expectedVersion, $data): MaintenancePlan {
            $plan = $this->lockPlan($context, $planId);
            $this->assertPlanVersion($plan, $expectedVersion);

            $frequency = (string) ($data['frequencyKind'] ?? $plan->frequency_kind);
            if ($frequency !== 'custom_interval'
                && array_key_exists('intervalDays', $data)
                && $data['intervalDays'] !== null) {
                throw ValidationException::withMessages([
                    'intervalDays' => ['intervalDays is only valid for custom_interval.'],
                ]);
            }

            $interval = array_key_exists('intervalDays', $data)
                ? $data['intervalDays']
                : $plan->interval_days;
            if ($frequency !== 'custom_interval') {
                $interval = null;
            }
            $this->assertFrequency($frequency, $interval);

            $changes = [];
            foreach ([
                'name' => 'name',
                'frequencyKind' => 'frequency_kind',
                'assignedTechnicianReference' => 'assigned_technician_reference',
                'assignedTechnicianName' => 'assigned_technician_name_snapshot',
                'nextDueDate' => 'next_due_date',
            ] as $field => $column) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }
                $after = in_array($field, ['assignedTechnicianReference', 'assignedTechnicianName'], true)
                    ? $this->nullableTrim($data[$field])
                    : $data[$field];
                $before = $plan->getAttribute($column);
                if ($this->eventValue($before) === $this->eventValue($after)) {
                    continue;
                }
                $changes[$field] = ['before' => $this->eventValue($before), 'after' => $this->eventValue($after)];
                $plan->setAttribute($column, $after);
            }

            $currentInterval = $plan->interval_days;
            $nextInterval = $frequency === 'custom_interval' ? (int) $interval : null;
            if ($plan->frequency_kind !== $frequency) {
                $changes['frequencyKind'] = ['before' => $plan->frequency_kind, 'after' => $frequency];
                $plan->frequency_kind = $frequency;
            }
            if ($currentInterval !== $nextInterval) {
                $changes['intervalDays'] = ['before' => $currentInterval, 'after' => $nextInterval];
                $plan->interval_days = $nextInterval;
            }

            if (array_key_exists('checklistTemplate', $data)) {
                $nextChecklist = $this->normalizeChecklist($data['checklistTemplate']);
                if ($plan->checklist_template !== $nextChecklist) {
                    $changes['checklistTemplate'] = ['before' => $plan->checklist_template, 'after' => $nextChecklist];
                    $plan->checklist_template = $nextChecklist;
                }
            }

            if ($changes === []) {
                return $plan;
            }

            $plan->version++;
            $plan->save();
            $this->writePlanEvent($context, $actor, $plan, 'maintenance_plan.updated', $plan->status, $plan->status, [
                'changes' => $changes,
            ]);

            return $plan->refresh();
        });
    }

    public function activatePlan(
        CurrentMembershipContext $context,
        User $actor,
        string $planId,
        int $expectedVersion,
    ): MaintenancePlan {
        return DB::transaction(function () use ($context, $actor, $planId, $expectedVersion): MaintenancePlan {
            $plan = $this->lockPlan($context, $planId);
            $this->assertPlanVersion($plan, $expectedVersion);
            if ($plan->status === 'active') {
                return $plan;
            }

            $asset = $this->lockAsset($context, (string) $plan->asset_id);
            $this->assertAssetEligible($context, $asset);

            $before = $plan->status;
            $plan->status = 'active';
            $plan->version++;
            $plan->save();
            $this->writePlanEvent($context, $actor, $plan, 'maintenance_plan.activated', $before, 'active', []);

            return $plan->refresh();
        });
    }

    public function deactivatePlan(
        CurrentMembershipContext $context,
        User $actor,
        string $planId,
        int $expectedVersion,
    ): MaintenancePlan {
        return DB::transaction(function () use ($context, $actor, $planId, $expectedVersion): MaintenancePlan {
            $plan = $this->lockPlan($context, $planId);
            $this->assertPlanVersion($plan, $expectedVersion);
            if ($plan->status === 'inactive') {
                return $plan;
            }

            $before = $plan->status;
            $plan->status = 'inactive';
            $plan->version++;
            $plan->save();
            $this->writePlanEvent($context, $actor, $plan, 'maintenance_plan.deactivated', $before, 'inactive', []);

            return $plan->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function scheduleExecution(
        CurrentMembershipContext $context,
        User $actor,
        string $planId,
        int $expectedPlanVersion,
        array $data,
    ): MaintenanceExecution {
        try {
            return DB::transaction(function () use ($context, $actor, $planId, $expectedPlanVersion, $data): MaintenanceExecution {
                $plan = $this->lockPlan($context, $planId);
                $this->assertPlanVersion($plan, $expectedPlanVersion);
                if ($plan->status !== 'active') {
                    throw MaintenanceDomainException::stateConflict('Only active MaintenancePlans may schedule executions.');
                }

                $asset = $this->lockAsset($context, (string) $plan->asset_id);
                $this->assertAssetEligible($context, $asset);

                $id = (string) Str::ulid();
                $execution = new MaintenanceExecution([
                    'school_id' => $plan->school_id,
                    'execution_number' => $this->executionNumber($id),
                    'maintenance_plan_id' => $plan->id,
                    'plan_code_snapshot' => $plan->plan_code,
                    'asset_id' => $asset->id,
                    'asset_code_snapshot' => $asset->asset_code,
                    'asset_name_snapshot' => $asset->name,
                    'scheduled_for' => $data['scheduledFor'],
                    'status' => 'scheduled',
                    'checklist_snapshot' => $plan->checklist_template,
                    'checklist_results' => null,
                    'checklist_progress' => null,
                    'findings' => null,
                    'action_taken' => null,
                    'condition_before' => null,
                    'condition_after' => null,
                    'technician_reference' => $this->nullableTrim($data['technicianReference'] ?? $plan->assigned_technician_reference),
                    'technician_name_snapshot' => trim((string) $data['technicianName']),
                    'asset_version_at_start' => null,
                    'custody_active' => false,
                    'started_at' => null,
                    'completed_at' => null,
                    'cancelled_at' => null,
                    'cancel_reason' => null,
                    'version' => 1,
                ]);
                $execution->id = $id;
                $execution->save();

                $this->writeExecutionEvent($context, $actor, $execution, 'maintenance_execution.scheduled', null, 'scheduled', [
                    'planId' => $plan->id,
                    'planVersionSnapshot' => $plan->version,
                    'assetId' => $asset->id,
                    'scheduledFor' => $execution->scheduled_for->toDateString(),
                    'checklistSnapshot' => $execution->checklist_snapshot,
                ]);

                return $this->reloadExecution($execution);
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'scheduledFor' => ['An execution for this MaintenancePlan is already scheduled on that date.'],
            ]);
        }
    }

    public function startExecution(
        CurrentMembershipContext $context,
        User $actor,
        string $executionId,
        int $expectedVersion,
    ): MaintenanceExecution {
        try {
            return DB::transaction(function () use ($context, $actor, $executionId, $expectedVersion): MaintenanceExecution {
                $execution = $this->lockExecution($context, $executionId);
                $this->assertExecutionVersion($execution, $expectedVersion);
                $this->assertExecutionState($execution, ['scheduled'], 'Only scheduled MaintenanceExecutions may start.');

                $plan = $this->lockPlan($context, (string) $execution->maintenance_plan_id);
                if ($plan->status !== 'active') {
                    throw MaintenanceDomainException::stateConflict('The linked MaintenancePlan is inactive.');
                }

                $asset = $this->lockAsset($context, (string) $execution->asset_id);
                $this->assertAssetEligible($context, $asset);

                $loanConflict = LoanItem::query()
                    ->where('asset_id', $asset->id)
                    ->where('custody_active', true)
                    ->exists();
                if ($loanConflict) {
                    throw MaintenanceDomainException::assetUnavailable('Asset is under active Loan custody.');
                }

                $maintenanceConflict = MaintenanceExecution::query()
                    ->where('asset_id', $asset->id)
                    ->where('custody_active', true)
                    ->whereKeyNot($execution->id)
                    ->exists();
                if ($maintenanceConflict) {
                    throw MaintenanceDomainException::assetUnavailable('Asset is already under active Preventive Maintenance custody.');
                }

                $workOrderConflict = WorkOrder::query()
                    ->where('asset_id', $asset->id)
                    ->where('custody_active', true)
                    ->exists();
                if ($workOrderConflict) {
                    throw MaintenanceDomainException::assetUnavailable('Asset is under active corrective Work Order custody.');
                }

                $before = $execution->status;
                $execution->status = 'in_progress';
                $execution->condition_before = $asset->condition;
                $execution->asset_version_at_start = $asset->version;
                $execution->checklist_progress = $this->checklistEvidence(
                    $execution,
                    array_fill(0, count($execution->checklist_snapshot), false),
                );
                $execution->custody_active = true;
                $execution->started_at = now();
                $execution->version++;
                $execution->save();

                $this->writeExecutionEvent($context, $actor, $execution, 'maintenance_execution.started', $before, 'in_progress', [
                    'assetId' => $asset->id,
                    'conditionBefore' => $asset->condition,
                    'assetVersionAtStart' => $asset->version,
                ]);

                return $this->reloadExecution($execution);
            });
        } catch (UniqueConstraintViolationException) {
            throw MaintenanceDomainException::assetUnavailable();
        }
    }

    /**
     * @param array<mixed> $checks
     */
    public function updateChecklistProgress(
        CurrentMembershipContext $context,
        User $actor,
        string $executionId,
        int $expectedVersion,
        array $checks,
    ): MaintenanceExecution {
        return DB::transaction(function () use ($context, $actor, $executionId, $expectedVersion, $checks): MaintenanceExecution {
            $execution = $this->lockExecution($context, $executionId);
            $this->assertExecutionVersion($execution, $expectedVersion);
            $this->assertExecutionState(
                $execution,
                ['in_progress'],
                'Checklist progress may only be updated while MaintenanceExecution is in progress.',
            );

            $progress = $this->checklistEvidence($execution, $checks);
            if ($execution->checklist_progress === $progress) {
                return $this->reloadExecution($execution);
            }

            $execution->checklist_progress = $progress;
            $execution->version++;
            $execution->save();

            $this->writeExecutionEvent(
                $context,
                $actor,
                $execution,
                'maintenance_execution.checklist_progress_updated',
                'in_progress',
                'in_progress',
                [
                    'completedCount' => count(array_filter($progress, fn (array $item): bool => $item['done'])),
                    'totalCount' => count($progress),
                    'checklistProgress' => $progress,
                ],
            );

            return $this->reloadExecution($execution);
        });
    }

    /**
     * @param array<string, mixed> $data
     */
    public function completeExecution(
        CurrentMembershipContext $context,
        User $actor,
        string $executionId,
        int $expectedVersion,
        array $data,
    ): MaintenanceExecution {
        return DB::transaction(function () use ($context, $actor, $executionId, $expectedVersion, $data): MaintenanceExecution {
            $execution = $this->lockExecution($context, $executionId);
            $this->assertExecutionVersion($execution, $expectedVersion);
            $this->assertExecutionState($execution, ['in_progress'], 'Only in-progress MaintenanceExecutions may complete.');

            $plan = $this->lockPlan($context, (string) $execution->maintenance_plan_id);
            $asset = $this->lockAsset($context, (string) $execution->asset_id);

            if ($asset->version !== $execution->asset_version_at_start) {
                throw new MaintenanceDomainException(
                    'Asset changed after Maintenance custody started; completion requires reconciliation.',
                    'MAINTENANCE_ASSET_VERSION_CONFLICT',
                    409,
                );
            }
            $this->assertAssetEligible($context, $asset);

            $checklistResults = $this->checklistEvidence($execution, $data['checklistResults']);

            $issues = $data['inventoryIssues'] ?? [];
            if ($issues !== [] && ! $context->permissions->contains('maintenance.consume-stock')) {
                throw new MaintenanceDomainException(
                    'Maintenance spare-part consumption permission is required.',
                    'MAINTENANCE_STOCK_PERMISSION_REQUIRED',
                    403,
                );
            }

            $transactions = $issues === []
                ? []
                : $this->inventoryService->issueForMaintenance(
                    $context,
                    $actor,
                    $execution->id,
                    $execution->execution_number,
                    $issues,
                );

            $assetAfter = $this->assetService->applyMaintenanceCondition(
                $context,
                $asset,
                (int) $execution->asset_version_at_start,
                (string) $data['conditionAfter'],
                (string) $execution->id,
            );

            $before = $execution->status;
            $execution->status = 'completed';
            $execution->checklist_results = $checklistResults;
            $execution->checklist_progress = $checklistResults;
            $execution->findings = $this->nullableTrim($data['findings'] ?? null);
            $execution->action_taken = trim((string) $data['actionTaken']);
            $execution->condition_after = (string) $data['conditionAfter'];
            $execution->custody_active = false;
            $execution->completed_at = now();
            $execution->version++;
            $execution->save();

            if ($plan->status === 'active') {
                $beforeDue = $plan->next_due_date?->toDateString();
                $plan->next_due_date = $this->nextDueDate($plan, CarbonImmutable::instance($execution->completed_at));
                $plan->version++;
                $plan->save();
                $this->writePlanEvent($context, $actor, $plan, 'maintenance_plan.rescheduled', 'active', 'active', [
                    'nextDueDate' => ['before' => $beforeDue, 'after' => $plan->next_due_date->toDateString()],
                    'sourceExecutionId' => $execution->id,
                ]);
            }

            $this->writeExecutionEvent($context, $actor, $execution, 'maintenance_execution.completed', $before, 'completed', [
                'conditionBefore' => $execution->condition_before,
                'conditionAfter' => $execution->condition_after,
                'assetVersionAfter' => $assetAfter->version,
                'inventoryTransactionIds' => array_map(fn ($transaction): string => (string) $transaction->id, $transactions),
                'checklistResults' => $checklistResults,
            ]);

            return $this->reloadExecution($execution);
        });
    }

    public function cancelExecution(
        CurrentMembershipContext $context,
        User $actor,
        string $executionId,
        int $expectedVersion,
        string $reason,
    ): MaintenanceExecution {
        return DB::transaction(function () use ($context, $actor, $executionId, $expectedVersion, $reason): MaintenanceExecution {
            $execution = $this->lockExecution($context, $executionId);
            $this->assertExecutionVersion($execution, $expectedVersion);
            $this->assertExecutionState($execution, ['scheduled', 'in_progress'], 'Only scheduled or in-progress MaintenanceExecutions may be cancelled.');

            if ($execution->status === 'in_progress') {
                $this->lockAsset($context, (string) $execution->asset_id);
            }

            $before = $execution->status;
            $execution->status = 'cancelled';
            $execution->custody_active = false;
            $execution->cancel_reason = trim($reason);
            $execution->cancelled_at = now();
            $execution->version++;
            $execution->save();

            $this->writeExecutionEvent($context, $actor, $execution, 'maintenance_execution.cancelled', $before, 'cancelled', [
                'reason' => $execution->cancel_reason,
                'custodyReleased' => $before === 'in_progress',
            ]);

            return $this->reloadExecution($execution);
        });
    }

    private function lockPlan(CurrentMembershipContext $context, string $planId): MaintenancePlan
    {
        $plan = MaintenancePlan::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($planId)
            ->lockForUpdate()
            ->first();

        if ($plan === null) {
            throw MaintenanceDomainException::planNotFound();
        }

        return $plan;
    }

    private function lockExecution(CurrentMembershipContext $context, string $executionId): MaintenanceExecution
    {
        $execution = MaintenanceExecution::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($executionId)
            ->lockForUpdate()
            ->first();

        if ($execution === null) {
            throw MaintenanceDomainException::executionNotFound();
        }

        return $execution;
    }

    private function lockAsset(CurrentMembershipContext $context, string $assetId): Asset
    {
        $asset = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($assetId)
            ->lockForUpdate()
            ->first();

        if ($asset === null) {
            throw ValidationException::withMessages(['assetId' => ['The selected Asset is invalid.']]);
        }

        return $asset;
    }

    private function assertAssetEligible(CurrentMembershipContext $context, Asset $asset): void
    {
        if ($asset->lifecycle_status !== 'active') {
            throw MaintenanceDomainException::assetUnavailable('Preventive Maintenance requires an active Asset.');
        }

        if ($asset->linked_device_id === null) {
            return;
        }

        $device = Device::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($asset->linked_device_id)
            ->sharedLock()
            ->first();

        if ($device === null || ! in_array($device->lifecycle_status, ['in_service', 'spare'], true)) {
            throw MaintenanceDomainException::assetUnavailable('The linked Device lifecycle prohibits preventive Maintenance.');
        }
    }

    private function assertPlanVersion(MaintenancePlan $plan, int $expectedVersion): void
    {
        if ($plan->version !== $expectedVersion) {
            throw new MaintenanceDomainException(
                'MaintenancePlan has changed since it was loaded.',
                'MAINTENANCE_PLAN_VERSION_CONFLICT',
                412,
            );
        }
    }

    private function assertExecutionVersion(MaintenanceExecution $execution, int $expectedVersion): void
    {
        if ($execution->version !== $expectedVersion) {
            throw new MaintenanceDomainException(
                'MaintenanceExecution has changed since it was loaded.',
                'MAINTENANCE_EXECUTION_VERSION_CONFLICT',
                412,
            );
        }
    }

    /** @param list<string> $states */
    private function assertExecutionState(MaintenanceExecution $execution, array $states, string $message): void
    {
        if (! in_array($execution->status, $states, true)) {
            throw MaintenanceDomainException::stateConflict($message);
        }
    }

    private function assertFrequency(string $frequency, mixed $intervalDays): void
    {
        if ($frequency === 'custom_interval') {
            if (! is_numeric($intervalDays) || (int) $intervalDays < 1 || (int) $intervalDays > 3650) {
                throw ValidationException::withMessages([
                    'intervalDays' => ['A custom interval between 1 and 3650 days is required.'],
                ]);
            }

            return;
        }

        if ($intervalDays !== null) {
            throw ValidationException::withMessages([
                'intervalDays' => ['intervalDays is only valid for custom_interval.'],
            ]);
        }
    }

    /** @param array<mixed> $items @return list<string> */
    private function normalizeChecklist(array $items): array
    {
        $normalized = array_map(fn ($item): string => trim((string) $item), $items);
        if (in_array('', $normalized, true) || count(array_unique($normalized)) !== count($normalized)) {
            throw ValidationException::withMessages([
                'checklistTemplate' => ['Checklist items must be unique non-empty strings.'],
            ]);
        }

        return array_values($normalized);
    }

    /**
     * @param array<mixed> $checks
     * @return list<array{item:string,done:bool}>
     */
    private function checklistEvidence(MaintenanceExecution $execution, array $checks): array
    {
        if (! array_is_list($checks) || count($checks) !== count($execution->checklist_snapshot)) {
            throw ValidationException::withMessages([
                'checklistResults' => ['Checklist results must cover the frozen execution checklist exactly once.'],
            ]);
        }

        $evidence = [];
        foreach ($execution->checklist_snapshot as $index => $item) {
            $evidence[] = ['item' => $item, 'done' => (bool) $checks[$index]];
        }

        return $evidence;
    }

    private function nextDueDate(MaintenancePlan $plan, CarbonImmutable $completedAt): string
    {
        $date = $completedAt->startOfDay();

        return match ($plan->frequency_kind) {
            'weekly' => $date->addWeek()->toDateString(),
            'monthly' => $date->addMonthNoOverflow()->toDateString(),
            'quarterly' => $date->addMonthsNoOverflow(3)->toDateString(),
            'semester' => $date->addMonthsNoOverflow(6)->toDateString(),
            'yearly' => $date->addYearNoOverflow()->toDateString(),
            'custom_interval' => $date->addDays((int) $plan->interval_days)->toDateString(),
            default => throw new \LogicException('Unknown Maintenance frequency.'),
        };
    }

    private function reloadExecution(MaintenanceExecution $execution): MaintenanceExecution
    {
        return $execution->refresh()->load('inventoryTransactions');
    }

    /** @param array<string, mixed> $payload */
    private function writePlanEvent(
        CurrentMembershipContext $context,
        User $actor,
        MaintenancePlan $plan,
        string $eventType,
        ?string $beforeStatus,
        ?string $afterStatus,
        array $payload,
    ): void {
        MaintenanceEvent::query()->create([
            'school_id' => $plan->school_id,
            'entity_type' => 'plan',
            'maintenance_plan_id' => $plan->id,
            'maintenance_execution_id' => null,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'before_status' => $beforeStatus,
            'after_status' => $afterStatus,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $payload */
    private function writeExecutionEvent(
        CurrentMembershipContext $context,
        User $actor,
        MaintenanceExecution $execution,
        string $eventType,
        ?string $beforeStatus,
        ?string $afterStatus,
        array $payload,
    ): void {
        MaintenanceEvent::query()->create([
            'school_id' => $execution->school_id,
            'entity_type' => 'execution',
            'maintenance_plan_id' => null,
            'maintenance_execution_id' => $execution->id,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'before_status' => $beforeStatus,
            'after_status' => $afterStatus,
            'payload' => $payload,
            'created_at' => now(),
        ]);
    }

    private function planNumber(string $id): string
    {
        return 'MP-'.now()->format('Ymd').'-'.strtoupper(substr($id, -8));
    }

    private function executionNumber(string $id): string
    {
        return 'ME-'.now()->format('Ymd').'-'.strtoupper(substr($id, -8));
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function eventValue(mixed $value): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return $value;
    }
}
