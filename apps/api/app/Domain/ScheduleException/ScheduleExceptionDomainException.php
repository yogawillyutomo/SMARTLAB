<?php

namespace App\Domain\ScheduleException;

use RuntimeException;

class ScheduleExceptionDomainException extends RuntimeException
{
    /** @param array<string,mixed> $details */
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function notFound(): self
    {
        return new self('Schedule exception not found.', 'SCHEDULE_EXCEPTION_NOT_FOUND', 404);
    }

    public static function occurrenceNotFound(): self
    {
        return new self('Active Schedule Occurrence not found.', 'SCHEDULE_EXCEPTION_OCCURRENCE_NOT_FOUND', 404);
    }

    public static function alreadyActive(): self
    {
        return new self('This Schedule Occurrence already has an active exception.', 'SCHEDULE_EXCEPTION_ALREADY_ACTIVE', 409);
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'SCHEDULE_EXCEPTION_STATE_CONFLICT', 409);
    }

    public static function versionConflict(): self
    {
        return new self('Schedule exception has changed since it was loaded.', 'SCHEDULE_EXCEPTION_VERSION_CONFLICT', 412);
    }

    /** @param array<string,mixed> $availability */
    public static function unavailable(array $availability): self
    {
        return new self(
            'The target Laboratory window is not safely available.',
            'SCHEDULE_EXCEPTION_TARGET_UNAVAILABLE',
            409,
            ['availability' => $availability],
        );
    }

    /** @param array<string,mixed> $availability */
    public static function restorationUnavailable(array $availability): self
    {
        return new self(
            'Cancelling this exception would restore the source occurrence into an unavailable Laboratory window.',
            'SCHEDULE_EXCEPTION_RESTORATION_UNAVAILABLE',
            409,
            ['availability' => $availability],
        );
    }
}
