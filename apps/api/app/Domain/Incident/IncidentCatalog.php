<?php

namespace App\Domain\Incident;

final class IncidentCatalog
{
    public const REPORTING_DEVICE_LIFECYCLE_STATUSES = ['in_service', 'spare'];

    public const UPDATED_FIELDS = [
        'blocksLaboratoryOperation',
        'category',
        'description',
        'deviceId',
        'impact',
        'laboratoryId',
        'occurredAt',
        'priority',
        'stepsTaken',
        'title',
    ];
}
