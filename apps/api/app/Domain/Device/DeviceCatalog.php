<?php

namespace App\Domain\Device;

final class DeviceCatalog
{
    public const TYPES = [
        'desktop_pc', 'laptop', 'server', 'network_switch', 'router',
        'access_point', 'printer', 'projector', 'ups', 'other',
    ];

    public const LIFECYCLE_STATUSES = ['in_service', 'spare', 'retired', 'decommissioned'];

    public const MUTABLE_LIFECYCLE_STATUSES = ['in_service', 'spare'];

    public const TRANSFER_ELIGIBLE_LIFECYCLE_STATUSES = ['in_service', 'spare', 'retired'];
}
