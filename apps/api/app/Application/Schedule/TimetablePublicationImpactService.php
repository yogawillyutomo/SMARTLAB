<?php

namespace App\Application\Schedule;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Schedule\PublishedTimetableException;
use App\Models\LaboratoryReservation;
use App\Models\OperationalCalendarEvent;
use App\Models\PriorityEvent;
use App\Models\ScheduleException;
use App\Models\ScheduleOccurrence;
use App\Models\School;
use App\Models\TimetablePublication;
use Illuminate\Support\Collection;

class TimetablePublicationImpactService
{
    private const MAX_BLOCKERS_RETURNED = 200;

    /** @return array<string,mixed> */
    public function preview(CurrentMembershipContext $context, string $publicationId): array
    {
        $publication = TimetablePublication::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($publicationId)
            ->first();

        if ($publication === null) {
            throw PublishedTimetableException::notFound();
        }

        return $this->previewPublication($context, $publication);
    }

    /** @return array<string,mixed> */
    public function previewPublication(CurrentMembershipContext $context, TimetablePublication $publication): array
    {
        $schoolId = (string) $context->membership->school_id;

        if ((string) $publication->school_id !== $schoolId) {
            throw PublishedTimetableException::notFound();
        }

        if (! in_array($publication->status, ['validated', 'active'], true) || $publication->semester_id === null) {
            throw PublishedTimetableException::notActivatable(
                'Publication impact is available only for validated or active timetable publications.',
            );
        }

        $school = School::query()->whereKey($schoolId)->firstOrFail();
        $timezone = $school->timezone ?: config('app.timezone', 'UTC');
        $today = now($timezone)->toDateString();
        $from = max($today, $publication->effective_from->format('Y-m-d'));
        $to = $publication->effective_to->format('Y-m-d');

        $current = TimetablePublication::query()
            ->where('school_id', $schoolId)
            ->where('semester_id', $publication->semester_id)
            ->where('status', 'active')
            ->where('id', '!=', $publication->id)
            ->first();

        if ($from > $to) {
            return $this->result($publication, $current, $from, $to, [
                'added' => 0,
                'removed' => 0,
                'changed' => 0,
                'unchanged' => 0,
            ], [], []);
        }

        $candidateOccurrences = $this->occurrences($schoolId, (string) $publication->id, $from, $to);
        $currentOccurrences = $current === null
            ? collect()
            : $this->occurrences($schoolId, (string) $current->id, $from, $to);

        $candidateByKey = $candidateOccurrences->keyBy(fn (ScheduleOccurrence $occurrence): string => $this->sourceKey($occurrence));
        $currentByKey = $currentOccurrences->keyBy(fn (ScheduleOccurrence $occurrence): string => $this->sourceKey($occurrence));

        $diff = $this->scheduleDiff($candidateByKey, $currentByKey);

        /** @var list<array<string,mixed>> $blockers */
        $blockers = [];
        /** @var list<string> $fingerprintItems */
        $fingerprintItems = [];

        if ($current !== null) {
            $exceptions = ScheduleException::query()
                ->where('school_id', $schoolId)
                ->where('publication_id', $current->id)
                ->where('status', 'active')
                ->whereBetween('occurs_on', [$from, $to])
                ->orderBy('occurs_on')
                ->orderBy('id')
                ->get();

            foreach ($exceptions as $exception) {
                $key = (string) $exception->source_schedule_id_snapshot.'|'.$exception->occurs_on->format('Y-m-d');
                /** @var ScheduleOccurrence|null $candidate */
                $candidate = $candidateByKey->get($key);
                /** @var ScheduleOccurrence|null $source */
                $source = $currentByKey->get($key);

                $this->pushBlocker($blockers, $fingerprintItems, [
                    'type' => 'active_schedule_exception',
                    'entityId' => (string) $exception->id,
                    'date' => $exception->occurs_on->format('Y-m-d'),
                    'laboratoryId' => $exception->replacement_laboratory_id ?? $exception->original_laboratory_id,
                    'title' => 'Schedule Exception aktif harus direkonsiliasi sebelum publikasi baru diaktifkan.',
                    'details' => [
                        'resolution' => (string) $exception->resolution,
                        'sourceScheduleId' => (string) $exception->source_schedule_id_snapshot,
                        'sourceVersion' => (int) $exception->source_version_snapshot,
                        'candidateOccurrenceId' => $candidate?->id,
                        'candidateOccurrenceExists' => $candidate !== null,
                        'sourceChanged' => $candidate !== null && $source !== null
                            ? $this->signature($candidate) !== $this->signature($source)
                            : null,
                    ],
                ]);
            }
        }

        $candidateByLabDate = $candidateOccurrences
            ->filter(fn (ScheduleOccurrence $occurrence): bool => $occurrence->planned_laboratory_id !== null)
            ->groupBy(fn (ScheduleOccurrence $occurrence): string => $occurrence->planned_laboratory_id.'|'.$occurrence->occurs_on->format('Y-m-d'));

        $laboratoryIds = $candidateOccurrences
            ->pluck('planned_laboratory_id')
            ->filter()
            ->unique()
            ->values();

        if ($laboratoryIds->isNotEmpty()) {
            $laboratories = \App\Models\Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $laboratoryIds)
                ->get()
                ->keyBy('id');

            foreach ($candidateOccurrences as $candidate) {
                if ($candidate->planned_laboratory_id === null) {
                    continue;
                }

                $laboratory = $laboratories->get($candidate->planned_laboratory_id);
                if ($laboratory === null || $laboratory->status !== 'active') {
                    $this->pushBlocker($blockers, $fingerprintItems, [
                        'type' => 'laboratory_status_conflict',
                        'entityId' => (string) ($laboratory?->id ?? $candidate->planned_laboratory_id),
                        'date' => $candidate->occurs_on->format('Y-m-d'),
                        'laboratoryId' => (string) $candidate->planned_laboratory_id,
                        'title' => 'Publikasi kandidat mereferensikan Laboratory yang tidak lagi aktif.',
                        'details' => [
                            'candidateOccurrenceId' => (string) $candidate->id,
                            'sourceScheduleId' => (string) $candidate->entry?->source_schedule_id,
                            'laboratoryStatus' => $laboratory?->status,
                        ],
                    ]);
                }
            }


            $reservations = LaboratoryReservation::query()
                ->where('school_id', $schoolId)
                ->whereIn('laboratory_id', $laboratoryIds)
                ->whereBetween('reservation_date', [$from, $to])
                ->whereIn('status', ['submitted', 'approved'])
                ->orderBy('reservation_date')
                ->orderBy('starts_at')
                ->orderBy('id')
                ->get();

            foreach ($reservations as $reservation) {
                $key = $reservation->laboratory_id.'|'.$reservation->reservation_date->format('Y-m-d');
                foreach ($candidateByLabDate->get($key, collect()) as $candidate) {
                    if (! $this->overlaps($candidate->start_time_snapshot, $candidate->end_time_snapshot, $reservation->starts_at, $reservation->ends_at)) {
                        continue;
                    }

                    $this->pushBlocker($blockers, $fingerprintItems, [
                        'type' => 'reservation_conflict',
                        'entityId' => (string) $reservation->id,
                        'date' => $reservation->reservation_date->format('Y-m-d'),
                        'laboratoryId' => (string) $reservation->laboratory_id,
                        'title' => 'Publikasi kandidat bertabrakan dengan Reservation yang masih aktif.',
                        'details' => [
                            'reservationNumber' => (string) $reservation->reservation_number,
                            'reservationStatus' => (string) $reservation->status,
                            'candidateOccurrenceId' => (string) $candidate->id,
                            'sourceScheduleId' => (string) $candidate->entry?->source_schedule_id,
                            'reservationWindow' => [
                                'startsAt' => substr((string) $reservation->starts_at, 0, 8),
                                'endsAt' => substr((string) $reservation->ends_at, 0, 8),
                            ],
                            'candidateWindow' => [
                                'startsAt' => substr((string) $candidate->start_time_snapshot, 0, 8),
                                'endsAt' => substr((string) $candidate->end_time_snapshot, 0, 8),
                            ],
                        ],
                    ]);
                }
            }

            $priorityEvents = PriorityEvent::query()
                ->where('school_id', $schoolId)
                ->whereIn('laboratory_id', $laboratoryIds)
                ->whereBetween('event_date', [$from, $to])
                ->where('status', 'approved')
                ->orderBy('event_date')
                ->orderBy('starts_at')
                ->orderBy('id')
                ->get();

            foreach ($priorityEvents as $event) {
                $key = $event->laboratory_id.'|'.$event->event_date->format('Y-m-d');
                foreach ($candidateByLabDate->get($key, collect()) as $candidate) {
                    if (! $this->overlaps($candidate->start_time_snapshot, $candidate->end_time_snapshot, $event->starts_at, $event->ends_at)) {
                        continue;
                    }

                    $this->pushBlocker($blockers, $fingerprintItems, [
                        'type' => 'priority_event_conflict',
                        'entityId' => (string) $event->id,
                        'date' => $event->event_date->format('Y-m-d'),
                        'laboratoryId' => (string) $event->laboratory_id,
                        'title' => 'Publikasi kandidat bertabrakan dengan Priority Event yang sudah disetujui.',
                        'details' => [
                            'eventNumber' => (string) $event->event_number,
                            'eventTitle' => (string) $event->title,
                            'candidateOccurrenceId' => (string) $candidate->id,
                            'sourceScheduleId' => (string) $candidate->entry?->source_schedule_id,
                        ],
                    ]);
                }
            }
        }

