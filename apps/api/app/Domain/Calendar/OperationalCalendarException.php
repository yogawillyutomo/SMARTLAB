<?php

namespace App\Domain\Calendar;

use RuntimeException;

class OperationalCalendarException extends RuntimeException
{
    public function __construct(string $message, public readonly string $errorCode, public readonly int $status)
    {
        parent::__construct($message);
    }

    public static function notFound(): self
    {
        return new self('Calendar event not found.', 'CALENDAR_EVENT_NOT_FOUND', 404);
    }

    public static function versionConflict(): self
    {
        return new self('Calendar event has changed since it was loaded.', 'CALENDAR_EVENT_VERSION_CONFLICT', 412);
    }

    public static function conflict(string $message): self
    {
        return new self($message, 'CALENDAR_EVENT_CONFLICT', 409);
    }
}
