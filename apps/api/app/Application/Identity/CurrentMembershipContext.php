<?php

namespace App\Application\Identity;

use App\Models\SchoolMembership;
use Illuminate\Support\Collection;

class CurrentMembershipContext
{
    /**
     * @param Collection<int, string> $permissions
     */
    public function __construct(
        public readonly SchoolMembership $membership,
        public readonly Collection $permissions,
    ) {
    }
}
