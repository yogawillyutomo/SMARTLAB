<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentSummaryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'ticketNumber' => $this->ticket_number,
            'reporter' => [
                'userId' => $this->reporter_user_id_snapshot,
                'name' => $this->reporter_name_snapshot,
            ],
            'laboratory' => [
                'id' => $this->laboratory_id_snapshot,
                'code' => $this->laboratory_code_snapshot,
                'name' => $this->laboratory_name_snapshot,
            ],
            'device' => $this->device_id_snapshot === null ? null : [
                'id' => $this->device_id_snapshot,
                'deviceCode' => $this->device_code_snapshot,
                'deviceType' => $this->device_type_snapshot,
            ],
            'category' => $this->category->value,
            'priority' => $this->priority->value,
            'title' => $this->title,
            'blocksLaboratoryOperation' => $this->blocks_laboratory_operation,
            'status' => $this->status->value,
            'assignee' => $this->assignee_user_id_snapshot === null ? null : [
                'userId' => $this->assignee_user_id_snapshot,
                'name' => $this->assignee_name_snapshot,
            ],
            'version' => $this->version,
            'occurredAt' => $this->occurred_at?->toISOString(),
            'reportedAt' => $this->reported_at?->toISOString(),
        ];
    }
}
