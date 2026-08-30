<?php

namespace App\Domain\Incident;

enum IncidentCategory: string
{
    case Hardware = 'hardware';
    case Software = 'software';
    case Network = 'network';
    case Electrical = 'electrical';
    case Peripheral = 'peripheral';
    case Facility = 'facility';
    case Cleanliness = 'cleanliness';
    case Security = 'security';
    case Other = 'other';

    /** @return list<string> */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
