<?php

namespace App\Application\Availability;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Availability\LaboratoryAvailabilityException;
use App\Models\Laboratory;
use App\Models\LaboratorySession;
use App\Models\School;
use Carbon\CarbonImmutable;
use App\Models\LaboratoryReservation;
use App\Models\OperationalCalendarEvent;
use App\Models\PriorityEvent;
use App\Models\ScheduleException;
use App\Models\ScheduleOccurrence;
use App\Models\TimetablePublication;
use Illuminate\Database\Eloquent\Builder;

class LaboratoryAvailabilityQueryService
{
    /**
     * Evaluate one School-local Laboratory window against canonical scheduling and operational sources.
     *
     * Exclusion parameters exist only for transactional self-rechecks performed by canonical mutation services.
     *
     * @param array{laboratoryId:string,date:string,startsAt:string,endsAt:string} $filters
     * @return array<string,mixed>
     */
    public function check(
        CurrentMembershipContext $context,
        array $filters,
        ?string $excludeReservationId = null,
        ?string $excludeScheduleExceptionId = null,
        ?string $excludeScheduleOccurrenceId = null,
        ?string $excludePriorityEventId = null,
    ): array {
        $schoolId = (string) $context->membership->school_id;
        $laboratory = Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereKey($filters['laboratoryId'])
            ->first();

        if ($laboratory === null) {
            throw LaboratoryAvailabilityException::laboratoryNotFound();
        }

        $date = $filters['date'];
        $startsAt = $this->seconds($filters['startsAt']);
        $endsAt = $this->seconds($filters['endsAt']);
        $timezone = School::query()->whereKey($schoolId)->value('timezone') ?: config('app.timezone', 'UTC');
        $windowEndUtc = CarbonImmutable::createFromFormat(
            'Y-m-d H:i:s',
            $date.' '.$endsAt,
            $timezone,
        )->utc();

        $activePublicationCount = TimetablePublication::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->whereDate('effective_from', '<=', $date)
            ->whereDate('effective_to', '>=', $date)
            ->count();

        $scheduleCoverage = match (true) {
            $activePublicationCount === 0 => 'missing',
            $activePublicationCount === 1 => 'covered',
            default => 'ambiguous',
        };

        $occurrences = ScheduleOccurrence::query()
            ->where('school_id', $schoolId)
            ->where('planned_laboratory_id', $laboratory->id)
            ->whereDate('occurs_on', $date)
            ->where('start_time_snapshot', '<', $endsAt)
            ->where('end_time_snapshot', '>', $startsAt)
            ->when(
                $excludeScheduleOccurrenceId !== null,
                fn (Builder $query) => $query->where('id', '<>', $excludeScheduleOccurrenceId),
            )
            ->whereHas('publication', function (Builder $query) use ($schoolId, $date): void {
                $query
                    ->where('school_id', $schoolId)
                    ->where('status', 'active')
                    ->whereDate('effective_from', '<=', $date)
                    ->whereDate('effective_to', '>=', $date);
            })
            ->with([
                'publication:id,school_id,source_publication_id,source_version,status',
                'entry:id,school_id,publication_id,source_schedule_id,source_snapshots',
                'teacher:id,school_id,code,name',
                'academicClass:id,school_id,code,name',
                'subject:id,school_id,code,name',
                'activeException:id,school_id,occurrence_id,resolution,replacement_laboratory_id,status',
            ])
            ->orderBy('start_time_snapshot')
            ->orderBy('id')
            ->get();

        $relocations = ScheduleException::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->where('resolution', 'relocate')
            ->where('replacement_laboratory_id', $laboratory->id)
            ->whereDate('occurs_on', $date)
            ->when(
                $excludeScheduleExceptionId !== null,
                fn (Builder $query) => $query->where('id', '<>', $excludeScheduleExceptionId),
            )
            ->whereHas('occurrence', function (Builder $query) use ($schoolId, $date, $startsAt, $endsAt): void {
                $query
                    ->where('school_id', $schoolId)
                    ->whereDate('occurs_on', $date)
                    ->where('start_time_snapshot', '<', $endsAt)
                    ->where('end_time_snapshot', '>', $startsAt)
                    ->whereHas('publication', function (Builder $publication) use ($schoolId, $date): void {
                        $publication
                            ->where('school_id', $schoolId)
                            ->where('status', 'active')
                            ->whereDate('effective_from', '<=', $date)
                            ->whereDate('effective_to', '>=', $date);
                    });
            })
            ->with([
                'occurrence:id,school_id,publication_id,entry_id,occurs_on,teacher_id,academic_class_id,subject_id,planned_laboratory_id,start_time_snapshot,end_time_snapshot,activity_type',
                'occurrence.publication:id,school_id,source_publication_id,source_version,status',
                'occurrence.entry:id,school_id,publication_id,source_schedule_id,source_snapshots',
                'occurrence.teacher:id,school_id,code,name',
                'occurrence.academicClass:id,school_id,code,name',
                'occurrence.subject:id,school_id,code,name',
                'originalLaboratory:id,school_id,code,name',
                'replacementLaboratory:id,school_id,code,name',
            ])
            ->orderBy('id')
            ->get();

        $priorityEvents = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->where('laboratory_id', $laboratory->id)
            ->whereDate('event_date', $date)
            ->where('status', 'approved')
            ->where('starts_at', '<', $endsAt)
            ->where('ends_at', '>', $startsAt)
            ->when(
                $excludePriorityEventId !== null,
                fn (Builder $query) => $query->where('id', '<>', $excludePriorityEventId),
            )
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get();

        $reservations = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->where('laboratory_id', $laboratory->id)
            ->whereDate('reservation_date', $date)
            ->whereIn('status', ['submitted', 'approved'])
            ->where('starts_at', '<', $endsAt)
            ->where('ends_at', '>', $startsAt)
            ->when(
                $excludeReservationId !== null,
                fn (Builder $query) => $query->where('id', '<>', $excludeReservationId),
            )
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get();

        $sessions = LaboratorySession::query()
            ->where('school_id', $schoolId)
            ->where('laboratory_id', $laboratory->id)
            ->where('status', 'in_progress')
            ->whereNotNull('actual_started_at')
            ->where('actual_started_at', '<', $windowEndUtc)
            ->orderBy('actual_started_at')
            ->orderBy('id')
            ->get();

        $calendarEvents = OperationalCalendarEvent::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->whereDate('starts_on', '<=', $date)
            ->whereDate('ends_on', '>=', $date)
            ->where(function (Builder $query) use ($laboratory): void {
                $query
                    ->where('scope', 'school')
                    ->orWhere(function (Builder $query) use ($laboratory): void {
                        $query
                            ->where('scope', 'laboratory')
                            ->where('laboratory_id', $laboratory->id);
                    });
            })
            ->where(function (Builder $query) use ($startsAt, $endsAt): void {
                $query
                    ->where('all_day', true)
                    ->orWhere(function (Builder $query) use ($startsAt, $endsAt): void {
                        $query
                            ->where('all_day', false)
                            ->where('starts_at', '<', $endsAt)
                            ->where('ends_at', '>', $startsAt);
                    });
            })
            ->orderBy('starts_on')
            ->orderByRaw('CASE WHEN starts_at IS NULL THEN 0 ELSE 1 END')
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get();

        $blockers = [];
        if ($laboratory->status !== 'active') {
            $blockers[] = [
                'type' => 'laboratory_status',
                'sourceId' => (string) $laboratory->id,
                'title' => 'Laboratorium tidak aktif',
                'allDay' => true,
                'startsAt' => null,
                'endsAt' => null,
                'details' => [
                    'status' => (string) $laboratory->status,
                ],
            ];
        }

        foreach ($occurrences as $occurrence) {
            $exception = $occurrence->activeException;
            if ($exception !== null && $exception->id !== $excludeScheduleExceptionId) {
                continue;
            }

            $blockers[] = $this->scheduleBlocker($occurrence);
        }

        foreach ($relocations as $exception) {
            $blockers[] = $this->relocationBlocker($exception);
        }

        foreach ($priorityEvents as $priorityEvent) {
            $blockers[] = $this->priorityEventBlocker($priorityEvent);
        }

        foreach ($reservations as $reservation) {
            $blockers[] = $this->reservationBlocker($reservation);
        }

        foreach ($sessions as $session) {
            $blockers[] = $this->sessionBlocker($session, $date, $timezone);
        }

        $notices = [];
        foreach ($calendarEvents as $event) {
            $evidence = $this->calendarEvidence($event);
            if ($event->availability_effect === 'blocked') {
                $blockers[] = [
                    'type' => 'calendar_event',
                    ...$evidence,
                ];
            } else {
                $notices[] = $evidence;
            }
        }

        $issues = [];
        if ($scheduleCoverage === 'missing') {
            $issues[] = [
                'code' => 'schedule_coverage_missing',
                'message' => 'No active TESSELA timetable publication covers this date.',
            ];
        } elseif ($scheduleCoverage === 'ambiguous') {
            $issues[] = [
                'code' => 'schedule_coverage_ambiguous',
                'message' => 'More than one active timetable publication covers this date.',
            ];
        }

        $state = $this->state($blockers, $scheduleCoverage);

        return [
            'laboratory' => [
                'id' => (string) $laboratory->id,
                'code' => (string) $laboratory->code,
                'name' => (string) $laboratory->name,
                'status' => (string) $laboratory->status,
            ],
            'window' => [
                'date' => $date,
                'startsAt' => $startsAt,
                'endsAt' => $endsAt,
            ],
            'available' => $state === 'available',
            'state' => $state,
            'blockerCount' => count($blockers),
            'blockers' => $blockers,
            'noticeCount' => count($notices),
            'notices' => $notices,
            'sourceCoverage' => [
                'schedule' => [
                    'status' => $scheduleCoverage,
                    'activePublicationCount' => $activePublicationCount,
                ],
                'scheduleExceptions' => [
                    'status' => 'covered',
                ],
                'operationalCalendar' => [
                    'status' => 'covered',
                ],
                'reservations' => [
                    'status' => 'covered',
                ],
                'priorityEvents' => [
                    'status' => 'covered',
                ],
                'laboratorySessions' => [
                    'status' => 'covered',
                ],
                'laboratoryStatus' => [
                    'status' => 'covered',
                ],
            ],
            'issues' => $issues,
        ];
    }

