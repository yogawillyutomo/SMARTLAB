<?php

namespace App\Application\ActivityReport;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\ActivityReport\ActivityReportDomainException;
use App\Models\ActivityReport;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class ActivityReportQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<ActivityReport> */
    public function reports(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $schoolId = (string) $context->membership->school_id;
        $canViewAll = $context->permissions->contains('activity-reports.view-all');
        $scope = $filters['scope'] ?? ($canViewAll ? 'all' : 'mine');

        if ($scope === 'all' && ! $canViewAll) {
            throw ActivityReportDomainException::scopeForbidden();
        }

        $query = ActivityReport::query()
            ->where('school_id', $schoolId)
            ->whereBetween('occurred_on', [$filters['from'], $filters['to']])
            ->with($this->relations());

        if ($scope === 'mine') {
            $query->where('owner_membership_id', $context->membership->id);
        }
        if (isset($filters['laboratoryId'])) {
            $query->where('laboratory_id', $filters['laboratoryId']);
        }
        if (isset($filters['reportType'])) {
            $query->where('report_type', $filters['reportType']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['origin'])) {
            $query->where('origin', $filters['origin']);
        }

        return $query
            ->orderByDesc('occurred_on')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 100,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function report(CurrentMembershipContext $context, string $id): ActivityReport
    {
        $report = ActivityReport::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->with($this->relations())
            ->first();

        if ($report === null) {
            throw ActivityReportDomainException::notFound();
        }

        $this->assertAccess($context, $report);

        return $report;
    }

    private function assertAccess(CurrentMembershipContext $context, ActivityReport $report): void
    {
        if ($context->permissions->contains('activity-reports.view-all')) {
            return;
        }

        if ($report->owner_membership_id !== $context->membership->id) {
            throw ActivityReportDomainException::notFound();
        }
    }

    /** @return array<int|string,mixed> */
    private function relations(): array
    {
        return [
            'laboratory:id,school_id,code,name,capacity,status',
            'session:id,school_id,session_number,status,source_type,source_date,actual_started_at,actual_ended_at,version',
            'responsibleTeacher:id,school_id,code,name,membership_id',
            'academicClass:id,school_id,code,name,student_count',
            'subject:id,school_id,code,name',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ];
    }
}
