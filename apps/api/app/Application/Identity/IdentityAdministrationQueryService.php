<?php

namespace App\Application\Identity;

use App\Domain\Identity\IdentityAdministrationException;
use App\Domain\Identity\IdentityCatalog;
use App\Models\Role;
use App\Models\SchoolMembership;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class IdentityAdministrationQueryService
{
    /**
     * @param array{search?: string, status?: string, roleKey?: string, page?: int, perPage?: int} $filters
     * @return LengthAwarePaginator<SchoolMembership>
     */
    public function memberships(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = SchoolMembership::query()
            ->select('school_memberships.*')
            ->join('users', 'users.id', '=', 'school_memberships.user_id')
            ->where('school_memberships.school_id', $context->membership->school_id)
            ->with([
                'user:id,name,email,nip,nis,phone,status,last_login_at',
                'roles:id,key,name',
            ]);

        if (isset($filters['status'])) {
            $query->where('school_memberships.status', $filters['status']);
        }

        if (isset($filters['roleKey'])) {
            $roleKey = $filters['roleKey'];
            $query->whereHas('roles', fn (Builder $roleQuery) => $roleQuery->where('roles.key', $roleKey));
        }

        if (isset($filters['search'])) {
            $search = '%'.$filters['search'].'%';
            $query->where(function (Builder $searchQuery) use ($search): void {
                $searchQuery
                    ->whereLike('users.name', $search, caseSensitive: false)
                    ->orWhereLike('users.email', $search, caseSensitive: false);
            });
        }

        return $query
            ->orderBy('users.name')
            ->orderBy('users.email')
            ->orderBy('school_memberships.id')
            ->paginate(
                perPage: $filters['perPage'] ?? 25,
                columns: ['school_memberships.*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function membership(CurrentMembershipContext $context, string $membershipId): SchoolMembership
    {
        return SchoolMembership::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($membershipId)
            ->with([
                'user:id,name,email,nip,nis,phone,status,last_login_at',
                'roles:id,key,name',
            ])
            ->first() ?? throw IdentityAdministrationException::membershipNotFound();
    }

    /** @return Collection<int, Role> */
    public function roles(CurrentMembershipContext $context): Collection
    {
        $schoolId = $context->membership->school_id;

        return Role::query()
            ->whereIn('key', IdentityCatalog::roleKeys())
            ->with(['permissions:id,key,name'])
            ->withCount([
                'memberships as membership_count' => fn (Builder $query) => $query
                    ->where('school_memberships.school_id', $schoolId),
                'memberships as active_membership_count' => fn (Builder $query) => $query
                    ->where('school_memberships.school_id', $schoolId)
                    ->where('school_memberships.status', 'active')
                    ->whereHas('user', fn (Builder $userQuery) => $userQuery->where('users.status', 'active')),
            ])
            ->orderBy('name')
            ->orderBy('key')
            ->get();
    }
}
