<?php

namespace App\Domain\Schedule;

use RuntimeException;

class PublishedTimetableException extends RuntimeException
{
    /**
     * @param array<string, list<string>> $errors
     * @param array<string, mixed> $details
     */
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
        public readonly array $errors = [],
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function notFound(): self
    {
        return new self('Timetable publication not found.', 'TIMETABLE_PUBLICATION_NOT_FOUND', 404);
    }

    public static function conflict(string $message, string $code = 'TIMETABLE_PUBLICATION_CONFLICT'): self
    {
        return new self($message, $code, 409);
    }

    /**
     * @param array<string, list<string>> $errors
     * @param array<string, mixed> $details
     */
    public static function invalid(string $message, array $errors, array $details = []): self
    {
        return new self($message, 'TIMETABLE_PUBLICATION_INVALID', 422, $errors, $details);
    }

    public static function notActivatable(string $message): self
    {
        return new self($message, 'TIMETABLE_PUBLICATION_NOT_ACTIVATABLE', 409);
    }

    /** @param array<string,mixed> $impact */
    public static function reconciliationRequired(array $impact): self
    {
        return new self(
            'The timetable publication cannot be activated until operational impacts are reconciled.',
            'TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED',
            409,
            [],
            ['impact' => $impact],
        );
    }
}
