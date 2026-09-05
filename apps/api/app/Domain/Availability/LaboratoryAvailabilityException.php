<?php

namespace App\Domain\Availability;

use RuntimeException;

class LaboratoryAvailabilityException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function laboratoryNotFound(): self
    {
        return new self(
            'Laboratory not found in the active School.',
            'LABORATORY_AVAILABILITY_LAB_NOT_FOUND',
            404,
        );
    }
}
