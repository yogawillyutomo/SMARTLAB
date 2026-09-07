<?php

namespace App\Domain\WorkOrder;

final class WorkOrderCatalog
{
    public const STATUSES = ['draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part', 'completed', 'verified', 'cancelled'];
    public const PRIORITIES = ['low', 'normal', 'high', 'critical'];
    public const ACTIVE_CUSTODY_STATUSES = ['in_progress', 'on_hold', 'waiting_part', 'completed'];
    public const DEVICE_REPAIR_LIFECYCLES = ['in_service', 'spare'];
}
