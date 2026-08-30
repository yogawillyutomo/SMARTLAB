<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class IncidentResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $assigneeMembershipId = $this->getAttribute('assignee_membership_id_projection')
            ?? $this->assignee_membership_id;

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
            'description' => $this->description,
            'impact' => $this->impact,
            'blocksLaboratoryOperation' => $this->blocks_laboratory_operation,
            'stepsTaken' => $this->steps_taken,
            'status' => $this->status->value,
            'assignee' => $this->assignee_user_id_snapshot === null ? null : [
                'membershipId' => $assigneeMembershipId,
                'userId' => $this->assignee_user_id_snapshot,
                'name' => $this->assignee_name_snapshot,
            ],
            'triageSummary' => $this->triage_summary,
            'resolutionSummary' => $this->resolution_summary,
            'rejectionReason' => $this->rejection_reason,
            'verificationNote' => $this->verification_note,
            'version' => $this->version,
            'occurredAt' => $this->occurred_at?->toISOString(),
            'reportedAt' => $this->reported_at?->toISOString(),
            'triagedAt' => $this->triaged_at?->toISOString(),
            'assignedAt' => $this->assigned_at?->toISOString(),
            'startedAt' => $this->started_at?->toISOString(),
            'resolvedAt' => $this->resolved_at?->toISOString(),
            'verifiedAt' => $this->verified_at?->toISOString(),
            'closedAt' => $this->closed_at?->toISOString(),
            'rejectedAt' => $this->rejected_at?->toISOString(),
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
