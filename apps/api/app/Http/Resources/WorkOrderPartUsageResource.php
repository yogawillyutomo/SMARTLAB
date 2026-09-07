<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WorkOrderPartUsageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'workOrderId' => $this->work_order_id,
            'inventoryTransactionId' => $this->inventory_transaction_id,
            'inventoryItemId' => $this->inventory_item_id,
            'clientMutationId' => $this->client_mutation_id,
            'itemCodeSnapshot' => $this->item_code_snapshot,
            'itemNameSnapshot' => $this->item_name_snapshot,
            'unitSnapshot' => $this->unit_snapshot,
            'quantity' => (float) $this->quantity,
            'actorUserIdSnapshot' => $this->actor_user_id_snapshot,
            'actorMembershipIdSnapshot' => $this->actor_membership_id_snapshot,
            'actorNameSnapshot' => $this->actor_name_snapshot,
            'usedAt' => $this->used_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