        $calendarEvents = OperationalCalendarEvent::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->where('availability_effect', 'blocked')
            ->whereDate('starts_on', '<=', $to)
            ->whereDate('ends_on', '>=', $from)
            ->orderBy('starts_on')
            ->orderBy('id')
            ->get();

        foreach ($calendarEvents as $event) {
            foreach ($candidateOccurrences as $candidate) {
                $date = $candidate->occurs_on->format('Y-m-d');

                if ($date < $event->starts_on->format('Y-m-d') || $date > $event->ends_on->format('Y-m-d')) {
                    continue;
                }
                if ($event->scope === 'laboratory' && $event->laboratory_id !== $candidate->planned_laboratory_id) {
                    continue;
                }
                if ($event->scope === 'laboratory' && $candidate->planned_laboratory_id === null) {
                    continue;
                }
                if (! $event->all_day && ! $this->overlaps(
                    $candidate->start_time_snapshot,
                    $candidate->end_time_snapshot,
                    $event->starts_at,
                    $event->ends_at,
                )) {
                    continue;
                }

                $this->pushBlocker($blockers, $fingerprintItems, [
                    'type' => 'calendar_blocker_conflict',
                    'entityId' => (string) $event->id,
                    'date' => $date,
                    'laboratoryId' => $candidate->planned_laboratory_id,
                    'title' => 'Publikasi kandidat bertabrakan dengan Calendar blocker aktif.',
                    'details' => [
                        'calendarTitle' => (string) $event->title,
                        'scope' => (string) $event->scope,
                        'category' => (string) $event->category,
                        'candidateOccurrenceId' => (string) $candidate->id,
                        'sourceScheduleId' => (string) $candidate->entry?->source_schedule_id,
                    ],
                ]);
            }
        }

