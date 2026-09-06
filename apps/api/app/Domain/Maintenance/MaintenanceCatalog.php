<?php

namespace App\Domain\Maintenance;

class MaintenanceCatalog
{
    public const PLAN_STATUSES = ['active', 'inactive'];

    public const FREQUENCY_KINDS = [
        'weekly', 'monthly', 'quarterly', 'semester', 'yearly', 'custom_interval',
    ];

    public const EXECUTION_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'];
}
