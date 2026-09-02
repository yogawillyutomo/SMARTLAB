<?php

namespace App\Domain\Incident;

use RuntimeException;

class IncidentDomainException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function submissionConflict(): self
    {
        return new self('The submission ID was already used for different Incident data.', 'INCIDENT_SUBMISSION_CONFLICT', 409);
    }

    public static function ticketSequenceExhausted(): self
    {
        return new self('The Incident ticket sequence is exhausted for this School and year.', 'INCIDENT_TICKET_SEQUENCE_EXHAUSTED', 409);
    }

    public static function invalidTransition(): self
    {
        return new self('The requested Incident transition is not allowed.', 'INCIDENT_INVALID_TRANSITION', 409);
    }

    public static function versionConflict(): self
    {
        return new self('The Incident has changed since it was loaded.', 'INCIDENT_VERSION_CONFLICT', 412);
    }

    public static function statusConflict(): self
    {
        return new self('The operation is unavailable in the current Incident status.', 'INCIDENT_STATUS_CONFLICT', 409);
    }

    public static function forbidden(): self
    {
        return new self('You do not have permission to perform this action.', 'FORBIDDEN', 403);
    }

    public static function incidentNotFound(): self
    {
        return new self('Incident not found.', 'INCIDENT_NOT_FOUND', 404);
    }

    public static function laboratoryNotFound(): self
    {
        return new self('Laboratory not found.', 'LABORATORY_NOT_FOUND', 404);
    }

    public static function submissionNotFound(): self
    {
        return new self('Incident submission not found.', 'INCIDENT_SUBMISSION_NOT_FOUND', 404);
    }

    public static function laboratoryIneligible(): self
    {
        return new self('The Laboratory is not eligible for Incident reporting.', 'INCIDENT_LABORATORY_INELIGIBLE', 409);
    }

    public static function deviceIneligible(): self
    {
        return new self('The Device is not eligible for this Incident.', 'INCIDENT_DEVICE_NOT_ELIGIBLE', 409);
    }

    public static function assigneeNotFound(): self
    {
        return new self('The Incident assignee was not found.', 'INCIDENT_ASSIGNEE_NOT_FOUND', 404);
    }

    public static function assigneeIneligible(): self
    {
        return new self('The Incident assignee is not eligible.', 'INCIDENT_ASSIGNEE_INELIGIBLE', 409);
    }
}