        return $this->result($publication, $current, $from, $to, $diff, $blockers, $fingerprintItems);
    }

    /**
     * @return Collection<int,ScheduleOccurrence>
     */
    private function occurrences(string $schoolId, string $publicationId, string $from, string $to): Collection
    {
        return ScheduleOccurrence::query()
            ->where('school_id', $schoolId)
            ->where('publication_id', $publicationId)
            ->whereBetween('occurs_on', [$from, $to])
            ->with('entry:id,school_id,publication_id,source_schedule_id')
            ->orderBy('occurs_on')
            ->orderBy('start_time_snapshot')
            ->orderBy('id')
            ->get();
    }

    /**
     * @param Collection<string,ScheduleOccurrence> $candidate
     * @param Collection<string,ScheduleOccurrence> $current
     * @return array{added:int,removed:int,changed:int,unchanged:int}
     */
    private function scheduleDiff(Collection $candidate, Collection $current): array
    {
        $added = 0;
        $removed = 0;
        $changed = 0;
        $unchanged = 0;

        foreach ($candidate as $key => $occurrence) {
            /** @var ScheduleOccurrence|null $old */
            $old = $current->get($key);
            if ($old === null) {
                $added++;
            } elseif ($this->signature($old) === $this->signature($occurrence)) {
                $unchanged++;
            } else {
                $changed++;
            }
        }

        foreach ($current as $key => $_occurrence) {
            if (! $candidate->has($key)) {
                $removed++;
            }
        }

        return compact('added', 'removed', 'changed', 'unchanged');
    }

    private function sourceKey(ScheduleOccurrence $occurrence): string
    {
        return (string) $occurrence->entry?->source_schedule_id.'|'.$occurrence->occurs_on->format('Y-m-d');
    }

    /** @return array<string,mixed> */
    private function signature(ScheduleOccurrence $occurrence): array
    {
        return [
            'teacherId' => (string) $occurrence->teacher_id,
            'academicClassId' => (string) $occurrence->academic_class_id,
            'subjectId' => (string) $occurrence->subject_id,
            'plannedLaboratoryId' => $occurrence->planned_laboratory_id,
            'startsAt' => substr((string) $occurrence->start_time_snapshot, 0, 8),
            'endsAt' => substr((string) $occurrence->end_time_snapshot, 0, 8),
            'activityType' => (string) $occurrence->activity_type,
        ];
    }

    private function overlaps(mixed $leftStart, mixed $leftEnd, mixed $rightStart, mixed $rightEnd): bool
    {
        return substr((string) $leftStart, 0, 8) < substr((string) $rightEnd, 0, 8)
            && substr((string) $leftEnd, 0, 8) > substr((string) $rightStart, 0, 8);
    }

    /**
     * @param list<array<string,mixed>> $blockers
     * @param list<string> $fingerprintItems
     * @param array<string,mixed> $blocker
     */
    private function pushBlocker(array &$blockers, array &$fingerprintItems, array $blocker): void
    {
        $canonical = json_encode($blocker, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $fingerprintItems[] = $canonical;

        if (count($blockers) < self::MAX_BLOCKERS_RETURNED) {
            $blockers[] = $blocker;
        }
    }

    /**
     * @param array{added:int,removed:int,changed:int,unchanged:int} $diff
     * @param list<array<string,mixed>> $blockers
     * @param list<string> $fingerprintItems
     * @return array<string,mixed>
     */
    private function result(
        TimetablePublication $publication,
        ?TimetablePublication $current,
        string $from,
        string $to,
        array $diff,
        array $blockers,
        array $fingerprintItems,
    ): array {
        sort($fingerprintItems);

        $fingerprintPayload = [
            'candidateId' => (string) $publication->id,
            'candidateSourceVersion' => (int) $publication->source_version,
            'currentId' => $current?->id,
            'currentSourceVersion' => $current?->source_version,
            'window' => ['from' => $from, 'to' => $to],
            'scheduleDiff' => $diff,
            'blockers' => $fingerprintItems,
        ];

        $blockerCount = count($fingerprintItems);

        return [
            'publication' => [
                'id' => (string) $publication->id,
                'sourcePublicationId' => (string) $publication->source_publication_id,
                'sourceVersion' => (int) $publication->source_version,
                'status' => (string) $publication->status,
            ],
            'currentPublication' => $current === null ? null : [
                'id' => (string) $current->id,
                'sourcePublicationId' => (string) $current->source_publication_id,
                'sourceVersion' => (int) $current->source_version,
            ],
            'window' => ['from' => $from, 'to' => $to],
            'scheduleDiff' => $diff,
            'clear' => $blockerCount === 0,
            'blockerCount' => $blockerCount,
            'blockers' => $blockers,
            'truncated' => $blockerCount > count($blockers),
            'fingerprint' => hash(
                'sha256',
                json_encode($fingerprintPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ),
        ];
    }
}
