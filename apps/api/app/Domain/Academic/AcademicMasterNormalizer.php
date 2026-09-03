<?php

namespace App\Domain\Academic;

use Normalizer;

class AcademicMasterNormalizer
{
    public static function code(string $value): string
    {
        return AcademicMasterCatalog::normalizeCode($value);
    }

    public static function text(string $value): string
    {
        $trimmed = trim($value);
        $normalized = Normalizer::normalize($trimmed, Normalizer::FORM_C);

        return $normalized === false ? $trimmed : $normalized;
    }

    public static function nullableText(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $normalized = self::text($value);

        return $normalized === '' ? null : $normalized;
    }
}
