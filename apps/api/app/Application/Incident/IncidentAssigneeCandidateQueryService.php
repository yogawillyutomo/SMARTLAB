<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Models\SchoolMembership;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Pagination\LengthAwarePaginator;

final class IncidentAssigneeCandidateQueryService
{
    /** @param array<string, mixed> $filters */
    public function list(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = SchoolMembership::query()
            ->join('users', 'users.id', '=', 'school_memberships.user_id')
            ->where('school_memberships.school_id', $context->membership->school_id)
            ->where('school_memberships.status', 'active')
            ->where('users.status', 'active')
            ->whereExists(function (QueryBuilder $permissionQuery): void {
                $permissionQuery
                    ->selectRaw('1')
                    ->from('membership_roles')
                    ->join('role_permissions', 'role_permissions.role_id', '=', 'membership_roles.role_id')
                    ->join('permissions', 'permissions.id', '=', 'role_permissions.permission_id')
                    ->whereColumn('membership_roles.membership_id', 'school_memberships.id')
                    ->where('permissions.key', 'incidents.update');
            });

        if (isset($filters['search'])) {
            $this->applyLiteralNameSearch($query, (string) $filters['search']);
        }

        $grammar = $query->getQuery()->getGrammar();

        return $query
            ->orderByRaw('LOWER('.$grammar->wrap('users.name').') ASC')
            ->orderBy('school_memberships.id')
            ->paginate(
                (int) ($filters['perPage'] ?? 25),
                [
                    'school_memberships.id',
                    'school_memberships.user_id',
                    'users.name as user_name',
                ],
                'page',
                (int) ($filters['page'] ?? 1),
            );
    }

    /** @param Builder<SchoolMembership> $query */
    private function applyLiteralNameSearch(Builder $query, string $search): void
    {
        $grammar = $query->getQuery()->getGrammar();
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';

        $query->whereRaw(
            'LOWER('.$grammar->wrap('users.name').") LIKE ? ESCAPE '!'",
            [$pattern],
        );
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
    }
}
