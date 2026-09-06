<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenancePlanResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'planCode' => $this->plan_code,
            'assetId' => $this->asset_id,
            'assetCodeSnapshot' => $this->asset_code_snapshot,
            'assetNameSnapshot' => $this->asset_name_snapshot,
            'name' => $this->name,
            'frequencyKind' => $this->frequency_kind,
            'intervalDays' => $this->interval_days,
            'checklistTemplate' => $this->checklist_template,
            'assignedTechnicianReference' => $this->assigned_technician_reference,
            'assignedTechnicianNameSnapshot' => $this->assigned_technician_name_snapshot,
            'nextDueDate' => $this->next_due_date?->toDateString(),
            'status' => $this->status,
            'isOverdue' => $this->status === 'active' && $this->next_due_date?->isBefore(today()) === true,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
