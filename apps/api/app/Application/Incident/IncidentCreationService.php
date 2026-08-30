<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\Fingerprint\IncidentFingerprintRegistry;
use App\Domain\Incident\IncidentAggregateValidator;
use App\Domain\Incident\IncidentCatalog;
use App\Domain\Incident\IncidentCreatePayloadValidator;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentStatus;
use App\Models\Device;
use App\Models\Incident;
use App\Models\Laboratory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

final class IncidentCreationService
{
    private const SUBMISSION_PATTERN = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';

    public function __construct(
        private readonly IncidentFingerprintRegistry $fingerprints,
        private readonly IncidentTicketAllocator $tickets,
        private readonly IncidentEventRecorder $events,
        private readonly IncidentAggregateValidator $aggregateValidator,
        private readonly IncidentCreatePayloadValidator $payloadValidator,
    ) {}

    /** @param array<string, mixed> $businessPayload */
    public function create(
        CurrentMembershipContext $context,
        string $submissionId,
        array $businessPayload,
    ): IncidentCreationResult {
        if (preg_match(self::SUBMISSION_PATTERN, $submissionId) !== 1) {
            throw new InvalidArgumentException('submissionId must be a canonical lowercase UUID v4.');
        }

        $receiptTime = CarbonImmutable::now('UTC');
        $context->membership->loadMissing('user');
        $membership = $context->membership;
        $reporter = $membership->user;
        $schoolId = (string) $membership->school_id;

        return DB::transaction(function () use (
            $context,
            $submissionId,
            $businessPayload,
            $membership,
            $reporter,
            $schoolId,
            $receiptTime,
        ): IncidentCreationResult {
            $this->serializeSubmissionKey($schoolId, (string) $reporter->id, $submissionId);

            $submission = DB::table('incident_submissions')
                ->where('school_id', $schoolId)
                ->where('reporter_user_id_snapshot', $reporter->id)
                ->where('submission_id', $submissionId)
                ->lockForUpdate()
                ->first();

            if ($submission !== null) {
                $storedAlgorithm = $this->fingerprints->forVersion((int) $submission->payload_fingerprint_version);
                $storedNormalized = $storedAlgorithm->canonicalize($businessPayload);
                $this->payloadValidator->validate($businessPayload, $storedNormalized, $receiptTime);
                if (! hash_equals((string) $submission->payload_fingerprint, $storedAlgorithm->fingerprint($businessPayload))) {
                    throw IncidentDomainException::submissionConflict();
                }
                if ($submission->incident_id === null) {
                    throw new \LogicException('A committed Incident submission has no Incident mapping.');
                }

                $incident = Incident::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($submission->incident_id)
                    ->firstOrFail();

                return new IncidentCreationResult($incident, true);
            }

            $algorithm = $this->fingerprints->current();
            $normalized = $algorithm->canonicalize($businessPayload);
            $this->payloadValidator->validate($businessPayload, $normalized, $receiptTime);
            $fingerprint = $algorithm->fingerprint($businessPayload);

            DB::table('incident_submissions')->insert([
                'school_id' => $schoolId,
                'reporter_user_id_snapshot' => $reporter->id,
                'submission_id' => $submissionId,
                'payload_fingerprint' => $fingerprint,
                'payload_fingerprint_version' => $algorithm->version(),
                'incident_id' => null,
                'created_at' => now(),
            ]);

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($normalized['laboratoryId'])
                ->lockForUpdate()
                ->first();
            if ($laboratory === null || $laboratory->status !== 'active') {
                throw IncidentDomainException::laboratoryIneligible();
            }

            $device = null;
            if ($normalized['deviceId'] !== null) {
                $device = Device::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($normalized['deviceId'])
                    ->lockForUpdate()
                    ->first();
                if ($device === null
                    || ! in_array($device->lifecycle_status, IncidentCatalog::REPORTING_DEVICE_LIFECYCLE_STATUSES, true)
                    || $device->home_laboratory_id !== $laboratory->id) {
                    throw IncidentDomainException::deviceIneligible();
                }
            }

            $now = $receiptTime;
            $ticket = $this->tickets->allocate($schoolId, $now);
            $incidentAttributes = [
                'school_id' => $schoolId,
                'ticket_year' => $ticket['year'],
                'ticket_sequence' => $ticket['sequence'],
                'ticket_number' => $ticket['ticketNumber'],
                'reporter_user_id' => $reporter->id,
                'reporter_membership_id' => $membership->id,
                'reporter_user_id_snapshot' => $reporter->id,
                'reporter_membership_id_snapshot' => $membership->id,
                'reporter_name_snapshot' => $reporter->name,
                'laboratory_id' => $laboratory->id,
                'laboratory_id_snapshot' => $laboratory->id,
                'laboratory_code_snapshot' => $laboratory->code,
                'laboratory_name_snapshot' => $laboratory->name,
                'device_id' => $device?->id,
                'device_id_snapshot' => $device?->id,
                'device_code_snapshot' => $device?->device_code,
                'device_type_snapshot' => $device?->device_type,
                'category' => $normalized['category'],
                'priority' => $normalized['priority'],
                'title' => $normalized['title'],
                'description' => $normalized['description'],
                'impact' => $normalized['impact'],
                'blocks_laboratory_operation' => $normalized['blocksLaboratoryOperation'],
                'steps_taken' => $normalized['stepsTaken'],
                'occurred_at' => CarbonImmutable::parse($normalized['occurredAt']),
                'status' => IncidentStatus::Reported,
                'reported_at' => $now,
                'version' => 1,
            ];
            $this->aggregateValidator->validate($incidentAttributes);
            $incident = Incident::query()->create($incidentAttributes);

            $this->events->record(
                $incident,
                $context,
                IncidentEventType::Reported,
                0,
                1,
                [
                    'reporter' => ['userId' => $reporter->id, 'membershipId' => $membership->id, 'name' => $reporter->name],
                    'laboratory' => ['id' => $laboratory->id, 'code' => $laboratory->code, 'name' => $laboratory->name],
                    'device' => $device === null ? null : ['id' => $device->id, 'deviceCode' => $device->device_code, 'deviceType' => $device->device_type],
                    'category' => $normalized['category'],
                    'priority' => $normalized['priority'],
                    'title' => $normalized['title'],
                    'description' => $normalized['description'],
                    'impact' => $normalized['impact'],
                    'blocksLaboratoryOperation' => $normalized['blocksLaboratoryOperation'],
                    'stepsTaken' => $normalized['stepsTaken'],
                    'occurredAt' => $normalized['occurredAt'],
                    'reportedAt' => $now->format('Y-m-d\TH:i:s.u\Z'),
                ],
                $now,
            );

            $updated = DB::table('incident_submissions')
                ->where('school_id', $schoolId)
                ->where('reporter_user_id_snapshot', $reporter->id)
                ->where('submission_id', $submissionId)
                ->whereNull('incident_id')
                ->update(['incident_id' => $incident->id]);
            if ($updated !== 1) {
                throw new \LogicException('Incident submission mapping was not committed exactly once.');
            }

            return new IncidentCreationResult($incident, false);
        });
    }

    private function serializeSubmissionKey(string $schoolId, string $reporterId, string $submissionId): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        $key = "incident-submission:{$schoolId}:{$reporterId}:{$submissionId}";
        DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [$key]);
    }
}
