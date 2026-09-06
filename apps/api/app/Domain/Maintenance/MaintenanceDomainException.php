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

    public static function stateConflict(string $message): self
    {
        return new self($message, 'MAINTENANCE_STATE_CONFLICT', 409);
    }

    public static function assetUnavailable(string $message = 'Asset is unavailable for preventive maintenance custody.'): self
    {
        return new self($message, 'MAINTENANCE_ASSET_UNAVAILABLE', 409);
    }
}
