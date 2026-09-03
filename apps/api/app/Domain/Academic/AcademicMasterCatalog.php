<?php

namespace App\Domain\Academic;

class AcademicMasterCatalog
{
    public const STATUSES = ['active', 'inactive'];

    public const LESSON_PERIOD_KINDS = ['instruction', 'break'];

    public const ENTITY_TYPES = [
        'academic_unit',
        'teacher',
        'academic_class',
        'subject',
        'academic_year',
        'semester',
        'lesson_period_set',
        'lesson_period',
    ];

    public const EVENT_TYPES = [
        'academic_master.created',
        'academic_master.updated',
        'academic_master.deactivated',
        'academic_master.reactivated',
    ];

    public const CODE_PATTERN = '/^[A-Z0-9][A-Z0-9._\/-]{0,63}$/';

    public static function normalizeCode(string $value): string
    {
        return mb_strtoupper(trim($value));
    }
}
