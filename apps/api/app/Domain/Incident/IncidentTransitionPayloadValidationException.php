<?php

namespace App\Domain\Incident;

use RuntimeException;

final class IncidentTransitionPayloadValidationException extends RuntimeException
{
    public function __construct(
        public readonly string $field,
        string $message,
    ) {
        parent::__construct($message);
    }
}
