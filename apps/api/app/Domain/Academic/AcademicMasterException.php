<?php

namespace App\Domain\Academic;

use RuntimeException;

class AcademicMasterException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function notFound(string $entityLabel = 'Academic master data'): self
    {
        return new self($entityLabel.' not found.', 'ACADEMIC_MASTER_NOT_FOUND', 404);
    }

    public static function versionConflict(string $entityLabel = 'Academic master data'): self
    {
        return new self(
            $entityLabel.' has changed since it was loaded.',
            'ACADEMIC_MASTER_VERSION_CONFLICT',
            412,
        );
    }

    public static function conflict(string $message): self
    {
        return new self($message, 'ACADEMIC_MASTER_CONFLICT', 409);
    }
}
