<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceCampaignResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'campaignCode' => $this->campaign_code,
            'laboratoryId' => $this->laboratory_id,
            'laboratoryCodeSnapshot' => $this->laboratory_code_snapshot,
            'laboratoryNameSnapshot' => $this->laboratory_name_snapshot,
            'name' => $this->name,
            'description' => $this->description,
            'frequencyKind' => $this->frequency_kind,
            'intervalDays' => $this->interval_days,
            'checklistTemplate' => $this->checklist_template,
            'assignedTechnicianReference' => $this->assigned_technician_reference,
            'assignedTechnicianNameSnapshot' => $this->assigned_technician_name_snapshot,
            'nextDueDate' => $this->next_due_date?->toDateString(),
            'status' => $this->status,
            'itemCount' => $this->items->count(),
            'items' => MaintenanceCampaignItemResource::collection($this->items)->resolve($request),
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
