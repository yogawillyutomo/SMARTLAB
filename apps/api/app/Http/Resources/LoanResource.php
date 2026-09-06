<?php

namespace App\Http\Resources;

use App\Models\LoanItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LoanResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'loanNumber' => $this->loan_number,
            'borrowerReference' => $this->borrower_reference,
            'borrowerNameSnapshot' => $this->borrower_name_snapshot,
            'borrowerUnitSnapshot' => $this->borrower_unit_snapshot,
            'purpose' => $this->purpose,
            'requestedReturnAt' => $this->requested_return_at?->toISOString(),
            'status' => $this->status,
            'isOverdue' => $this->status === 'checked_out' && $this->requested_return_at?->isPast() === true,
            'terminalReason' => $this->terminal_reason,
            'requestedByNameSnapshot' => $this->requested_by_name_snapshot,
            'approvedAt' => $this->approved_at?->toISOString(),
            'approvedByNameSnapshot' => $this->approved_by_name_snapshot,
            'handedOverAt' => $this->handed_over_at?->toISOString(),
            'handedOverByNameSnapshot' => $this->handed_over_by_name_snapshot,
            'returnedAt' => $this->returned_at?->toISOString(),
            'returnedByNameSnapshot' => $this->returned_by_name_snapshot,
            'inspectedAt' => $this->inspected_at?->toISOString(),
            'inspectedByNameSnapshot' => $this->inspected_by_name_snapshot,
            'version' => $this->version,
            'items' => $this->whenLoaded('items', fn () => $this->items
                ->sortBy('asset_code_snapshot')
                ->values()
                ->map(fn (LoanItem $item): array => [
                    'id' => $item->id,
                    'assetId' => $item->asset_id,
                    'assetCodeSnapshot' => $item->asset_code_snapshot,
                    'assetNameSnapshot' => $item->asset_name_snapshot,
                    'conditionOut' => $item->condition_out,
                    'conditionReturn' => $item->condition_return,
                    'returnNotes' => $item->return_notes,
                    'custodyActive' => $item->custody_active,
                ])->all()),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