    /** @return array<string,mixed> */
    private function scheduleBlocker(ScheduleOccurrence $occurrence): array
    {
        $snapshots = is_array($occurrence->entry?->source_snapshots)
            ? $occurrence->entry->source_snapshots
            : [];

        $teacher = $this->reference($occurrence->teacher_id, $snapshots, 'teacherCode', 'teacherName', $occurrence->teacher?->code, $occurrence->teacher?->name);
        $academicClass = $this->reference($occurrence->academic_class_id, $snapshots, 'classCode', 'className', $occurrence->academicClass?->code, $occurrence->academicClass?->name);
        $subject = $this->reference($occurrence->subject_id, $snapshots, 'subjectCode', 'subjectName', $occurrence->subject?->code, $occurrence->subject?->name);

        return [
            'type' => 'schedule_occurrence',
            'sourceId' => (string) $occurrence->id,
            'title' => $subject['name'].' · '.$academicClass['name'],
            'allDay' => false,
            'startsAt' => substr((string) $occurrence->start_time_snapshot, 0, 8),
            'endsAt' => substr((string) $occurrence->end_time_snapshot, 0, 8),
            'details' => [
                'publicationId' => (string) $occurrence->publication_id,
                'sourcePublicationId' => (string) $occurrence->publication?->source_publication_id,
                'sourceVersion' => (int) $occurrence->publication?->source_version,
                'sourceScheduleId' => (string) $occurrence->entry?->source_schedule_id,
                'activityType' => (string) $occurrence->activity_type,
                'teacher' => $teacher,
                'academicClass' => $academicClass,
                'subject' => $subject,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function relocationBlocker(ScheduleException $exception): array
    {
        $occurrence = $exception->occurrence;
        $snapshots = is_array($occurrence?->entry?->source_snapshots)
            ? $occurrence->entry->source_snapshots
            : [];

        $teacher = $this->reference((string) $occurrence?->teacher_id, $snapshots, 'teacherCode', 'teacherName', $occurrence?->teacher?->code, $occurrence?->teacher?->name);
        $academicClass = $this->reference((string) $occurrence?->academic_class_id, $snapshots, 'classCode', 'className', $occurrence?->academicClass?->code, $occurrence?->academicClass?->name);
        $subject = $this->reference((string) $occurrence?->subject_id, $snapshots, 'subjectCode', 'subjectName', $occurrence?->subject?->code, $occurrence?->subject?->name);

        return [
            'type' => 'schedule_exception',
            'sourceId' => (string) $exception->id,
            'title' => 'Relokasi · '.$subject['name'].' · '.$academicClass['name'],
            'allDay' => false,
            'startsAt' => substr((string) $occurrence?->start_time_snapshot, 0, 8),
            'endsAt' => substr((string) $occurrence?->end_time_snapshot, 0, 8),
            'details' => [
                'resolution' => 'relocate',
                'occurrenceId' => (string) $exception->occurrence_id,
                'publicationId' => (string) $exception->publication_id,
                'sourcePublicationId' => (string) $exception->source_publication_id_snapshot,
                'sourceVersion' => (int) $exception->source_version_snapshot,
                'sourceScheduleId' => (string) $exception->source_schedule_id_snapshot,
                'activityType' => (string) $occurrence?->activity_type,
                'originalLaboratory' => $exception->originalLaboratory === null ? null : [
                    'id' => (string) $exception->originalLaboratory->id,
                    'code' => (string) $exception->originalLaboratory->code,
                    'name' => (string) $exception->originalLaboratory->name,
                ],
                'replacementLaboratory' => [
                    'id' => (string) $exception->replacementLaboratory?->id,
                    'code' => (string) $exception->replacementLaboratory?->code,
                    'name' => (string) $exception->replacementLaboratory?->name,
                ],
                'teacher' => $teacher,
                'academicClass' => $academicClass,
                'subject' => $subject,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function priorityEventBlocker(PriorityEvent $event): array
    {
        return [
            'type' => 'priority_event',
            'sourceId' => (string) $event->id,
            'title' => (string) $event->title,
            'allDay' => false,
            'startsAt' => substr((string) $event->starts_at, 0, 8),
            'endsAt' => substr((string) $event->ends_at, 0, 8),
            'details' => [
                'eventNumber' => (string) $event->event_number,
                'category' => (string) $event->category,
                'status' => (string) $event->status,
                'requesterName' => (string) $event->requester_name_snapshot,
                'participants' => (int) $event->participants,
                'picName' => (string) $event->pic_name,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function reservationBlocker(LaboratoryReservation $reservation): array
    {
        return [
            'type' => 'reservation',
            'sourceId' => (string) $reservation->id,
            'title' => (string) $reservation->activity,
            'allDay' => false,
            'startsAt' => substr((string) $reservation->starts_at, 0, 8),
            'endsAt' => substr((string) $reservation->ends_at, 0, 8),
            'details' => [
                'reservationNumber' => (string) $reservation->reservation_number,
                'status' => (string) $reservation->status,
                'requesterName' => (string) $reservation->requester_name_snapshot,
                'participants' => (int) $reservation->participants,
                'picName' => (string) $reservation->pic_name,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function sessionBlocker(LaboratorySession $session, string $date, string $timezone): array
    {
        $started = $session->actual_started_at?->setTimezone($timezone);
        $startsAt = $started?->format('Y-m-d') === $date
            ? $started?->format('H:i:s')
            : null;

        return [
            'type' => 'laboratory_session',
            'sourceId' => (string) $session->id,
            'title' => 'Pelaksanaan Lab sedang berlangsung · '.$session->responsible_name_snapshot,
            'allDay' => false,
            'startsAt' => $startsAt,
            'endsAt' => null,
            'details' => [
                'sessionNumber' => (string) $session->session_number,
                'sessionStatus' => (string) $session->status,
                'sourceType' => (string) $session->source_type,
                'sourceId' => $session->sourceId(),
                'sourceDate' => $session->source_date?->format('Y-m-d'),
                'sourceStartsAt' => substr((string) $session->source_starts_at, 0, 8),
                'sourceEndsAt' => substr((string) $session->source_ends_at, 0, 8),
                'actualStartedAt' => $session->actual_started_at?->toISOString(),
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function calendarEvidence(OperationalCalendarEvent $event): array
    {
        return [
            'sourceId' => (string) $event->id,
            'title' => (string) $event->title,
            'allDay' => (bool) $event->all_day,
            'startsAt' => $event->all_day ? null : substr((string) $event->starts_at, 0, 8),
            'endsAt' => $event->all_day ? null : substr((string) $event->ends_at, 0, 8),
            'details' => [
                'category' => (string) $event->category,
                'scope' => (string) $event->scope,
            ],
        ];
    }

    /**
     * @param list<array<string,mixed>> $blockers
     */
    private function state(array $blockers, string $scheduleCoverage): string
    {
        if ($blockers === []) {
            return $scheduleCoverage === 'covered' ? 'available' : 'unknown';
        }

        $hasSchedule = false;
        $hasOperational = false;
        foreach ($blockers as $blocker) {
            if (in_array(($blocker['type'] ?? null), ['schedule_occurrence', 'schedule_exception'], true)) {
                $hasSchedule = true;
            } else {
                $hasOperational = true;
            }
        }

        if ($hasSchedule && $hasOperational) {
            return 'mixed';
        }

        return $hasSchedule ? 'scheduled' : 'blocked';
    }

    /**
     * @param array<string,mixed> $snapshots
     * @return array{id:string,code:string,name:string}
     */
    private function reference(
        string $id,
        array $snapshots,
        string $codeKey,
        string $nameKey,
        ?string $fallbackCode,
        ?string $fallbackName,
    ): array {
        $code = $snapshots[$codeKey] ?? null;
        $name = $snapshots[$nameKey] ?? null;

        return [
            'id' => $id,
            'code' => is_string($code) && trim($code) !== '' ? $code : (string) $fallbackCode,
            'name' => is_string($name) && trim($name) !== '' ? $name : (string) $fallbackName,
        ];
    }

    private function seconds(string $time): string
    {
        return strlen($time) === 5 ? $time.':00' : $time;
    }
}
