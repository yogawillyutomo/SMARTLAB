<?php

namespace App\Application\ScheduleException;

use App\Application\Availability\LaboratoryAvailabilityQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Application\Session\LaboratorySessionSourceGuard;
use App\Domain\ScheduleException\ScheduleExceptionDomainException;
use App\Models\Laboratory;
use App\Models\ScheduleException;
use App\Models\ScheduleOccurrence;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ScheduleExceptionMutationService
{
    public function __construct(
        private readonly LaboratoryAvailabilityQueryService $availability,
        private readonly ScheduleExceptionEventRecorder $recorder,
        private readonly LaboratorySessionSourceGuard $sessionGuard,
    ) {
    }

    /** @param array<string,mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): ScheduleException
    {
        return DB::transaction(function () use ($context, $actor, $data): ScheduleException {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $occurrence = ScheduleOccurrence::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['occurrenceId'])
                ->whereHas('publication', fn ($query) => $query->where('school_id', $schoolId)->where('status', 'active'))
                ->with([
                    'publication:id,school_id,source_publication_id,source_version,status',
                    'entry:id,school_id,publication_id,source_schedule_id',
                    'academicClass:id,school_id,student_count',
                ])
                ->lockForUpdate()
                ->first();

            if ($occurrence === null) {
                throw ScheduleExceptionDomainException::occurrenceNotFound();
            }

            $this->sessionGuard->assertMutable(
                $schoolId,
                'schedule_occurrence',
                (string) $occurrence->id,
                'apply_schedule_exception',
            );

            if (ScheduleException::query()
                ->where('school_id', $schoolId)
                ->where('occurrence_id', $occurrence->id)
                ->where('status', 'active')
                ->exists()) {
                throw ScheduleExceptionDomainException::alreadyActive();
            }

            $resolution = (string) $data['resolution'];
            $replacementId = $resolution === 'relocate'
                ? (string) $data['replacementLaboratoryId']
                : null;

            if ($replacementId !== null && $replacementId === $occurrence->planned_laboratory_id) {
                throw ValidationException::withMessages([
                    'replacementLaboratoryId' => ['Replacement Laboratory must differ from the planned Laboratory.'],
                ]);
            }

            $lockIds = array_values(array_filter([
                $occurrence->planned_laboratory_id,
                $replacementId,
            ], fn ($id) => is_string($id) && $id !== ''));

            $laboratories = $this->lockLaboratories($schoolId, $lockIds);

            $replacement = null;
            $targetAvailability = null;

            if ($replacementId !== null) {
                /** @var Laboratory|null $replacement */
                $replacement = $laboratories->get($replacementId);

                if ($replacement === null) {
                    throw ValidationException::withMessages([
                        'replacementLaboratoryId' => ['The selected replacement Laboratory is invalid.'],
                    ]);
                }

                if ($replacement->status !== 'active') {
                    throw ValidationException::withMessages([
                        'replacementLaboratoryId' => ['The replacement Laboratory must be active.'],
                    ]);
                }

                $studentCount = (int) ($occurrence->academicClass?->student_count ?? 0);
                if ($studentCount > 0 && $studentCount > (int) $replacement->capacity) {
                    throw ValidationException::withMessages([
                        'replacementLaboratoryId' => ['The replacement Laboratory capacity is below the class student count.'],
                    ]);
                }

                $targetAvailability = $this->availability->check($context, [
                    'laboratoryId' => $replacementId,
                    'date' => $occurrence->occurs_on->format('Y-m-d'),
                    'startsAt' => substr((string) $occurrence->start_time_snapshot, 0, 5),
                    'endsAt' => substr((string) $occurrence->end_time_snapshot, 0, 5),
                ]);

                if (($targetAvailability['available'] ?? false) !== true) {
                    throw ScheduleExceptionDomainException::unavailable($targetAvailability);
                }
            }

            $exception = ScheduleException::query()->create([
                'school_id' => $schoolId,
                'occurrence_id' => $occurrence->id,
                'publication_id' => $occurrence->publication_id,
                'entry_id' => $occurrence->entry_id,
                'occurs_on' => $occurrence->occurs_on->format('Y-m-d'),
                'source_publication_id_snapshot' => (string) $occurrence->publication?->source_publication_id,
                'source_version_snapshot' => (int) $occurrence->publication?->source_version,
                'source_schedule_id_snapshot' => (string) $occurrence->entry?->source_schedule_id,
                'resolution' => $resolution,
                'original_laboratory_id' => $occurrence->planned_laboratory_id,
                'replacement_laboratory_id' => $replacement?->id,
                'reason' => trim((string) $data['reason']),
                'status' => 'active',
                'approved_by_user_id' => $actor->id,
                'approved_by_membership_id' => $context->membership->id,
                'approved_by_name_snapshot' => $actor->name,
                'cancelled_at' => null,
                'version' => 1,
            ]);

            $this->recorder->record(
                $context,
                $actor,
                $exception,
                'schedule_exception.applied',
                [
                    'resolution' => $resolution,
                    'sourceOccurrenceId' => (string) $occurrence->id,
                    'originalLaboratoryId' => $occurrence->planned_laboratory_id,
                    'replacementLaboratoryId' => $replacement?->id,
                    'availabilityAtRelocation' => $targetAvailability === null ? null : [
                        'state' => $targetAvailability['state'],
                        'sourceCoverage' => $targetAvailability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                0,
                1,
            );

            return $this->reload($exception);
        });
    }

    public function cancel(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): ScheduleException {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): ScheduleException {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $exception = ScheduleException::query()
                ->where('school_id', $schoolId)
                ->whereKey($id)
                ->with([
                    'occurrence.publication:id,school_id,status',
                ])
                ->lockForUpdate()
                ->first();

            if ($exception === null) {
                throw ScheduleExceptionDomainException::notFound();
            }

            if ($exception->version !== $expectedVersion) {
                throw ScheduleExceptionDomainException::versionConflict();
            }

            if ($exception->status !== 'active') {
                throw ScheduleExceptionDomainException::stateConflict('Only active Schedule Exceptions may be cancelled.');
            }

            $occurrence = $exception->occurrence;
            if ($occurrence === null) {
                throw ScheduleExceptionDomainException::stateConflict('The source Schedule Occurrence is no longer resolvable.');
            }

            $this->sessionGuard->assertMutable(
                $schoolId,
                'schedule_occurrence',
                (string) $occurrence->id,
                'cancel_schedule_exception',
            );

            $this->lockLaboratories($schoolId, array_values(array_filter([
                $exception->original_laboratory_id,
                $exception->replacement_laboratory_id,
            ], fn ($labId) => is_string($labId) && $labId !== '')));

            if ($occurrence->publication?->status === 'active' && $exception->original_laboratory_id !== null) {
                $restoration = $this->availability->check(
                    $context,
                    [
                        'laboratoryId' => (string) $exception->original_laboratory_id,
                        'date' => $exception->occurs_on->format('Y-m-d'),
                        'startsAt' => substr((string) $occurrence->start_time_snapshot, 0, 5),
                        'endsAt' => substr((string) $occurrence->end_time_snapshot, 0, 5),
                    ],
                    null,
                    (string) $exception->id,
                    (string) $occurrence->id,
                );

                if (($restoration['available'] ?? false) !== true) {
                    throw ScheduleExceptionDomainException::restorationUnavailable($restoration);
                }
            }

            $before = $exception->version;
            $exception->status = 'cancelled';
            $exception->cancelled_at = now();
            $exception->version++;
            $exception->save();

            $this->recorder->record(
                $context,
                $actor,
                $exception,
                'schedule_exception.cancelled',
                [
                    'reason' => trim($reason),
                    'resolution' => (string) $exception->resolution,
                ],
                $before,
                $exception->version,
            );

            return $this->reload($exception);
        });
    }

    /** @param list<string> $ids @return Collection<string,Laboratory> */
    private function lockLaboratories(string $schoolId, array $ids): Collection
    {
        $ids = array_values(array_unique($ids));
        sort($ids);

        if ($ids === []) {
            return collect();
        }

        return Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereIn('id', $ids)
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy(fn (Laboratory $laboratory): string => (string) $laboratory->id);
    }

    private function reload(ScheduleException $exception): ScheduleException
    {
        return $exception->refresh()->load([
            'occurrence:id,school_id,publication_id,entry_id,occurs_on,teacher_id,academic_class_id,subject_id,planned_laboratory_id,start_time_snapshot,end_time_snapshot,activity_type',
            'occurrence.teacher:id,school_id,code,name',
            'occurrence.academicClass:id,school_id,code,name',
            'occurrence.subject:id,school_id,code,name',
            'publication:id,school_id,source_publication_id,source_version,status',
            'entry:id,school_id,publication_id,source_schedule_id,source_snapshots',
            'originalLaboratory:id,school_id,code,name,capacity,status',
            'replacementLaboratory:id,school_id,code,name,capacity,status',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ]);
    }
}
