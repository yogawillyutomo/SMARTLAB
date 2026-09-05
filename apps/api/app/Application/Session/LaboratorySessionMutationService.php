<?php

namespace App\Application\Session;

use App\Application\Availability\LaboratoryAvailabilityQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Session\LaboratorySessionDomainException;
use App\Models\LaboratorySession;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class LaboratorySessionMutationService
{
    public function __construct(
        private readonly LaboratorySessionSourceResolver $sources,
        private readonly LaboratoryAvailabilityQueryService $availability,
        private readonly LaboratorySessionEventRecorder $recorder,
    ) {
    }

    /** @param array<string,mixed> $data */
    public function prepare(CurrentMembershipContext $context, User $actor, array $data): LaboratorySession
    {
        return DB::transaction(function () use ($context, $actor, $data): LaboratorySession {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $source = $this->sources->resolve($context, (string) $data['sourceType'], (string) $data['sourceId']);
            $existing = $this->existingForSource($schoolId, $source);

            if ($existing !== null) {
                throw LaboratorySessionDomainException::duplicateSource((string) $existing->id);
            }

            $id = (string) Str::ulid();
            $session = new LaboratorySession([
                'school_id' => $schoolId,
                'session_number' => 'SES-'.str_replace('-', '', (string) $source['sourceDate']).'-'.substr($id, -8),
                'source_type' => $source['sourceType'],
                'schedule_occurrence_id' => $source['scheduleOccurrenceId'],
                'reservation_id' => $source['reservationId'],
                'priority_event_id' => $source['priorityEventId'],
                'source_publication_id' => $source['sourcePublicationId'],
                'source_version_evidence' => $source['sourceVersionEvidence'],
                'source_fingerprint' => $source['sourceFingerprint'],
                'source_evidence' => $source['sourceEvidence'],
                'source_owner_membership_id' => $source['sourceOwnerMembershipId'],
                'laboratory_id' => $source['laboratory']->id,
                'source_date' => $source['sourceDate'],
                'source_starts_at' => $source['sourceStartsAt'],
                'source_ends_at' => $source['sourceEndsAt'],
                'activity_kind' => $source['activityKind'],
                'responsible_teacher_id' => $source['responsibleTeacherId'],
                'responsible_name_snapshot' => $source['responsibleNameSnapshot'],
                'academic_class_id' => $source['academicClassId'],
                'subject_id' => $source['subjectId'],
                'planned_participant_count' => $source['plannedParticipantCount'],
                'status' => 'prepared',
                'opening_condition' => $this->nullableTrim($data['openingCondition'] ?? null),
                'closing_condition' => null,
                'end_outcome' => null,
                'operational_notes' => $this->nullableTrim($data['operationalNotes'] ?? null),
                'prepared_by_user_id' => $actor->id,
                'prepared_by_membership_id' => $context->membership->id,
                'started_by_user_id' => null,
                'started_by_membership_id' => null,
                'ended_by_user_id' => null,
                'ended_by_membership_id' => null,
                'actual_started_at' => null,
                'actual_ended_at' => null,
                'cancelled_at' => null,
                'cancellation_reason' => null,
                'version' => 1,
            ]);
            $session->id = $id;
            $session->save();

            $this->recorder->record(
                $context,
                $actor,
                $session,
                'laboratory_session.prepared',
                [
                    'sourceType' => $source['sourceType'],
                    'sourceId' => $source['sourceId'],
                    'sourceFingerprint' => $source['sourceFingerprint'],
                    'laboratoryId' => (string) $source['laboratory']->id,
                    'sourceWindow' => [
                        'date' => $source['sourceDate'],
                        'startsAt' => $source['sourceStartsAt'],
                        'endsAt' => $source['sourceEndsAt'],
                    ],
                ],
                0,
                1,
            );

            return $this->reload($session);
        });
    }

    public function start(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion): LaboratorySession
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): LaboratorySession {
            $session = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $session);
            $this->assertVersion($session, $expectedVersion);

            if ($session->status !== 'prepared') {
                throw LaboratorySessionDomainException::stateConflict('Only prepared Laboratory Sessions may be started.');
            }

            $school = School::query()->whereKey($context->membership->school_id)->firstOrFail();
            $timezone = $school->timezone ?: config('app.timezone', 'UTC');
            $today = now($timezone)->toDateString();
            if ($session->source_date->format('Y-m-d') !== $today) {
                throw LaboratorySessionDomainException::sourceIneligible(
                    'A Laboratory Session may start only on its School-local source date.',
                    ['sourceDate' => $session->source_date->format('Y-m-d'), 'today' => $today],
                );
            }

            try {
                $source = $this->sources->resolve($context, (string) $session->source_type, $session->sourceId());
            } catch (LaboratorySessionDomainException $exception) {
                if (in_array($exception->errorCode, ['LABORATORY_SESSION_SOURCE_NOT_FOUND', 'LABORATORY_SESSION_SOURCE_INELIGIBLE'], true)) {
                    throw LaboratorySessionDomainException::sourceChanged(['reason' => $exception->errorCode]);
                }

                throw $exception;
            }

            if (! hash_equals((string) $session->source_fingerprint, (string) $source['sourceFingerprint'])) {
                throw LaboratorySessionDomainException::sourceChanged([
                    'preparedFingerprint' => (string) $session->source_fingerprint,
                    'currentFingerprint' => (string) $source['sourceFingerprint'],
                ]);
            }

            $exclude = $source['availabilityExclusions'];
            $availability = $this->availability->check(
                $context,
                [
                    'laboratoryId' => (string) $source['laboratory']->id,
                    'date' => (string) $source['sourceDate'],
                    'startsAt' => substr((string) $source['sourceStartsAt'], 0, 5),
                    'endsAt' => substr((string) $source['sourceEndsAt'], 0, 5),
                ],
                $exclude['reservationId'],
                $exclude['scheduleExceptionId'],
                $exclude['scheduleOccurrenceId'],
                $exclude['priorityEventId'],
            );

            if (($availability['available'] ?? false) !== true) {
                throw LaboratorySessionDomainException::startUnavailable($availability);
            }

            $before = $session->version;
            $session->status = 'in_progress';
            $session->started_by_user_id = $actor->id;
            $session->started_by_membership_id = $context->membership->id;
            $session->actual_started_at = now();
            $session->version++;
            $session->save();

            $this->recorder->record(
                $context,
                $actor,
                $session,
                'laboratory_session.started',
                [
                    'sourceFingerprint' => $source['sourceFingerprint'],
                    'availabilityAtStart' => [
                        'state' => $availability['state'],
                        'sourceCoverage' => $availability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                $before,
                $session->version,
            );

            return $this->reload($session);
        });
    }

    /** @param array<string,mixed> $data */
    public function end(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        array $data,
    ): LaboratorySession {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): LaboratorySession {
            $session = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $session);
            $this->assertVersion($session, $expectedVersion);

            if ($session->status !== 'in_progress') {
                throw LaboratorySessionDomainException::stateConflict('Only in-progress Laboratory Sessions may be ended.');
            }

            $before = $session->version;
            $session->status = 'ended';
            $session->end_outcome = (string) $data['endOutcome'];
            $session->closing_condition = $this->nullableTrim($data['closingCondition'] ?? null);
            if (array_key_exists('operationalNotes', $data)) {
                $session->operational_notes = $this->nullableTrim($data['operationalNotes']);
            }
            $session->ended_by_user_id = $actor->id;
            $session->ended_by_membership_id = $context->membership->id;
            $session->actual_ended_at = now();
            $session->version++;
            $session->save();

            $this->recorder->record(
                $context,
                $actor,
                $session,
                'laboratory_session.ended',
                [
                    'endOutcome' => (string) $session->end_outcome,
                    'actualStartedAt' => $session->actual_started_at?->toISOString(),
                    'actualEndedAt' => $session->actual_ended_at?->toISOString(),
                    'activityReportPendingS3_3' => true,
                ],
                $before,
                $session->version,
            );

            return $this->reload($session);
        });
    }

    public function cancel(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): LaboratorySession {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): LaboratorySession {
            $session = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $session);
            $this->assertVersion($session, $expectedVersion);

            if ($session->status !== 'prepared') {
                throw LaboratorySessionDomainException::stateConflict(
                    'Only prepared Laboratory Sessions may be cancelled. End an in-progress Session as interrupted instead.',
                );
            }

            $before = $session->version;
            $session->status = 'cancelled';
            $session->cancelled_at = now();
            $session->cancellation_reason = trim($reason);
            $session->version++;
            $session->save();

            $this->recorder->record(
                $context,
                $actor,
                $session,
                'laboratory_session.cancelled',
                ['reason' => $session->cancellation_reason],
                $before,
                $session->version,
            );

            return $this->reload($session);
        });
    }

    private function lockForMutation(CurrentMembershipContext $context, string $id): LaboratorySession
    {
        $schoolId = (string) $context->membership->school_id;
        School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

        $session = LaboratorySession::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->lockForUpdate()
            ->first();

        if ($session === null) {
            throw LaboratorySessionDomainException::notFound();
        }

        return $session;
    }

    private function assertAccess(CurrentMembershipContext $context, LaboratorySession $session): void
    {
        if ($context->permissions->contains('sessions.view-all')) {
            return;
        }

        if ($session->source_owner_membership_id !== $context->membership->id) {
            throw LaboratorySessionDomainException::notFound();
        }
    }

    private function assertVersion(LaboratorySession $session, int $expectedVersion): void
    {
        if ($session->version !== $expectedVersion) {
            throw LaboratorySessionDomainException::versionConflict();
        }
    }

    /** @param array<string,mixed> $source */
    private function existingForSource(string $schoolId, array $source): ?LaboratorySession
    {
        $column = match ($source['sourceType']) {
            'schedule_occurrence' => 'schedule_occurrence_id',
            'laboratory_reservation' => 'reservation_id',
            'priority_event' => 'priority_event_id',
            default => throw new \LogicException('Unsupported Laboratory Session source type.'),
        };

        return LaboratorySession::query()
            ->where('school_id', $schoolId)
            ->where($column, $source['sourceId'])
            ->whereIn('status', ['prepared', 'in_progress', 'ended'])
            ->first();
    }

    private function reload(LaboratorySession $session): LaboratorySession
    {
        return $session->refresh()->load([
            'laboratory:id,school_id,code,name,capacity,status',
            'responsibleTeacher:id,school_id,code,name,membership_id',
            'academicClass:id,school_id,code,name,student_count',
            'subject:id,school_id,code,name',
            'sourcePublication:id,school_id,source_publication_id,source_version,status',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ]);
    }

    private function nullableTrim(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
