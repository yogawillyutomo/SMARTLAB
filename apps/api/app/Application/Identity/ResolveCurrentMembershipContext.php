<?php

namespace App\Application\Identity;

use App\Models\User;

class ResolveCurrentMembershipContext
{
    public function for(User $user): CurrentMembershipContext
    {
        $memberships = $user->memberships()
            ->where('status', 'active')
            ->whereHas('school', fn ($query) => $query->where('status', 'active'))
            ->with([
                'school:id,code,name',
                'roles:id,key,name',
                'roles.permissions:id,key,name',
            ])
            ->get();

        if ($memberships->isEmpty()) {
            throw new MembershipContextException(
                'An active school membership is required.',
                'ACTIVE_MEMBERSHIP_REQUIRED',
            );
        }

        if ($memberships->count() > 1) {
            throw new MembershipContextException(
                'A school context must be selected before this request can continue.',
                'SCHOOL_CONTEXT_REQUIRED',
            );
        }

        $membership = $memberships->sole();

        return new CurrentMembershipContext(
            membership: $membership,
            permissions: $membership->effectivePermissions()->pluck('key')->values(),
        );
    }
}
