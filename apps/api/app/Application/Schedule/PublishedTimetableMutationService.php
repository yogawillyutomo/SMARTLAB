<?php

namespace App\Application\Schedule;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Schedule\PublishedTimetableCanonicalizer;
use App\Domain\Schedule\PublishedTimetableException;
use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\Laboratory;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\ScheduleOccurrence;
use App\Models\School;
use App\Models\Semester;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\TimetableEntry;
use App\Models\TimetablePublication;
use App\Models\User;
use Illuminate\Support\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PublishedTimetableMutationService
{
    private const MAX_OCCURRENCES = 250000;

    private const MAX_DIAGNOSTIC_ERRORS = 100;

    public function __construct(
        private readonly PublishedTimetableCanonicalizer $canonicalizer,
        private readonly TimetablePublicationEventRecorder $eventRecorder,
        private readonly TimetablePublicationImpactService $impactService,
    ) {}

    /**
     * @param array<string, mixed> $data
     * @return array{publication: TimetablePublication, replayed: bool}
     */
    public function ingest(CurrentMembershipContext $context, User $actor, array $data): array
    {
        $schoolId = (string) $context->membership->school_id;

        if ((string) $data['schoolSourceId'] !== $schoolId) {
            throw PublishedTimetableException::invalid(
                'The source School does not match the active SmartLab School.',
                ['schoolSourceId' => ['The source School does not match the active School context.']],
            );
        }

        $payloadHash = $this->canonicalizer->hash($data);

        $initial = DB::transaction(function () use ($context, $actor, $data, $payloadHash, $schoolId): array {
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $existing = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->where('source_system', $data['sourceSystem'])
                ->where('source_publication_id', $data['sourcePublicationId'])
                ->where('source_version', $data['sourceVersion'])
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                if (hash_equals($existing->payload_sha256, $payloadHash)) {
                    $this->eventRecorder->record(
                        $context,
                        $actor,
                        $existing,
                        'publication_replayed',
                        ['status' => $existing->status],
                    );

                    return [
                        'publication' => $existing->refresh(),
                        'replayed' => true,
                        'integrityConflict' => false,
                        'familyConflict' => false,
                    ];
                }

                $this->eventRecorder->record(
                    $context,
                    $actor,
                    $existing,
                    'publication_integrity_conflict',
                    ['incomingPayloadSha256' => $payloadHash],
                );

                return [
                    'publication' => $existing->refresh(),
                    'replayed' => false,
                    'integrityConflict' => true,
                    'familyConflict' => false,
                ];
            }

            $familyConflict = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->where('source_system', $data['sourceSystem'])
                ->where('source_semester_id', $data['semesterSourceId'])
                ->where('source_publication_id', '!=', $data['sourcePublicationId'])
                ->lockForUpdate()
                ->first();

            if ($familyConflict !== null) {
                $this->eventRecorder->record(
                    $context,
                    $actor,
                    $familyConflict,
                    'publication_integrity_conflict',
                    [
                        'reason' => 'publication_family_changed',
                        'incomingSourcePublicationId' => $data['sourcePublicationId'],
                        'sourceSemesterId' => $data['semesterSourceId'],
                    ],
                );

                return [
                    'publication' => $familyConflict->refresh(),
                    'replayed' => false,
                    'integrityConflict' => false,
                    'familyConflict' => true,
                ];
            }

            $publication = TimetablePublication::query()->create([
                'school_id' => $schoolId,
                'source_system' => $data['sourceSystem'],
                'source_publication_id' => $data['sourcePublicationId'],
                'source_version' => $data['sourceVersion'],
                'schema_version' => $data['schemaVersion'],
                'academic_reference_source' => $data['academicReferenceSource'],
                'source_school_id' => $data['schoolSourceId'],
                'source_academic_year_id' => $data['academicYearSourceId'],
                'source_semester_id' => $data['semesterSourceId'],
                'academic_year_id' => null,
                'semester_id' => null,
                'published_at' => Carbon::parse((string) $data['publishedAt'])->utc(),
                'effective_from' => $data['effectiveFrom'],
                'effective_to' => $data['effectiveTo'],
                'payload_sha256' => $payloadHash,
                'source_payload' => $data,
                'status' => 'staged',
                'validation_summary' => [
                    'entriesReceived' => count($data['entries']),
                    'entriesNormalized' => 0,
                    'occurrencesMaterialized' => 0,
                    'errors' => 0,
                    'warnings' => 0,
                ],
            ]);

            $this->eventRecorder->record(
                $context,
                $actor,
                $publication,
                'publication_received',
                [
                    'entriesReceived' => count($data['entries']),
                    'schemaVersion' => $data['schemaVersion'],
                    'academicReferenceSource' => $data['academicReferenceSource'],
                ],
            );

            return [
                'publication' => $publication->refresh(),
                'replayed' => false,
                'integrityConflict' => false,
                'familyConflict' => false,
            ];
        });

        if ($initial['integrityConflict']) {
            throw PublishedTimetableException::conflict(
                'The same timetable publication version was received with different content.',
                'TIMETABLE_PUBLICATION_INTEGRITY_CONFLICT',
            );
        }

        if ($initial['familyConflict']) {
            throw PublishedTimetableException::conflict(
                'The timetable publication family identifier changed for the same Semester scope.',
                'TIMETABLE_PUBLICATION_FAMILY_CONFLICT',
            );
        }

        if ($initial['replayed']) {
            return [
                'publication' => $initial['publication'],
                'replayed' => true,
            ];
        }

        /** @var TimetablePublication $publication */
        $publication = $initial['publication'];

        try {
            $publication = $this->validateAndMaterialize($context, $actor, $publication, $data);
        } catch (PublishedTimetableException $exception) {
            if ($exception->status === 422) {
                $this->rejectPublication($context, $actor, $publication->id, $exception);
            }

            throw $exception;
        }

        return [
            'publication' => $publication,
            'replayed' => false,
        ];
    }

    public function activate(
        CurrentMembershipContext $context,
        User $actor,
        string $publicationId,
    ): TimetablePublication {
        return DB::transaction(function () use ($context, $actor, $publicationId): TimetablePublication {
            $schoolId = (string) $context->membership->school_id;
            $school = School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $publication = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->whereKey($publicationId)
                ->lockForUpdate()
                ->first();

            if ($publication === null) {
                throw PublishedTimetableException::notFound();
            }

            if ($publication->status === 'active') {
                return $publication;
            }

            if ($publication->status !== 'validated' || $publication->semester_id === null) {
                throw PublishedTimetableException::notActivatable(
                    'Only a fully validated timetable publication can be activated.',
                );
            }

            $timezone = $school->timezone ?: config('app.timezone', 'UTC');
            $today = now($timezone)->toDateString();

            if ($publication->effective_from->format('Y-m-d') > $today) {
                throw PublishedTimetableException::notActivatable(
                    'A future-effective timetable publication cannot be activated before its effective date.',
                );
            }

            if ($publication->effective_to->format('Y-m-d') < $today) {
                throw PublishedTimetableException::notActivatable(
                    'An expired timetable publication cannot become the current active plan.',
                );
            }

            $current = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->where('semester_id', $publication->semester_id)
                ->where('status', 'active')
                ->lockForUpdate()
                ->first();

            if ($current !== null && $current->id !== $publication->id) {
                if ($current->source_publication_id !== $publication->source_publication_id) {
                    throw PublishedTimetableException::conflict(
                        'The active timetable belongs to a different publication family.',
                        'TIMETABLE_PUBLICATION_FAMILY_CONFLICT',
                    );
                }

                if ($current->source_version >= $publication->source_version) {
                    throw PublishedTimetableException::notActivatable(
                        'An older or equal timetable source version cannot replace the current active version.',
                    );
                }

                $impact = $this->impactService->previewPublication($context, $publication);
                if (($impact['clear'] ?? false) !== true) {
                    throw PublishedTimetableException::reconciliationRequired($impact);
                }

                $current->forceFill([
                    'status' => 'superseded',
                    'superseded_at' => now(),
                    'superseded_by_id' => $publication->id,
                ])->save();

                $this->eventRecorder->record(
                    $context,
                    $actor,
                    $current,
                    'publication_superseded',
                    [
                        'supersededById' => $publication->id,
                        'supersededBySourceVersion' => $publication->source_version,
                    ],
                );
            } else {
                $impact = $this->impactService->previewPublication($context, $publication);
                if (($impact['clear'] ?? false) !== true) {
                    throw PublishedTimetableException::reconciliationRequired($impact);
                }
            }

            $publication->forceFill([
                'status' => 'active',
                'activated_at' => now(),
            ])->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $publication,
                'publication_activated',
                [
                    'previousPublicationId' => $current?->id,
                    'previousSourceVersion' => $current?->source_version,
                    'impactFingerprint' => $impact['fingerprint'],
                    'scheduleDiff' => $impact['scheduleDiff'],
                    'impactBlockerCount' => $impact['blockerCount'],
                ],
            );

            return $publication->refresh();
        });
    }

    /**
     * @param array<string, mixed> $data
     */
    private function validateAndMaterialize(
        CurrentMembershipContext $context,
        User $actor,
        TimetablePublication $publication,
        array $data,
    ): TimetablePublication {
        return DB::transaction(function () use ($context, $actor, $publication, $data): TimetablePublication {
            $schoolId = (string) $context->membership->school_id;

            $publication = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->whereKey($publication->id)
                ->lockForUpdate()
                ->firstOrFail();

            if ($publication->status !== 'staged') {
                return $publication;
            }

            $errors = [];
            $warnings = [];
            $entries = $data['entries'];

            $year = AcademicYear::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['academicYearSourceId'])
                ->first();
            $semester = Semester::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['semesterSourceId'])
                ->first();

            if ($year === null) {
                $this->addError($errors, 'academicYearSourceId', 'The Academic Year reference is unknown in the active School.');
            } elseif ($year->status !== 'active') {
                $this->addError($errors, 'academicYearSourceId', 'The Academic Year reference is inactive.');
            }

            if ($semester === null) {
                $this->addError($errors, 'semesterSourceId', 'The Semester reference is unknown in the active School.');
            } elseif ($semester->status !== 'active') {
                $this->addError($errors, 'semesterSourceId', 'The Semester reference is inactive.');
            }

            if ($year !== null && $semester !== null && $semester->academic_year_id !== $year->id) {
                $this->addError($errors, 'semesterSourceId', 'The Semester does not belong to the declared Academic Year.');
            }

            if ($semester !== null) {
                $effectiveFrom = $publication->effective_from->format('Y-m-d');
                $effectiveTo = $publication->effective_to->format('Y-m-d');
                if ($effectiveFrom < $semester->starts_on->format('Y-m-d')
                    || $effectiveTo > $semester->ends_on->format('Y-m-d')) {
                    $this->addError($errors, 'effectiveFrom', 'The publication effective window must be fully contained inside the Semester.');
                }
            }

            $familyScopeConflict = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->where('source_system', $publication->source_system)
                ->where('source_publication_id', $publication->source_publication_id)
                ->where('id', '!=', $publication->id)
                ->where('source_semester_id', '!=', $publication->source_semester_id)
                ->exists();

            if ($familyScopeConflict) {
                $this->addError(
                    $errors,
                    'sourcePublicationId',
                    'The source publication family is already bound to a different Semester scope.',
                );
            }

            if ($errors !== []) {
                throw $this->invalidException($data, $errors, $warnings);
            }

            $teacherIds = collect($entries)->pluck('teacherSourceId')->unique()->values();
            $classIds = collect($entries)->pluck('academicClassSourceId')->unique()->values();
            $subjectIds = collect($entries)->pluck('subjectSourceId')->unique()->values();
            $setIds = collect($entries)->pluck('lessonPeriodSetSourceId')->unique()->values();
            $periodIds = collect($entries)
                ->flatMap(fn (array $entry): array => [
                    $entry['startLessonPeriodSourceId'],
                    $entry['endLessonPeriodSourceId'],
                ])
                ->unique()
                ->values();
            $laboratoryIds = collect($entries)
                ->pluck('plannedLaboratoryId')
                ->filter(fn (mixed $id): bool => is_string($id) && $id !== '')
                ->unique()
                ->values();

            $teachers = Teacher::query()->where('school_id', $schoolId)->whereIn('id', $teacherIds)->get()->keyBy('id');
            $classes = AcademicClass::query()->where('school_id', $schoolId)->whereIn('id', $classIds)->get()->keyBy('id');
            $subjects = Subject::query()->where('school_id', $schoolId)->whereIn('id', $subjectIds)->get()->keyBy('id');
            $sets = LessonPeriodSet::query()->where('school_id', $schoolId)->whereIn('id', $setIds)->get()->keyBy('id');
            $periods = LessonPeriod::query()->where('school_id', $schoolId)->whereIn('id', $periodIds)->get()->keyBy('id');
            $periodsBySet = LessonPeriod::query()
                ->where('school_id', $schoolId)
                ->whereIn('lesson_period_set_id', $setIds)
                ->orderBy('sequence')
                ->get()
                ->groupBy('lesson_period_set_id');
            $laboratories = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $laboratoryIds)
                ->get()
                ->keyBy('id');

            $entryRows = [];
            $occurrenceRows = [];
            $collisionIndex = [];
            $capacityWarningCount = 0;
            $now = now();

            foreach ($entries as $index => $entry) {
                $path = "entries.{$index}";
                $teacher = $teachers->get($entry['teacherSourceId']);
                $class = $classes->get($entry['academicClassSourceId']);
                $subject = $subjects->get($entry['subjectSourceId']);
                $set = $sets->get($entry['lessonPeriodSetSourceId']);
                $start = $periods->get($entry['startLessonPeriodSourceId']);
                $end = $periods->get($entry['endLessonPeriodSourceId']);
                $laboratory = isset($entry['plannedLaboratoryId'])
                    ? $laboratories->get($entry['plannedLaboratoryId'])
                    : null;

                $this->assertActiveReference($errors, "{$path}.teacherSourceId", $teacher, 'Teacher');
                $this->assertActiveReference($errors, "{$path}.academicClassSourceId", $class, 'Academic Class');
                $this->assertActiveReference($errors, "{$path}.subjectSourceId", $subject, 'Subject');
                $this->assertActiveReference($errors, "{$path}.lessonPeriodSetSourceId", $set, 'Lesson Period Set');
                $this->assertActiveReference($errors, "{$path}.startLessonPeriodSourceId", $start, 'Start Lesson Period');
                $this->assertActiveReference($errors, "{$path}.endLessonPeriodSourceId", $end, 'End Lesson Period');

                if (isset($entry['plannedLaboratoryId'])) {
                    if ($laboratory === null) {
                        $this->addError($errors, "{$path}.plannedLaboratoryId", 'The planned Laboratory reference is unknown in the active School.');
                    } elseif ($laboratory->status !== 'active') {
                        $this->addError($errors, "{$path}.plannedLaboratoryId", 'The planned Laboratory is inactive.');
                    }
                }

                if ($set !== null && $year !== null && $set->academic_year_id !== $year->id) {
                    $this->addError($errors, "{$path}.lessonPeriodSetSourceId", 'The Lesson Period Set does not belong to the declared Academic Year.');
                }

                if ($set === null || $start === null || $end === null || $teacher === null || $class === null || $subject === null) {
                    continue;
                }

                if ($start->lesson_period_set_id !== $set->id || $end->lesson_period_set_id !== $set->id) {
                    $this->addError($errors, "{$path}.lessonPeriodSetSourceId", 'Start and end Lesson Periods must belong to the declared Lesson Period Set.');

                    continue;
                }

                if ($start->kind !== 'instruction' || $end->kind !== 'instruction') {
                    $this->addError($errors, "{$path}.startLessonPeriodSourceId", 'Schedule boundaries must reference instruction periods.');

                    continue;
                }

                if ((int) $start->sequence > (int) $end->sequence) {
                    $this->addError($errors, "{$path}.endLessonPeriodSourceId", 'The end Lesson Period must not precede the start Lesson Period.');

                    continue;
                }

                /** @var Collection<int, LessonPeriod> $setPeriods */
                $setPeriods = $periodsBySet->get($set->id, collect());
                $span = $setPeriods->filter(
                    fn (LessonPeriod $period): bool => $period->sequence >= $start->sequence && $period->sequence <= $end->sequence,
                );

                if ($span->contains(fn (LessonPeriod $period): bool => $period->status !== 'active')) {
                    $this->addError($errors, "{$path}.lessonPeriodSetSourceId", 'The selected Lesson Period span contains an inactive period.');

                    continue;
                }

                $instructionPeriodCount = $span->where('kind', 'instruction')->count();
                if ($instructionPeriodCount < 1) {
                    $this->addError($errors, "{$path}.startLessonPeriodSourceId", 'The selected Lesson Period span contains no instruction period.');

                    continue;
                }

                $startTime = substr((string) $start->starts_at, 0, 8);
                $endTime = substr((string) $end->ends_at, 0, 8);
                if ($startTime >= $endTime) {
                    $this->addError($errors, "{$path}.endLessonPeriodSourceId", 'The resolved schedule time range is invalid.');

                    continue;
                }

                $dates = $this->occurrenceDates(
                    $entry,
                    $publication->effective_from->format('Y-m-d'),
                    $publication->effective_to->format('Y-m-d'),
                    $path,
                    $errors,
                );

                if ($dates === []) {
                    continue;
                }

                if (count($occurrenceRows) + count($dates) > self::MAX_OCCURRENCES) {
                    $this->addError(
                        $errors,
                        'entries',
                        'The publication materializes more than the supported occurrence limit.',
                    );

                    break;
                }

                $entryId = Str::ulid()->toBase32();
                $entryRows[] = [
                    'id' => $entryId,
                    'school_id' => $schoolId,
                    'publication_id' => $publication->id,
                    'source_schedule_id' => $entry['sourceScheduleId'],
                    'teacher_id' => $teacher->id,
                    'academic_class_id' => $class->id,
                    'subject_id' => $subject->id,
                    'lesson_period_set_id' => $set->id,
                    'start_lesson_period_id' => $start->id,
                    'end_lesson_period_id' => $end->id,
                    'planned_laboratory_id' => $laboratory?->id,
                    'activity_type' => $entry['activityType'],
                    'recurrence_kind' => $entry['recurrenceKind'],
                    'weekday' => $entry['recurrenceKind'] === 'weekly' ? $entry['weekday'] : null,
                    'entry_effective_from' => $entry['recurrenceKind'] === 'weekly' ? $entry['entryEffectiveFrom'] : null,
                    'entry_effective_to' => $entry['recurrenceKind'] === 'weekly' ? $entry['entryEffectiveTo'] : null,
                    'occurs_on' => $entry['recurrenceKind'] === 'single_date' ? $entry['occursOn'] : null,
                    'start_time_snapshot' => $startTime,
                    'end_time_snapshot' => $endTime,
                    'instruction_period_count' => $instructionPeriodCount,
                    'source_snapshots' => isset($entry['sourceSnapshots'])
                        ? json_encode($entry['sourceSnapshots'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                        : null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];

                if ($laboratory !== null && (int) $class->student_count > (int) $laboratory->capacity) {
                    $capacityWarningCount++;
                    if (count($warnings) < self::MAX_DIAGNOSTIC_ERRORS) {
                        $warnings[] = [
                            'sourceScheduleId' => $entry['sourceScheduleId'],
                            'code' => 'LABORATORY_CAPACITY',
                            'message' => 'Academic Class student count exceeds the planned Laboratory capacity.',
                        ];
                    }
                }

                foreach ($dates as $date) {
                    $this->checkCollision(
                        $collisionIndex,
                        'teacher',
                        $teacher->id,
                        $date,
                        $startTime,
                        $endTime,
                        $entry['sourceScheduleId'],
                        $path,
                        $errors,
                    );
                    $this->checkCollision(
                        $collisionIndex,
                        'class',
                        $class->id,
                        $date,
                        $startTime,
                        $endTime,
                        $entry['sourceScheduleId'],
                        $path,
                        $errors,
                    );
                    if ($laboratory !== null) {
                        $this->checkCollision(
                            $collisionIndex,
                            'laboratory',
                            $laboratory->id,
                            $date,
                            $startTime,
                            $endTime,
                            $entry['sourceScheduleId'],
                            $path,
                            $errors,
                        );
                    }

                    $occurrenceRows[] = [
                        'id' => Str::ulid()->toBase32(),
                        'school_id' => $schoolId,
                        'publication_id' => $publication->id,
                        'entry_id' => $entryId,
                        'occurs_on' => $date,
                        'teacher_id' => $teacher->id,
                        'academic_class_id' => $class->id,
                        'subject_id' => $subject->id,
                        'planned_laboratory_id' => $laboratory?->id,
                        'lesson_period_set_id' => $set->id,
                        'start_lesson_period_id' => $start->id,
                        'end_lesson_period_id' => $end->id,
                        'start_time_snapshot' => $startTime,
                        'end_time_snapshot' => $endTime,
                        'activity_type' => $entry['activityType'],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }
            }

            if ($errors !== []) {
                throw $this->invalidException(
                    $data,
                    $errors,
                    $warnings,
                    count($entryRows),
                    count($occurrenceRows),
                    $capacityWarningCount,
                );
            }

            foreach (array_chunk($entryRows, 500) as $chunk) {
                TimetableEntry::query()->insert($chunk);
            }
            foreach (array_chunk($occurrenceRows, 500) as $chunk) {
                ScheduleOccurrence::query()->insert($chunk);
            }

            $summary = [
                'entriesReceived' => count($entries),
                'entriesNormalized' => count($entryRows),
                'occurrencesMaterialized' => count($occurrenceRows),
                'errors' => 0,
                'warnings' => $capacityWarningCount,
                'diagnostics' => [
                    'capacityWarnings' => $capacityWarningCount,
                    'warningSamples' => $warnings,
                ],
            ];

            $publication->forceFill([
                'academic_year_id' => $year?->id,
                'semester_id' => $semester?->id,
                'status' => 'validated',
                'validation_summary' => $summary,
                'validated_at' => now(),
            ])->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $publication,
                'publication_validated',
                $summary,
            );

            return $publication->refresh();
        });
    }

    private function rejectPublication(
        CurrentMembershipContext $context,
        User $actor,
        string $publicationId,
        PublishedTimetableException $exception,
    ): void {
        DB::transaction(function () use ($context, $actor, $publicationId, $exception): void {
            $publication = TimetablePublication::query()
                ->where('school_id', $context->membership->school_id)
                ->whereKey($publicationId)
                ->lockForUpdate()
                ->first();

            if ($publication === null || $publication->status !== 'staged') {
                return;
            }

            $summary = $exception->details;
            if ($summary === []) {
                $summary = [
                    'entriesReceived' => count((array) ($publication->source_payload['entries'] ?? [])),
                    'entriesNormalized' => 0,
                    'occurrencesMaterialized' => 0,
                    'errors' => $this->errorCount($exception->errors),
                    'warnings' => 0,
                    'diagnostics' => ['errors' => $exception->errors],
                ];
            }

            $publication->forceFill([
                'status' => 'rejected',
                'validation_summary' => $summary,
            ])->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $publication,
                'publication_validation_failed',
                $summary,
            );
        });
    }

    /**
     * @param array<string, mixed> $entry
     * @param array<string, list<string>> $errors
     * @return list<string>
     */
    private function occurrenceDates(
        array $entry,
        string $publicationFrom,
        string $publicationTo,
        string $path,
        array &$errors,
    ): array {
        if ($entry['recurrenceKind'] === 'single_date') {
            $date = (string) $entry['occursOn'];
            if ($date < $publicationFrom || $date > $publicationTo) {
                $this->addError($errors, "{$path}.occursOn", 'The occurrence date must be inside the publication effective window.');

                return [];
            }

            return [$date];
        }

        $from = (string) $entry['entryEffectiveFrom'];
        $to = (string) $entry['entryEffectiveTo'];

        if ($from < $publicationFrom || $to > $publicationTo) {
            $this->addError(
                $errors,
                "{$path}.entryEffectiveFrom",
                'The entry effective range must be fully contained inside the publication effective window.',
            );

            return [];
        }

        $weekday = (int) $entry['weekday'];
        $cursor = CarbonImmutable::createFromFormat('Y-m-d', $from)->startOfDay();
        $end = CarbonImmutable::createFromFormat('Y-m-d', $to)->startOfDay();
        $dates = [];

        while ($cursor->lte($end)) {
            if ($cursor->isoWeekday() === $weekday) {
                $dates[] = $cursor->format('Y-m-d');
            }

            $cursor = $cursor->addDay();
        }

        if ($dates === []) {
            $this->addError(
                $errors,
                "{$path}.weekday",
                'The weekly recurrence produces no occurrence inside its effective range.',
            );
        }

        return $dates;
    }

    /**
     * @param array<string, array<string, array<string, list<array{start:string,end:string,sourceScheduleId:string}>>>> $index
     * @param array<string, list<string>> $errors
     */
    private function checkCollision(
        array &$index,
        string $type,
        string $resourceId,
        string $date,
        string $start,
        string $end,
        string $sourceScheduleId,
        string $path,
        array &$errors,
    ): void {
        $intervals = $index[$type][$resourceId][$date] ?? [];

        foreach ($intervals as $interval) {
            if ($start < $interval['end'] && $end > $interval['start']) {
                $this->addError(
                    $errors,
                    $path,
                    ucfirst($type)." collision with source schedule {$interval['sourceScheduleId']} on {$date}.",
                );

                break;
            }
        }

        $index[$type][$resourceId][$date][] = [
            'start' => $start,
            'end' => $end,
            'sourceScheduleId' => $sourceScheduleId,
        ];
    }

    /**
     * @param array<string, list<string>> $errors
     */
    private function assertActiveReference(
        array &$errors,
        string $path,
        mixed $model,
        string $label,
    ): void {
        if ($model === null) {
            $this->addError($errors, $path, "The {$label} reference is unknown in the active School.");

            return;
        }

        if ((string) $model->status !== 'active') {
            $this->addError($errors, $path, "The {$label} reference is inactive.");
        }
    }

    /**
     * @param array<string, list<string>> $errors
     */
    private function addError(array &$errors, string $path, string $message): void
    {
        if ($this->errorCount($errors) >= self::MAX_DIAGNOSTIC_ERRORS) {
            return;
        }

        $errors[$path] ??= [];
        if (! in_array($message, $errors[$path], true)) {
            $errors[$path][] = $message;
        }
    }

    /**
     * @param array<string, list<string>> $errors
     */
    private function errorCount(array $errors): int
    {
        return array_sum(array_map('count', $errors));
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, list<string>> $errors
     * @param list<array<string, mixed>> $warnings
     */
    private function invalidException(
        array $data,
        array $errors,
        array $warnings,
        int $entriesNormalized = 0,
        int $occurrencesMaterialized = 0,
        int $warningCount = 0,
    ): PublishedTimetableException {
        $summary = [
            'entriesReceived' => count((array) ($data['entries'] ?? [])),
            'entriesNormalized' => $entriesNormalized,
            'occurrencesMaterialized' => $occurrencesMaterialized,
            'errors' => $this->errorCount($errors),
            'warnings' => $warningCount,
            'diagnostics' => [
                'errors' => $errors,
                'warningSamples' => $warnings,
            ],
        ];

        return PublishedTimetableException::invalid(
            'The timetable publication failed SmartLab validation.',
            $errors,
            $summary,
        );
    }
}
