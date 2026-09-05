<?php

namespace App\Application\Session;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Domain\Incident\IncidentCatalog;
use App\Domain\Session\SessionIssueObservationDomainException;
use App\Models\Device;
use App\Models\LaboratorySession;
use App\Models\School;
use App\Models\SessionIssueObservation;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SessionIssueObservationService
{
    /** @return Collection<int,SessionIssueObservation> */
    public function list(CurrentMembershipContext $context, string $sessionId): Collection
    {
        $session = $this->sessionForRead($context, $sessionId);

        return SessionIssueObservation::query()
            ->where('school_id', $context->membership->school_id)
            ->where('session_id', $session->id)
            ->with('incident:id,school_id,ticket_number,status')
            ->orderBy('observed_at')
            ->orderBy('id')
            ->get();
    }

    /** @param array<string,mixed> $data */
    public function create(
        CurrentMembershipContext $context,
        User $actor,
        string $sessionId,
        array $data,
    ): SessionIssueObservation {
        return DB::transaction(function () use ($context, $actor, $sessionId, $data): SessionIssueObservation {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $session = LaboratorySession::query()
                ->where('school_id', $schoolId)
                ->whereKey($sessionId)
                ->with('activityReport:id,school_id,session_id,status')
                ->lockForUpdate()
                ->first();

            if ($session === null) {
                throw SessionIssueObservationDomainException::sessionNotFound();
            }
            $this->assertAccess($context, $session);
            $this->assertObservationWindowOpen($session);

            $observedAt = CarbonImmutable::parse((string) $data['observedAt'])->utc();
            if ($session->actual_started_at === null || $observedAt->lessThan($session->actual_started_at)) {
                throw SessionIssueObservationDomainException::stateConflict(
                    'Observation time must not precede the actual Session start.',
                );
            }
            $latest = $session->status === 'ended' ? $session->actual_ended_at : CarbonImmutable::now('UTC');
            if ($latest === null || $observedAt->greaterThan($latest)) {
                throw SessionIssueObservationDomainException::stateConflict(
                    'Observation time must fall inside the actual execution window.',
                );
            }

            $subjectType = (string) $data['subjectType'];
            $referenceId = isset($data['referenceId']) ? trim((string) $data['referenceId']) : null;
            $referenceCode = null;

            if ($subjectType === 'device') {
                $device = Device::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($referenceId)
                    ->lockForUpdate()
                    ->first();

                if ($device === null
                    || $device->home_laboratory_id !== $session->laboratory_id
                    || ! in_array($device->lifecycle_status, IncidentCatalog::REPORTING_DEVICE_LIFECYCLE_STATUSES, true)) {
                    throw SessionIssueObservationDomainException::invalidSubjectReference(
                        'The selected Device is not an eligible canonical Device in this Session Laboratory.',
                    );
                }

                $referenceId = (string) $device->id;
                $referenceCode = (string) $device->device_code;
            } elseif ($referenceId !== null && $referenceId !== '') {
                throw SessionIssueObservationDomainException::invalidSubjectReference(
                    'Only canonical Device references are supported in S3.5.',
                );
            } else {
                $referenceId = null;
            }

            $observation = SessionIssueObservation::query()->create([
                'school_id' => $schoolId,
                'session_id' => $session->id,
                'subject_type' => $subjectType,
                'reference_id' => $referenceId,
                'reference_code_snapshot' => $referenceCode,
                'summary' => trim((string) $data['summary']),
                'severity' => (string) $data['severity'],
                'observed_at' => $observedAt,
                'observed_by_user_id' => $actor->id,
                'observed_by_membership_id' => $context->membership->id,
                'observed_by_name_snapshot' => $actor->name,
                'promotion_submission_id' => Str::uuid()->toString(),
                'incident_id' => null,
                'incident_linked_at' => null,
                'incident_linked_by_user_id' => null,
                'incident_linked_by_membership_id' => null,
                'version' => 1,
                'created_at' => now(),
            ]);

            return $this->reload($observation);
        });
    }

    /** @param array<string,mixed> $data */
    public function promote(
        CurrentMembershipContext $context,
        User $actor,
        string $observationId,
        array $data,
        IncidentCreationService $incidents,
    ): SessionIssueObservation {
        return DB::transaction(function () use ($context, $actor, $observationId, $data, $incidents): SessionIssueObservation {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $observation = SessionIssueObservation::query()
                ->where('school_id', $schoolId)
                ->whereKey($observationId)
                ->with('session:id,school_id,laboratory_id,source_owner_membership_id')
                ->lockForUpdate()
                ->first();

            if ($observation === null || $observation->session === null) {
                throw SessionIssueObservationDomainException::notFound();
            }
            $this->assertAccess($context, $observation->session);

            if ($observation->incident_id !== null) {
                return $this->reload($observation);
            }

            $result = $incidents->create(
                $context,
                (string) $observation->promotion_submission_id,
                [
                    'laboratoryId' => (string) $observation->session->laboratory_id,
                    'deviceId' => $observation->subject_type === 'device' ? $observation->reference_id : null,
                    'category' => (string) $data['category'],
                    'priority' => (string) $data['priority'],
                    'title' => trim((string) $data['title']),
                    'description' => trim((string) $data['description']),
                    'impact' => $this->nullableTrim($data['impact'] ?? null),
                    'blocksLaboratoryOperation' => (bool) $data['blocksLaboratoryOperation'],
                    'stepsTaken' => $this->nullableTrim($data['stepsTaken'] ?? null),
                    'occurredAt' => $observation->observed_at->toISOString(),
                ],
            );

            $observation->incident_id = $result->incident->id;
            $observation->incident_linked_at = now();
            $observation->incident_linked_by_user_id = $actor->id;
            $observation->incident_linked_by_membership_id = $context->membership->id;
            $observation->version++;
            $observation->save();

            return $this->reload($observation);
        });
    }

    private function sessionForRead(CurrentMembershipContext $context, string $sessionId): LaboratorySession
    {
        $session = LaboratorySession::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($sessionId)
            ->first();

        if ($session === null) {
            throw SessionIssueObservationDomainException::sessionNotFound();
        }

        $this->assertAccess($context, $session);

        return $session;
    }

    private function assertAccess(CurrentMembershipContext $context, LaboratorySession $session): void
    {
        if ($context->permissions->contains('session-observations.view-all')) {
            return;
        }

        if ($session->source_owner_membership_id !== $context->membership->id) {
            throw SessionIssueObservationDomainException::sessionNotFound();
        }
    }

    private function assertObservationWindowOpen(LaboratorySession $session): void
    {
        if ($session->status === 'in_progress') {
            return;
        }

        if ($session->status === 'ended' && $session->activityReport?->status === 'draft') {
            return;
        }

        throw SessionIssueObservationDomainException::stateConflict(
            'Observations may be added only while a Session is in progress or while its Activity Report is an editable draft.',
        );
    }

    private function reload(SessionIssueObservation $observation): SessionIssueObservation
    {
        return $observation->fresh(['incident:id,school_id,ticket_number,status'])
            ?? throw new \LogicException('Session issue observation disappeared after persistence.');
    }

    private function nullableTrim(mixed $value): ?string
    {
        if ($value === null) return null;
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }
}
