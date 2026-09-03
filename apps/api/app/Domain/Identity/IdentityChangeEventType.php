<?php

namespace App\Domain\Identity;

final class IdentityChangeEventType
{
    public const MembershipCreated = 'identity.membership_created';

    public const MembershipUpdated = 'identity.membership_updated';

    public const ALL = [
        self::MembershipCreated,
        self::MembershipUpdated,
    ];
}
