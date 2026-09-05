<?php

namespace App\Application\Availability;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Availability\LaboratoryAvailabilityException;
use App\Models\Laboratory;
use App\Models\OperationalCalendarEvent;
use App\Models\ScheduleOccurrence;
use App\Models\TimetablePublication;
use Illuminate\Database\Eloquent\Builder;

class LaboratoryAvailabilityQueryService
{
    /**
     * Evaluate one School-local Laboratory window against the canonical sources available in S2.5.
     *
     * @param array{laboratoryId:string,date:string,startsAt:string,endsAt:string} $filters
     * @return array<string,mixed>
     */
    public function check(CurrentMembershipContext $context, array $filters): array
    {
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
            ])
            ->orderBy('start_time_snapshot')
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
            $blockers[] = $this->scheduleBlocker($occurrence);
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
                'operationalCalendar' => [
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
            if (($blocker['type'] ?? null) === 'schedule_occurrence') {
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
        return $time.':00';
    }
}
