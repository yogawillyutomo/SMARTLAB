<?php

namespace App\Application\Schedule;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\ScheduleOccurrence;
use App\Models\TimetablePublication;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class ScheduleOccurrenceQueryService
{
    /**
     * @param array<string, mixed> $filters
     * @return array{paginator: LengthAwarePaginator<ScheduleOccurrence>, activePublicationCount: int}
     */
    public function currentPlan(CurrentMembershipContext $context, array $filters): array
    {
        $schoolId = (string) $context->membership->school_id;
        $from = (string) $filters['from'];
        $to = (string) $filters['to'];

        $activePublicationCount = TimetablePublication::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->whereDate('effective_from', '<=', $to)
            ->whereDate('effective_to', '>=', $from)
            ->count();

        $query = ScheduleOccurrence::query()
            ->where('school_id', $schoolId)
            ->whereBetween('occurs_on', [$from, $to])
            ->whereHas('publication', function ($query) use ($schoolId): void {
                $query
                    ->where('school_id', $schoolId)
                    ->where('status', 'active');
            })
            ->with([
                'publication:id,school_id,source_publication_id,source_version,status',
                'entry:id,school_id,publication_id,source_schedule_id,instruction_period_count,source_snapshots',
                'teacher:id,school_id,code,name',
                'academicClass:id,school_id,code,name',
                'subject:id,school_id,code,name',
                'plannedLaboratory:id,school_id,code,name',
            ]);

        if (isset($filters['laboratoryId'])) {
            $query->where('planned_laboratory_id', $filters['laboratoryId']);
        }
        if (isset($filters['teacherId'])) {
            $query->where('teacher_id', $filters['teacherId']);
        }
        if (isset($filters['academicClassId'])) {
            $query->where('academic_class_id', $filters['academicClassId']);
        }
        if (isset($filters['subjectId'])) {
            $query->where('subject_id', $filters['subjectId']);
        }
        if (isset($filters['activityType'])) {
            $query->where('activity_type', $filters['activityType']);
        }

        $paginator = $query
            ->orderBy('occurs_on')
            ->orderBy('start_time_snapshot')
            ->orderBy('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 250,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );

        return [
            'paginator' => $paginator,
            'activePublicationCount' => $activePublicationCount,
        ];
    }
}
