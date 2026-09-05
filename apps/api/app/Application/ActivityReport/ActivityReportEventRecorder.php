<?php

namespace App\Application\ActivityReport;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\ActivityReport;
use App\Models\ActivityReportEvent;
use App\Models\User;

class ActivityReportEventRecorder
{
    /** @param array<string,mixed> $payload */
    public function record(
        CurrentMembershipContext $context,
        User $actor,
        ActivityReport $report,
        string $eventType,
        array $payload,
        int $before,
        int $after,
    ): void {
        ActivityReportEvent::query()->create([
            'school_id' => $context->membership->school_id,
            'report_id' => $report->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'payload' => $payload,
            'entity_version_before' => $before,
            'entity_version_after' => $after,
            'created_at' => now(),
        ]);
    }
}
