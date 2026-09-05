<?php

namespace App\Domain\PriorityEvent;

use RuntimeException;

class PriorityEventDomainException extends RuntimeException
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
        return new self('Priority Event not found.', 'PRIORITY_EVENT_NOT_FOUND', 404);
    }

    public static function scopeForbidden(): self
    {
        return new self(
            'You do not have permission to view all Priority Events.',
            'PRIORITY_EVENT_SCOPE_FORBIDDEN',
            403,
        );
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'PRIORITY_EVENT_STATE_CONFLICT', 409);
    }

    public static function versionConflict(): self
    {
        return new self('Priority Event has changed since it was loaded.', 'PRIORITY_EVENT_VERSION_CONFLICT', 412);
    }

    /** @param array<string,mixed> $availability */
    public static function reconciliationRequired(array $availability): self
    {
        return new self(
            'Priority Event approval requires explicit reconciliation of the current Laboratory conflicts first.',
            'PRIORITY_EVENT_RECONCILIATION_REQUIRED',
            409,
            ['availability' => $availability],
        );
    }
}
