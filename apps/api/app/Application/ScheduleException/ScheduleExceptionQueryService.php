<?php

namespace App\Application\ScheduleException;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\ScheduleException\ScheduleExceptionDomainException;
use App\Models\ScheduleException;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class ScheduleExceptionQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<ScheduleException> */
    public function exceptions(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = ScheduleException::query()
            ->where('school_id', $context->membership->school_id)
            ->whereBetween('occurs_on', [$filters['from'], $filters['to']])
            ->with($this->relations());

        if (isset($filters['occurrenceId'])) {
            $query->where('occurrence_id', $filters['occurrenceId']);
        }

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query
            ->orderByDesc('occurs_on')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 100,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function exception(CurrentMembershipContext $context, string $id): ScheduleException
    {
        $exception = ScheduleException::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->with($this->relations())
            ->first();

        if ($exception === null) {
            throw ScheduleExceptionDomainException::notFound();
        }

        return $exception;
    }

    /** @return array<int,string|\Closure> */
    private function relations(): array
    {
        return [
            'occurrence:id,school_id,publication_id,entry_id,occurs_on,teacher_id,academic_class_id,subject_id,planned_laboratory_id,start_time_snapshot,end_time_snapshot,activity_type',
            'occurrence.teacher:id,school_id,code,name',
            'occurrence.academicClass:id,school_id,code,name',
            'occurrence.subject:id,school_id,code,name',
            'publication:id,school_id,source_publication_id,source_version,status',
            'entry:id,school_id,publication_id,source_schedule_id,source_snapshots',
            'originalLaboratory:id,school_id,code,name,capacity,status',
            'replacementLaboratory:id,school_id,code,name,capacity,status',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ];
    }
}
