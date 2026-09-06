<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InventoryTransactionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'inventoryItemId' => $this->inventory_item_id,
            'clientMutationId' => $this->client_mutation_id,
            'kind' => $this->kind,
            'quantity' => (float) $this->quantity,
            'signedDelta' => (float) $this->signed_delta,
            'balanceBefore' => (float) $this->balance_before,
            'balanceAfter' => (float) $this->balance_after,
            'itemVersionAfter' => $this->item_version_after,
            'reason' => $this->reason,
            'sourceType' => $this->source_type,
            'sourceId' => $this->source_id,
            'actorUserIdSnapshot' => $this->actor_user_id_snapshot,
            'actorMembershipIdSnapshot' => $this->actor_membership_id_snapshot,
            'actorNameSnapshot' => $this->actor_name_snapshot,
            'itemCodeSnapshot' => $this->item_code_snapshot,
            'itemNameSnapshot' => $this->item_name_snapshot,
            'unitSnapshot' => $this->unit_snapshot,
            'occurredAt' => $this->occurred_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
