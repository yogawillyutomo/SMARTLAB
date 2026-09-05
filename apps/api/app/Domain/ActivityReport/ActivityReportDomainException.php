<?php

namespace App\Domain\ActivityReport;

use RuntimeException;

class ActivityReportDomainException extends RuntimeException
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
        return new self('Activity Report not found.', 'ACTIVITY_REPORT_NOT_FOUND', 404);
    }

    public static function scopeForbidden(): self
    {
        return new self('You do not have permission to view all Activity Reports.', 'ACTIVITY_REPORT_SCOPE_FORBIDDEN', 403);
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'ACTIVITY_REPORT_STATE_CONFLICT', 409);
    }

    public static function versionConflict(): self
    {
        return new self('Activity Report has changed since it was loaded.', 'ACTIVITY_REPORT_VERSION_CONFLICT', 412);
    }
}
