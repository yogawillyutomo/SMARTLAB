<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WorkOrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schoolId' => $this->school_id,
            'workOrderNumber' => $this->work_order_number,
            'incidentId' => $this->incident_id,
            'incidentTicketSnapshot' => $this->incident_ticket_snapshot,
            'assetId' => $this->asset_id,
            'assetCodeSnapshot' => $this->asset_code_snapshot,
            'assetNameSnapshot' => $this->asset_name_snapshot,
            'laboratoryId' => $this->laboratory_id,
            'laboratoryCodeSnapshot' => $this->laboratory_code_snapshot,
            'laboratoryNameSnapshot' => $this->laboratory_name_snapshot,
            'problemSummary' => $this->problem_summary,
            'priority' => $this->priority,
            'scheduledFor' => $this->scheduled_for?->toDateString(),
            'notes' => $this->notes,
            'status' => $this->status,
            'assigneeMembershipId' => $this->assignee_membership_id,
            'assigneeUserIdSnapshot' => $this->assignee_user_id_snapshot,
            'assigneeMembershipIdSnapshot' => $this->assignee_membership_id_snapshot,
            'assigneeNameSnapshot' => $this->assignee_name_snapshot,
            'diagnosis' => $this->diagnosis,
            'actionTaken' => $this->action_taken,
            'testResult' => $this->test_result,
            'conditionBefore' => $this->condition_before,
            'conditionAfter' => $this->condition_after,
            'assetVersionAtStart' => $this->asset_version_at_start,
            'custodyActive' => $this->custody_active,
            'startedAt' => $this->started_at?->toISOString(),
            'completedAt' => $this->completed_at?->toISOString(),
            'verifiedAt' => $this->verified_at?->toISOString(),
            'cancelledAt' => $this->cancelled_at?->toISOString(),
            'cancelReason' => $this->cancel_reason,
            'version' => $this->version,
            'createdAt' => $this->created_at?->toISOString(),
            'updatedAt' => $this->updated_at?->toISOString(),
        ];
    }
}
