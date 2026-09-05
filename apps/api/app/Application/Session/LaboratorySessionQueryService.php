<?php

namespace App\Application\Session;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Session\LaboratorySessionDomainException;
use App\Models\LaboratorySession;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class LaboratorySessionQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<LaboratorySession> */
    public function sessions(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $canViewAll = $context->permissions->contains('sessions.view-all');
        $scope = $filters['scope'] ?? ($canViewAll ? 'all' : 'mine');

        if ($scope === 'all' && ! $canViewAll) {
            throw LaboratorySessionDomainException::scopeForbidden();
        }

        $query = LaboratorySession::query()
            ->where('school_id', $context->membership->school_id)
            ->whereBetween('source_date', [$filters['from'], $filters['to']])
            ->with($this->relations());

        if ($scope === 'mine') {
            $query->where('source_owner_membership_id', $context->membership->id);
        }
        if (isset($filters['laboratoryId'])) {
            $query->where('laboratory_id', $filters['laboratoryId']);
        }
        if (isset($filters['sourceType'])) {
            $query->where('source_type', $filters['sourceType']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query
            ->orderByDesc('source_date')
            ->orderByDesc('source_starts_at')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 100,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function session(CurrentMembershipContext $context, string $id): LaboratorySession
    {
        $session = LaboratorySession::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->with($this->relations())
            ->first();

        if ($session === null) {
            throw LaboratorySessionDomainException::notFound();
        }

        if (! $context->permissions->contains('sessions.view-all')
            && $session->source_owner_membership_id !== $context->membership->id) {
            throw LaboratorySessionDomainException::notFound();
        }

        return $session;
    }

    /** @return array<int,string|\Closure> */
    private function relations(): array
    {
        return [
            'laboratory:id,school_id,code,name,capacity,status',
            'responsibleTeacher:id,school_id,code,name,membership_id',
            'academicClass:id,school_id,code,name,student_count',
            'subject:id,school_id,code,name',
            'sourcePublication:id,school_id,source_publication_id,source_version,status',
            'activityReport:id,school_id,session_id,report_number,report_type,status,version',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ];
    }
}
