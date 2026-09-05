<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SessionIssueObservationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => (string) $this->id,
            'sessionId' => (string) $this->session_id,
            'subjectType' => (string) $this->subject_type,
            'referenceId' => $this->reference_id,
            'referenceCode' => $this->reference_code_snapshot,
            'summary' => (string) $this->summary,
            'severity' => (string) $this->severity,
            'observedAt' => $this->observed_at?->toISOString(),
            'observedBy' => [
                'userId' => (string) $this->observed_by_user_id,
                'membershipId' => (string) $this->observed_by_membership_id,
                'name' => (string) $this->observed_by_name_snapshot,
            ],
            'incident' => $this->incident_id === null ? null : [
                'id' => (string) $this->incident_id,
                'ticketNumber' => (string) $this->incident?->ticket_number,
                'status' => $this->incident?->status?->value,
            ],
            'incidentLinkedAt' => $this->incident_linked_at?->toISOString(),
            'version' => (int) $this->version,
            'createdAt' => $this->created_at?->toISOString(),
        ];
    }
}
