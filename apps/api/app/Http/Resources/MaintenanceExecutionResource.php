<?php

namespace App\Http\Resources;

use App\Models\InventoryTransaction;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceExecutionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'executionNumber' => $this->execution_number,
            'maintenancePlanId' => $this->maintenance_plan_id,
            'planCodeSnapshot' => $this->plan_code_snapshot,
            'assetId' => $this->asset_id,
            'assetCodeSnapshot' => $this->asset_code_snapshot,
            'assetNameSnapshot' => $this->asset_name_snapshot,
            'scheduledFor' => $this->scheduled_for?->toDateString(),
            'status' => $this->status,
            'checklistSnapshot' => $this->checklist_snapshot,
            'checklistResults' => $this->checklist_results,
            'findings' => $this->findings,
            'actionTaken' => $this->action_taken,
            'conditionBefore' => $this->condition_before,
            'conditionAfter' => $this->condition_after,
            'technicianReference' => $this->technician_reference,
            'technicianNameSnapshot' => $this->technician_name_snapshot,
            'assetVersionAtStart' => $this->asset_version_at_start,
            'custodyActive' => $this->custody_active,
            'startedAt' => $this->started_at?->toISOString(),
            'completedAt' => $this->completed_at?->toISOString(),
            'cancelledAt' => $this->cancelled_at?->toISOString(),
            'cancelReason' => $this->cancel_reason,
            'version' => $this->version,
            'inventoryTransactions' => $this->whenLoaded('inventoryTransactions', fn () => $this->inventoryTransactions
                ->sortBy('created_at')
                ->values()
                ->map(fn (InventoryTransaction $transaction): array => [
                    'id' => $transaction->id,
                    'inventoryItemId' => $transaction->inventory_item_id,
                    'clientMutationId' => $transaction->client_mutation_id,
                    'quantity' => (float) $transaction->quantity,
                    'signedDelta' => (float) $transaction->signed_delta,
                    'balanceBefore' => (float) $transaction->balance_before,
                    'balanceAfter' => (float) $transaction->balance_after,
                    'itemCodeSnapshot' => $transaction->item_code_snapshot,
                    'itemNameSnapshot' => $transaction->item_name_snapshot,
                    'unitSnapshot' => $transaction->unit_snapshot,
                    'occurredAt' => $transaction->occurred_at?->toISOString(),
                ])->all()),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
