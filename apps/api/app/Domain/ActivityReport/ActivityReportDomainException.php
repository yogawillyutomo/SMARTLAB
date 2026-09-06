<?php

namespace App\Domain\ActivityReport;

use App\Models\ActivityReport;
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

    public static function attachmentNotFound(): self
    {
        return new self('Activity Report attachment not found.', 'ACTIVITY_REPORT_ATTACHMENT_NOT_FOUND', 404);
    }

    public static function attachmentUnavailable(): self
    {
        return new self('Activity Report attachment is temporarily unavailable.', 'ACTIVITY_REPORT_ATTACHMENT_UNAVAILABLE', 410);
    }

    public static function attachmentStorageFailed(string $message, int $status = 503): self
    {
        return new self($message, 'ACTIVITY_REPORT_ATTACHMENT_STORAGE_FAILED', $status);
    }

    public static function offlineSyncConflict(ActivityReport $report): self
    {
        return new self(
            'Offline Activity Report draft cannot be applied because the canonical server version has changed.',
            'ACTIVITY_REPORT_OFFLINE_SYNC_CONFLICT',
            409,
            [
                'reportId' => (string) $report->id,
                'currentVersion' => (int) $report->version,
                'currentStatus' => (string) $report->status,
                'currentUpdatedAt' => $report->updated_at?->toISOString(),
            ],
        );
    }

    public static function syncMutationReused(): self
    {
        return new self(
            'The client mutation identifier was already used with different sync content.',
            'ACTIVITY_REPORT_SYNC_MUTATION_REUSED',
            409,
        );
    }
}
