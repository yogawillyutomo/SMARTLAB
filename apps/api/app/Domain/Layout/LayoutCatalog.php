<?php

namespace App\Domain\Layout;

class LayoutCatalog
{
    public const STATUSES = ['draft', 'active', 'archived'];

    public const STRUCTURAL_TYPES = ['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'];

    public const PLACEMENT_ROLES = ['student_station', 'teacher_station'];

    public const ROTATIONS = [0, 90, 180, 270];

    public const ELIGIBLE_DEVICE_LIFECYCLES = ['in_service', 'spare'];

    public const STATION_DEVICE_TYPES = ['desktop_pc', 'laptop'];
}
