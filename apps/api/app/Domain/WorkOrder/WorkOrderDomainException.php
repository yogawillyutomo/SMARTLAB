<?php

namespace App\Domain\WorkOrder;

use RuntimeException;

class WorkOrderDomainException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function notFound(): self
    {
        return new self('Work Order not found.', 'WORK_ORDER_NOT_FOUND', 404);
    }

    public static function versionConflict(): self
    {
        return new self('Work Order has changed since it was loaded.', 'WORK_ORDER_VERSION_CONFLICT', 412);
    }

    public static function invalidTransition(string $message = 'Work Order transition is not allowed.'): self
    {
        return new self($message, 'WORK_ORDER_INVALID_TRANSITION', 409);
    }

    public static function assetIneligible(string $message = 'Asset is not eligible for corrective repair.'): self
    {
        return new self($message, 'WORK_ORDER_ASSET_INELIGIBLE', 409);
    }

    public static function custodyConflict(string $message = 'Asset is unavailable for corrective custody.'): self
    {
        return new self($message, 'WORK_ORDER_ACTIVE_CUSTODY_CONFLICT', 409);
    }

    public static function incidentIneligible(string $message = 'Incident is not eligible for Work Order linkage.'): self
    {
        return new self($message, 'WORK_ORDER_INCIDENT_INELIGIBLE', 409);
    }

    public static function incidentSubjectMismatch(): self
    {
        return new self(
            'The Work Order Asset does not match the Device referenced by the Incident.',
            'WORK_ORDER_INCIDENT_SUBJECT_MISMATCH',
            409,
        );
    }

    public static function assigneeIneligible(): self
    {
        return new self('The selected Work Order assignee is not eligible.', 'WORK_ORDER_ASSIGNEE_INELIGIBLE', 409);
    }

    public static function numberExhausted(): self
    {
        return new self('Work Order number sequence is exhausted for this year.', 'WORK_ORDER_NUMBER_EXHAUSTED', 409);
    }

    public static function assetVersionDrift(): self
    {
        return new self(
            'Asset changed after corrective custody started; verification requires reconciliation.',
            'WORK_ORDER_ASSET_VERSION_DRIFT',
            409,
        );
    }

    public static function partUsageReconciliationRequired(): self
    {
        return new self(
            'Inventory movement exists without matching Work Order part-usage evidence.',
            'WORK_ORDER_PART_USAGE_RECONCILIATION_REQUIRED',
            409,
        );
    }
}
