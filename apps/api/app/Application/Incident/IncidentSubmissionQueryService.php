<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentDomainException;
use App\Models\Incident;
use Illuminate\Support\Facades\DB;

final class IncidentSubmissionQueryService
{
    private const SUBMISSION_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';

    public function __construct(private readonly IncidentQueryService $incidents) {}

    public function find(CurrentMembershipContext $context, string $submissionId): Incident
    {
        if (preg_match(self::SUBMISSION_PATTERN, $submissionId) !== 1) {
            throw IncidentDomainException::submissionNotFound();
        }

        $schoolId = (string) $context->membership->school_id;
        $reporterUserId = (string) $context->membership->user_id;
        $incidentId = DB::table('incident_submissions')
            ->join('incidents', function ($join): void {
                $join->on('incidents.id', '=', 'incident_submissions.incident_id')
                    ->on('incidents.school_id', '=', 'incident_submissions.school_id')
                    ->on('incidents.reporter_user_id_snapshot', '=', 'incident_submissions.reporter_user_id_snapshot');
            })
            ->where('incident_submissions.school_id', $schoolId)
            ->where('incident_submissions.reporter_user_id_snapshot', $reporterUserId)
            ->where('incident_submissions.submission_id', $submissionId)
            ->whereNotNull('incident_submissions.incident_id')
            ->value('incidents.id');

        if (! is_string($incidentId) || $incidentId === '') {
            throw IncidentDomainException::submissionNotFound();
        }

        return $this->incidents->find($context, $incidentId);
    }
}
