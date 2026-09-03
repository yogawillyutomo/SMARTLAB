<?php

namespace App\Domain\Academic;

use Normalizer;

class AcademicMasterNormalizer
{
    public static function code(string $value): string
    {
        return AcademicMasterCatalog::normalizeCode($value);
    }

    public static function nullableCode(?string $value): ?string
    {
        $normalized = self::nullableText($value);

        return $normalized === null ? null : self::code($normalized);
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

    public static function nullableEmail(?string $value): ?string
    {
        $normalized = self::nullableText($value);

        return $normalized === null ? null : mb_strtolower($normalized);
    }
}
