<?php

namespace App\Application\WorkOrder;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentVisibility;
use App\Domain\Incident\IncidentStatus;
use App\Domain\WorkOrder\WorkOrderCatalog;
use App\Domain\WorkOrder\WorkOrderDomainException;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Incident;
use App\Models\Laboratory;
use App\Models\LoanItem;
use App\Models\MaintenanceExecution;
use App\Models\SchoolMembership;
use App\Models\User;
use App\Models\WorkOrder;
use App\Models\WorkOrderEvent;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class WorkOrderMutationService
{
    public function __construct(
        private readonly WorkOrderNumberAllocator $numbers,
        private readonly IncidentVisibility $incidentVisibility,
    ) {}

    /** @param array<string,mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): WorkOrder
    {
        return DB::transaction(function () use ($context, $actor, $data): WorkOrder {
            $schoolId = (string) $context->membership->school_id;
            $asset = $this->lockAsset($context, (string) $data['assetId']);
            $this->assertAssetEligible($context, $asset);

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey((string) $data['laboratoryId'])
                ->lockForUpdate()
                ->first();

            if ($laboratory === null || $laboratory->status !== 'active') {
                throw ValidationException::withMessages([
                    'laboratoryId' => ['The selected Laboratory is invalid or inactive.'],
                ]);
            }

            $incident = $this->resolveIncident($context, $asset, $data['incidentId'] ?? null);
            $id = (string) Str::ulid();

            $workOrder = new WorkOrder([
                'school_id' => $schoolId,
                'work_order_number' => $this->numbers->next($schoolId),
                'incident_id' => $incident?->id,
                'incident_ticket_snapshot' => $incident?->ticket_number,
                'asset_id' => $asset->id,
                'asset_code_snapshot' => $asset->asset_code,
                'asset_name_snapshot' => $asset->name,
                'laboratory_id' => $laboratory->id,
                'laboratory_code_snapshot' => $laboratory->code,
                'laboratory_name_snapshot' => $laboratory->name,
                'problem_summary' => trim((string) $data['problemSummary']),
                'priority' => (string) ($data['priority'] ?? 'normal'),
                'scheduled_for' => $data['scheduledFor'] ?? null,
                'notes' => $this->nullableTrim($data['notes'] ?? null),
                'status' => 'draft',
                'custody_active' => false,
                'version' => 1,
            ]);
            $workOrder->id = $id;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.created', null, 'draft', [
                'assetId' => (string) $asset->id,
                'laboratoryId' => (string) $laboratory->id,
                'incidentId' => $incident?->id,
                'priority' => $workOrder->priority,
                'scheduledFor' => $workOrder->scheduled_for?->toDateString(),
            ]);

            return $workOrder->refresh();
        });
    }

    /** @param array<string,mixed> $data */
    public function update(
        CurrentMembershipContext $context,
        User $actor,
        string $workOrderId,
        int $expectedVersion,
        array $data,
    ): WorkOrder {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $data): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState($workOrder, ['draft'], 'Only draft Work Orders may be updated.');

            $changes = [];
            foreach ([
                'problemSummary' => 'problem_summary',
                'priority' => 'priority',
                'scheduledFor' => 'scheduled_for',
                'notes' => 'notes',
            ] as $input => $column) {
                if (! array_key_exists($input, $data)) {
                    continue;
                }

                $before = $input === 'scheduledFor'
                    ? $workOrder->scheduled_for?->toDateString()
                    : $workOrder->{$column};
                $after = match ($input) {
                    'problemSummary' => trim((string) $data[$input]),
                    'notes' => $this->nullableTrim($data[$input]),
                    default => $data[$input],
                };

                if ((string) ($before ?? '') === (string) ($after ?? '')) {
                    continue;
                }

                $workOrder->{$column} = $after;
                $changes[$input] = ['before' => $before, 'after' => $after];
            }

            if ($changes === []) {
                return $workOrder;
            }

            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.updated', 'draft', 'draft', [
                'changes' => $changes,
            ]);

            return $workOrder->refresh();
        });
    }

    public function assign(
        CurrentMembershipContext $context,
        User $actor,
        string $workOrderId,
        int $expectedVersion,
        string $assigneeMembershipId,
        ?string $reason,
    ): WorkOrder {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $assigneeMembershipId, $reason): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState(
                $workOrder,
                ['draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part'],
                'This Work Order cannot be assigned or reassigned in its current state.',
            );

            $candidate = SchoolMembership::query()
                ->with('user')
                ->where('school_id', $context->membership->school_id)
                ->whereKey($assigneeMembershipId)
                ->lockForUpdate()
                ->first();

            if ($candidate === null
                || $candidate->status !== 'active'
                || $candidate->user === null
                || $candidate->user->status !== 'active'
                || ! $candidate->hasPermission('work-orders.update')) {
                throw WorkOrderDomainException::assigneeIneligible();
            }

            $initial = $workOrder->status === 'draft';
            if (! $initial && (string) $workOrder->assignee_membership_id === (string) $candidate->id) {
                return $workOrder->refresh();
            }

            $normalizedReason = $this->nullableTrim($reason);
            if (! $initial && ($normalizedReason === null || mb_strlen($normalizedReason) < 3)) {
                throw ValidationException::withMessages([
                    'reason' => ['A reassignment reason of at least 3 characters is required.'],
                ]);
            }

            $beforeStatus = $workOrder->status;
            $previous = [
                'membershipId' => $workOrder->assignee_membership_id_snapshot,
                'userId' => $workOrder->assignee_user_id_snapshot,
                'name' => $workOrder->assignee_name_snapshot,
            ];

            $workOrder->assignee_membership_id = $candidate->id;
            $workOrder->assignee_membership_id_snapshot = $candidate->id;
            $workOrder->assignee_user_id_snapshot = $candidate->user->id;
            $workOrder->assignee_name_snapshot = $candidate->user->name;
            if ($initial) {
                $workOrder->status = 'assigned';
            }
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent(
                $context,
                $actor,
                $workOrder,
                $initial ? 'work_order.assigned' : 'work_order.reassigned',
                $beforeStatus,
                $workOrder->status,
                [
                    'previousAssignee' => $initial ? null : $previous,
                    'assignee' => [
                        'membershipId' => (string) $candidate->id,
                        'userId' => (string) $candidate->user->id,
                        'name' => (string) $candidate->user->name,
                    ],
                    'reason' => $normalizedReason,
                ],
            );

            return $workOrder->refresh();
        });
    }

    public function start(
        CurrentMembershipContext $context,
        User $actor,
        string $workOrderId,
        int $expectedVersion,
    ): WorkOrder {
        try {
            return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion): WorkOrder {
                $workOrder = $this->lockWorkOrder($context, $workOrderId);
                $this->assertVersion($workOrder, $expectedVersion);
                $this->assertState($workOrder, ['assigned'], 'Only assigned Work Orders may start.');
                $this->assertProgressActor($context, $workOrder);

                $asset = $this->lockAsset($context, (string) $workOrder->asset_id);
                $this->assertAssetEligible($context, $asset);
                $this->assertNoOtherCustody($asset, $workOrder);

                $before = $workOrder->status;
                $workOrder->status = 'in_progress';
                $workOrder->condition_before = $asset->condition;
                $workOrder->asset_version_at_start = $asset->version;
                $workOrder->custody_active = true;
                $workOrder->started_at = now();
                $workOrder->version++;
                $workOrder->save();

                $this->writeEvent($context, $actor, $workOrder, 'work_order.started', $before, 'in_progress', [
                    'assetId' => (string) $asset->id,
                    'conditionBefore' => (string) $asset->condition,
                    'assetVersionAtStart' => (int) $asset->version,
                ]);

                return $workOrder->refresh();
            });
        } catch (UniqueConstraintViolationException) {
            throw WorkOrderDomainException::custodyConflict();
        }
    }

    public function hold(CurrentMembershipContext $context, User $actor, string $workOrderId, int $expectedVersion, string $reason): WorkOrder
    {
        return $this->progressTransition($context, $actor, $workOrderId, $expectedVersion, ['in_progress'], 'on_hold', 'work_order.held', $reason);
    }

    public function waitingPart(CurrentMembershipContext $context, User $actor, string $workOrderId, int $expectedVersion, string $reason): WorkOrder
    {
        return $this->progressTransition($context, $actor, $workOrderId, $expectedVersion, ['in_progress', 'on_hold'], 'waiting_part', 'work_order.waiting_part', $reason);
    }

    public function resume(CurrentMembershipContext $context, User $actor, string $workOrderId, int $expectedVersion): WorkOrder
    {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState($workOrder, ['on_hold', 'waiting_part'], 'Only held or waiting-part Work Orders may resume.');
            $this->assertProgressActor($context, $workOrder);

            $asset = $this->lockAsset($context, (string) $workOrder->asset_id);
            $this->assertAssetEligible($context, $asset);

            $before = $workOrder->status;
            $workOrder->status = 'in_progress';
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.resumed', $before, 'in_progress', []);

            return $workOrder->refresh();
        });
    }

    /** @param array<string,mixed> $data */
    public function complete(
        CurrentMembershipContext $context,
        User $actor,
        string $workOrderId,
        int $expectedVersion,
        array $data,
    ): WorkOrder {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $data): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState($workOrder, ['in_progress'], 'Only in-progress Work Orders may complete.');
            $this->assertProgressActor($context, $workOrder);
            $this->lockAsset($context, (string) $workOrder->asset_id);

            $before = $workOrder->status;
            $workOrder->status = 'completed';
            $workOrder->diagnosis = trim((string) $data['diagnosis']);
            $workOrder->action_taken = trim((string) $data['actionTaken']);
            $workOrder->test_result = $this->nullableTrim($data['testResult'] ?? null);
            $workOrder->condition_after = (string) $data['conditionAfter'];
            $workOrder->completed_at = now();
            $workOrder->custody_active = true;
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.completed', $before, 'completed', [
                'diagnosis' => $workOrder->diagnosis,
                'actionTaken' => $workOrder->action_taken,
                'testResult' => $workOrder->test_result,
                'conditionAfter' => $workOrder->condition_after,
            ]);

            return $workOrder->refresh();
        });
    }

    public function rework(CurrentMembershipContext $context, User $actor, string $workOrderId, int $expectedVersion, string $reason): WorkOrder
    {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $reason): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState($workOrder, ['completed'], 'Only completed Work Orders may be returned for rework.');

            $previousEvidence = [
                'completedAt' => $workOrder->completed_at?->toISOString(),
                'conditionAfter' => $workOrder->condition_after,
                'testResult' => $workOrder->test_result,
                'diagnosis' => $workOrder->diagnosis,
                'actionTaken' => $workOrder->action_taken,
            ];

            $workOrder->status = 'in_progress';
            $workOrder->completed_at = null;
            $workOrder->condition_after = null;
            $workOrder->test_result = null;
            $workOrder->custody_active = true;
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.rework_requested', 'completed', 'in_progress', [
                'reason' => trim($reason),
                'previousCompletion' => $previousEvidence,
            ]);

            return $workOrder->refresh();
        });
    }

    public function cancel(CurrentMembershipContext $context, User $actor, string $workOrderId, int $expectedVersion, string $reason): WorkOrder
    {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $reason): WorkOrder {
            if (! $context->permissions->contains('work-orders.assign')
                && ! $context->permissions->contains('work-orders.approve')) {
                throw new WorkOrderDomainException(
                    'Work Order cancellation requires assign or approve authority.',
                    'WORK_ORDER_CANCEL_FORBIDDEN',
                    403,
                );
            }

            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState(
                $workOrder,
                ['draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part'],
                'This Work Order cannot be cancelled in its current state.',
            );

            if ($workOrder->custody_active) {
                $this->lockAsset($context, (string) $workOrder->asset_id);
            }

            $before = $workOrder->status;
            $workOrder->status = 'cancelled';
            $workOrder->custody_active = false;
            $workOrder->cancel_reason = trim($reason);
            $workOrder->cancelled_at = now();
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, 'work_order.cancelled', $before, 'cancelled', [
                'reason' => $workOrder->cancel_reason,
                'custodyReleased' => in_array($before, WorkOrderCatalog::ACTIVE_CUSTODY_STATUSES, true),
            ]);

            return $workOrder->refresh();
        });
    }

    /** @param list<string> $from */
    private function progressTransition(
        CurrentMembershipContext $context,
        User $actor,
        string $workOrderId,
        int $expectedVersion,
        array $from,
        string $to,
        string $eventType,
        string $reason,
    ): WorkOrder {
        return DB::transaction(function () use ($context, $actor, $workOrderId, $expectedVersion, $from, $to, $eventType, $reason): WorkOrder {
            $workOrder = $this->lockWorkOrder($context, $workOrderId);
            $this->assertVersion($workOrder, $expectedVersion);
            $this->assertState($workOrder, $from, 'Work Order transition is not allowed from the current state.');
            $this->assertProgressActor($context, $workOrder);

            $before = $workOrder->status;
            $workOrder->status = $to;
            $workOrder->version++;
            $workOrder->save();

            $this->writeEvent($context, $actor, $workOrder, $eventType, $before, $to, ['reason' => trim($reason)]);

            return $workOrder->refresh();
        });
    }

    private function lockWorkOrder(CurrentMembershipContext $context, string $workOrderId): WorkOrder
    {
        $workOrder = WorkOrder::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($workOrderId)
            ->lockForUpdate()
            ->first();

        if ($workOrder === null) {
            throw WorkOrderDomainException::notFound();
        }

        return $workOrder;
    }

    private function lockAsset(CurrentMembershipContext $context, string $assetId): Asset
    {
        $asset = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($assetId)
            ->lockForUpdate()
            ->first();

        if ($asset === null) {
            throw WorkOrderDomainException::assetIneligible('The selected Asset is invalid.');
        }

        return $asset;
    }

    private function assertAssetEligible(CurrentMembershipContext $context, Asset $asset): void
    {
        if ($asset->lifecycle_status !== 'active') {
            throw WorkOrderDomainException::assetIneligible('Corrective Work Order requires an active Asset.');
        }

        if ($asset->linked_device_id === null) {
            return;
        }

        $device = Device::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($asset->linked_device_id)
            ->sharedLock()
            ->first();

        if ($device === null || ! in_array($device->lifecycle_status, WorkOrderCatalog::DEVICE_REPAIR_LIFECYCLES, true)) {
            throw WorkOrderDomainException::assetIneligible(
                'The linked Device lifecycle prohibits corrective repair execution.',
            );
        }
    }

    private function assertNoOtherCustody(Asset $asset, WorkOrder $workOrder): void
    {
        if (LoanItem::query()->where('school_id', $asset->school_id)->where('asset_id', $asset->id)->where('custody_active', true)->exists()) {
            throw WorkOrderDomainException::custodyConflict('Asset is under active Loan custody.');
        }

        if (MaintenanceExecution::query()->where('school_id', $asset->school_id)->where('asset_id', $asset->id)->where('custody_active', true)->exists()) {
            throw WorkOrderDomainException::custodyConflict('Asset is under active Preventive Maintenance custody.');
        }

        if (WorkOrder::query()
            ->where('school_id', $asset->school_id)
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->whereKeyNot($workOrder->id)
            ->exists()) {
            throw WorkOrderDomainException::custodyConflict('Asset is already under active corrective custody.');
        }
    }

    private function assertProgressActor(CurrentMembershipContext $context, WorkOrder $workOrder): void
    {
        if ($context->permissions->contains('work-orders.assign')) {
            return;
        }

        $membership = SchoolMembership::query()
            ->with('user')
            ->where('school_id', $context->membership->school_id)
            ->whereKey($workOrder->assignee_membership_id)
            ->first();

        if ($membership === null
            || (string) $membership->id !== (string) $context->membership->id
            || $membership->status !== 'active'
            || $membership->user === null
            || $membership->user->status !== 'active'
            || ! $membership->hasPermission('work-orders.update')) {
            throw WorkOrderDomainException::assigneeIneligible();
        }
    }

    private function resolveIncident(CurrentMembershipContext $context, Asset $asset, mixed $incidentId): ?Incident
    {
        if ($incidentId === null) {
            return null;
        }

        if (! $context->permissions->contains('incidents.view')) {
            throw new WorkOrderDomainException(
                'Incident visibility is required to link a Work Order.',
                'WORK_ORDER_INCIDENT_FORBIDDEN',
                403,
            );
        }

        $incident = $this->incidentVisibility->query($context)
            ->whereKey((string) $incidentId)
            ->lockForUpdate()
            ->first();

        if ($incident === null) {
            throw WorkOrderDomainException::incidentIneligible('Incident is unavailable in the active School.');
        }

        if (in_array($incident->status, [IncidentStatus::Rejected, IncidentStatus::Closed], true)) {
            throw WorkOrderDomainException::incidentIneligible('Rejected or closed Incidents cannot receive new Work Orders.');
        }

        if ($incident->device_id !== null && (string) $asset->linked_device_id !== (string) $incident->device_id) {
            throw WorkOrderDomainException::incidentSubjectMismatch();
        }

        return $incident;
    }

    private function assertVersion(WorkOrder $workOrder, int $expectedVersion): void
    {
        if ($workOrder->version !== $expectedVersion) {
            throw WorkOrderDomainException::versionConflict();
        }
    }

    /** @param list<string> $states */
    private function assertState(WorkOrder $workOrder, array $states, string $message): void
    {
        if (! in_array($workOrder->status, $states, true)) {
            throw WorkOrderDomainException::invalidTransition($message);
        }
    }

    /** @param array<string,mixed> $payload */
    private function writeEvent(
        CurrentMembershipContext $context,
        User $actor,
        WorkOrder $workOrder,
        string $eventType,
        ?string $beforeStatus,
        string $afterStatus,
        array $payload,
    ): void {
        WorkOrderEvent::query()->create([
            'school_id' => $workOrder->school_id,
            'work_order_id' => $workOrder->id,
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

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim((string) $value);
        return $trimmed === '' ? null : $trimmed;
    }
}
