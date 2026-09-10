<?php

namespace App\Domain\Maintenance;

use RuntimeException;

class MaintenanceDomainException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function planNotFound(): self
    {
        return new self('Maintenance plan not found.', 'MAINTENANCE_PLAN_NOT_FOUND', 404);
    }

    public static function executionNotFound(): self
    {
        return new self('Maintenance execution not found.', 'MAINTENANCE_EXECUTION_NOT_FOUND', 404);
    }

    public static function campaignNotFound(): self
    {
        return new self('Maintenance campaign not found.', 'MAINTENANCE_CAMPAIGN_NOT_FOUND', 404);
    }

    public static function campaignVersionConflict(): self
    {
        return new self(
            'MaintenanceCampaign has changed since it was loaded.',
            'MAINTENANCE_CAMPAIGN_VERSION_CONFLICT',
            412,
        );
    }

    public static function checklistIncomplete(): self
    {
        return new self(
            'Every frozen checklist item must be completed before MaintenanceExecution can complete.',
            'MAINTENANCE_CHECKLIST_INCOMPLETE',
            409,
        );
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'MAINTENANCE_STATE_CONFLICT', 409);
    }

    public static function assetUnavailable(string $message = 'Asset is unavailable for preventive maintenance custody.'): self
    {
        return new self($message, 'MAINTENANCE_ASSET_UNAVAILABLE', 409);
    }
}
