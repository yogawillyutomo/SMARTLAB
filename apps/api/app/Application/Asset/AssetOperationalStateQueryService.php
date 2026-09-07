<?php

namespace App\Application\Asset;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Models\Asset;
use App\Models\Device;
use App\Models\LoanItem;
use App\Models\MaintenanceExecution;
use App\Models\WorkOrder;

class AssetOperationalStateQueryService
{
    /**
     * @return array{
     *   assetId:string,
     *   state:string,
     *   integrityCode:?string,
     *   provenance:array<string,mixed>
     * }
     */
    public function forAsset(CurrentMembershipContext $context, string $assetId): array
    {
        $schoolId = (string) $context->membership->school_id;
        $asset = Asset::query()
            ->where('school_id', $schoolId)
            ->whereKey($assetId)
            ->first();

        if ($asset === null) {
            throw new AssetDomainException('Asset not found.', 'ASSET_NOT_FOUND', 404);
        }

        $loanItems = LoanItem::query()
            ->with('loan:id,status')
            ->where('school_id', $schoolId)
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->orderBy('id')
            ->get();

        $maintenanceExecutions = MaintenanceExecution::query()
            ->where('school_id', $schoolId)
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->orderBy('id')
            ->get(['id', 'maintenance_plan_id', 'status']);

        $workOrders = WorkOrder::query()
            ->where('school_id', $schoolId)
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->orderBy('id')
            ->get(['id', 'work_order_number', 'status']);

        $linkedDevice = null;
        $linkedDeviceScopeValid = true;
        if ($asset->linked_device_id !== null) {
            $device = Device::query()
                ->where('school_id', $schoolId)
                ->whereKey($asset->linked_device_id)
                ->first(['id', 'lifecycle_status']);

            if ($device === null) {
                $linkedDeviceScopeValid = false;
            } else {
                $linkedDevice = [
                    'deviceId' => (string) $device->id,
                    'lifecycleStatus' => (string) $device->lifecycle_status,
                ];
            }
        }

        $loanCustodies = $loanItems->map(fn (LoanItem $item): array => [
            'loanId' => (string) $item->loan_id,
            'loanItemId' => (string) $item->id,
            'status' => (string) ($item->loan?->status ?? 'unknown'),
        ])->values()->all();

        $maintenanceCustodies = $maintenanceExecutions->map(fn (MaintenanceExecution $execution): array => [
            'executionId' => (string) $execution->id,
            'maintenancePlanId' => (string) $execution->maintenance_plan_id,
            'status' => (string) $execution->status,
        ])->values()->all();

        $workOrderCustodies = $workOrders->map(fn (WorkOrder $workOrder): array => [
            'workOrderId' => (string) $workOrder->id,
            'workOrderNumber' => (string) $workOrder->work_order_number,
            'status' => (string) $workOrder->status,
        ])->values()->all();

        [$state, $integrityCode] = $this->derive(
            (string) $asset->lifecycle_status,
            (string) $asset->condition,
            $loanCustodies,
            $maintenanceCustodies,
            $workOrderCustodies,
            $linkedDevice,
            $linkedDeviceScopeValid,
        );

        return [
            'assetId' => (string) $asset->id,
            'state' => $state,
            'integrityCode' => $integrityCode,
            'provenance' => [
                'asset' => [
                    'lifecycleStatus' => (string) $asset->lifecycle_status,
                    'condition' => (string) $asset->condition,
                    'version' => (int) $asset->version,
                ],
                'loanCustodies' => $loanCustodies,
                'maintenanceCustodies' => $maintenanceCustodies,
                'workOrderCustodies' => $workOrderCustodies,
                'linkedDevice' => $linkedDevice,
            ],
        ];
    }

    /**
     * @param list<array<string,string>> $loanCustodies
     * @param list<array<string,string>> $maintenanceCustodies
     * @param list<array<string,string>> $workOrderCustodies
     * @param array{deviceId:string,lifecycleStatus:string}|null $linkedDevice
     * @return array{string,?string}
     */
    private function derive(
        string $lifecycle,
        string $condition,
        array $loanCustodies,
        array $maintenanceCustodies,
        array $workOrderCustodies,
        ?array $linkedDevice,
        bool $linkedDeviceScopeValid,
    ): array {
        if (count($loanCustodies) > 1) {
            return ['unknown', 'MULTIPLE_ACTIVE_LOAN_CUSTODY'];
        }

        if (count($maintenanceCustodies) > 1) {
            return ['unknown', 'MULTIPLE_ACTIVE_MAINTENANCE_CUSTODY'];
        }

        if (count($workOrderCustodies) > 1) {
            return ['unknown', 'MULTIPLE_ACTIVE_WORK_ORDER_CUSTODY'];
        }

        $activeKinds = (int) ($loanCustodies !== [])
            + (int) ($maintenanceCustodies !== [])
            + (int) ($workOrderCustodies !== []);

        if ($activeKinds > 1) {
            return ['unknown', 'CONFLICTING_ACTIVE_CUSTODY'];
        }

        if ($lifecycle !== 'active'
            && ($loanCustodies !== [] || $maintenanceCustodies !== [] || $workOrderCustodies !== [])) {
            return ['unknown', 'LIFECYCLE_CUSTODY_CONFLICT'];
        }

        if (! $linkedDeviceScopeValid) {
            return ['unknown', 'LINKED_DEVICE_SCOPE_MISMATCH'];
        }

        if ($lifecycle === 'disposed') {
            return ['disposed', null];
        }

        if ($lifecycle === 'retired') {
            return ['retired', null];
        }

        if ($lifecycle !== 'active') {
            return ['unknown', 'UNKNOWN_ASSET_LIFECYCLE'];
        }

        if ($loanCustodies !== []) {
            return ['on_loan', null];
        }

        if ($maintenanceCustodies !== []) {
            return ['in_maintenance', null];
        }

        if ($workOrderCustodies !== []) {
            return ['in_repair', null];
        }

        if (! in_array($condition, ['good', 'minor_damage'], true)) {
            return ['blocked_condition', null];
        }

        if ($linkedDevice !== null
            && ! in_array($linkedDevice['lifecycleStatus'], ['in_service', 'spare'], true)) {
            return ['unknown', 'LINKED_DEVICE_LIFECYCLE_BLOCKED'];
        }

        return ['available', null];
    }
}
