<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentAggregateValidator;
use App\Domain\Incident\IncidentCatalog;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Domain\Incident\IncidentStatus;
use App\Models\Device;
use App\Models\Incident;
use App\Models\Laboratory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

final class IncidentCorrectionService
{
    public function __construct(
        private readonly IncidentVisibility $visibility,
        private readonly IncidentSubjectLockPlan $lockPlan,
        private readonly IncidentEventRecorder $events,
        private readonly IncidentAggregateValidator $aggregateValidator,
    ) {}

    /** @param array<string, mixed> $payload */
    public function correct(
        CurrentMembershipContext $context,
        string $incidentId,
        int $expectedVersion,
        array $payload,
    ): Incident {
        return DB::transaction(function () use ($context, $incidentId, $expectedVersion, $payload): Incident {
            $routing = $this->visibility->query($context)
                ->select(['id', 'laboratory_id_snapshot', 'device_id_snapshot', 'version'])
                ->whereKey($incidentId)
                ->first();
            if ($routing === null) {
                throw IncidentDomainException::incidentNotFound();
            }
            $routingEvidence = new IncidentRoutingEvidence(
                (string) $routing->laboratory_id_snapshot,
                $routing->device_id_snapshot,
                (int) $routing->version,
            );

            $finalLaboratoryId = array_key_exists('laboratoryId', $payload)
                ? $payload['laboratoryId']
                : $routingEvidence->laboratoryId;
            $finalDeviceId = array_key_exists('deviceId', $payload)
                ? $payload['deviceId']
                : $routingEvidence->deviceId;
            $subjectChanged = $finalLaboratoryId !== $routingEvidence->laboratoryId
                || $finalDeviceId !== $routingEvidence->deviceId;

            /** @var Collection<string, Laboratory> $laboratories */
            $laboratories = collect();
            /** @var Collection<string, Device> $devices */
            $devices = collect();

            if ($subjectChanged) {
                $plan = $this->lockPlan->build(
                    $routingEvidence->laboratoryId,
                    $finalLaboratoryId,
                    $routingEvidence->deviceId,
                    $finalDeviceId,
                );
                $schoolId = (string) $context->membership->school_id;
                $laboratories = Laboratory::query()
                    ->where('school_id', $schoolId)
                    ->whereIn('id', $plan['laboratoryIds'])
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');
                $devices = Device::query()
                    ->where('school_id', $schoolId)
                    ->whereIn('id', $plan['deviceIds'])
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');
            }

            $incident = $this->visibility->query($context)
                ->whereKey($incidentId)
                ->lockForUpdate()
                ->first();
            if ($incident === null) {
                throw IncidentDomainException::incidentNotFound();
            }
            if ((int) $incident->version !== $expectedVersion) {
                throw IncidentDomainException::versionConflict();
            }
            if ($subjectChanged) {
                $routingEvidence->assertUnchanged($incident);
            } elseif ($this->payloadChangesLockedSubject($incident, $payload)) {
                throw IncidentDomainException::versionConflict();
            }
            if ($incident->status !== IncidentStatus::Reported) {
                throw IncidentDomainException::statusConflict();
            }

            $finalLaboratory = null;
            $finalDevice = null;
            if ($subjectChanged) {
                $finalLaboratory = $laboratories->get($finalLaboratoryId);
                if ($finalLaboratory === null || $finalLaboratory->status !== 'active') {
                    throw IncidentDomainException::laboratoryIneligible();
                }
                if ($finalDeviceId !== null) {
                    $finalDevice = $devices->get($finalDeviceId);
                    if ($finalDevice === null
                        || ! in_array($finalDevice->lifecycle_status, IncidentCatalog::REPORTING_DEVICE_LIFECYCLE_STATUSES, true)
                        || $finalDevice->home_laboratory_id !== $finalLaboratoryId) {
                        throw IncidentDomainException::deviceIneligible();
                    }
                }
            }

            $beforeState = $this->logicalState($incident);
            $changedFields = [];
            foreach ($payload as $field => $value) {
                if ($beforeState[$field] !== $value) {
                    $changedFields[] = $field;
                }
            }
            sort($changedFields, SORT_STRING);

            if ($changedFields === []) {
                return $incident;
            }

            $before = [];
            $after = [];
            foreach ($changedFields as $field) {
                $before[$field] = $beforeState[$field];
                $after[$field] = $payload[$field];
                $this->applyLogicalField($incident, $field, $payload[$field]);
            }

            if (in_array('laboratoryId', $changedFields, true)) {
                $incident->laboratory_id_snapshot = $finalLaboratory->id;
                $incident->laboratory_code_snapshot = $finalLaboratory->code;
                $incident->laboratory_name_snapshot = $finalLaboratory->name;
            }
            if (in_array('deviceId', $changedFields, true)) {
                $incident->device_id_snapshot = $finalDevice?->id;
                $incident->device_code_snapshot = $finalDevice?->device_code;
                $incident->device_type_snapshot = $finalDevice?->device_type;
            }

            $versionBefore = (int) $incident->version;
            $incident->version = $versionBefore + 1;
            $this->aggregateValidator->validate($incident->getAttributes());
            $incident->save();

            $this->events->record(
                $incident,
                $context,
                IncidentEventType::Updated,
                $versionBefore,
                (int) $incident->version,
                [
                    'changedFields' => $changedFields,
                    'before' => $before,
                    'after' => $after,
                ],
            );

            return $incident;
        });
    }

    /** @param array<string, mixed> $payload */
    private function payloadChangesLockedSubject(Incident $incident, array $payload): bool
    {
        $laboratoryChanged = array_key_exists('laboratoryId', $payload)
            && $payload['laboratoryId'] !== $incident->laboratory_id_snapshot;
        $deviceChanged = array_key_exists('deviceId', $payload)
            && $payload['deviceId'] !== $incident->device_id_snapshot;

        return $laboratoryChanged || $deviceChanged;
    }

    /** @return array<string, mixed> */
    private function logicalState(Incident $incident): array
    {
        return [
            'laboratoryId' => $incident->laboratory_id_snapshot,
            'deviceId' => $incident->device_id_snapshot,
            'category' => $incident->category->value,
            'priority' => $incident->priority->value,
            'title' => $incident->title,
            'description' => $incident->description,
            'impact' => $incident->impact,
            'blocksLaboratoryOperation' => $incident->blocks_laboratory_operation,
            'stepsTaken' => $incident->steps_taken,
            'occurredAt' => $incident->occurred_at?->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ];
    }

    private function applyLogicalField(Incident $incident, string $field, mixed $value): void
    {
        match ($field) {
            'laboratoryId' => $incident->laboratory_id = $value,
            'deviceId' => $incident->device_id = $value,
            'category' => $incident->category = $value,
            'priority' => $incident->priority = $value,
            'title' => $incident->title = $value,
            'description' => $incident->description = $value,
            'impact' => $incident->impact = $value,
            'blocksLaboratoryOperation' => $incident->blocks_laboratory_operation = $value,
            'stepsTaken' => $incident->steps_taken = $value,
            'occurredAt' => $incident->occurred_at = CarbonImmutable::parse($value),
        };
    }
}
