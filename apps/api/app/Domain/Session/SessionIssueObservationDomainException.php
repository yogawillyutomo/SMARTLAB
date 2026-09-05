<?php

namespace App\Domain\Session;

use RuntimeException;

class SessionIssueObservationDomainException extends RuntimeException
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
        return new self('Session issue observation not found.', 'SESSION_ISSUE_OBSERVATION_NOT_FOUND', 404);
    }

    public static function sessionNotFound(): self
    {
        return new self('Laboratory Session not found.', 'LABORATORY_SESSION_NOT_FOUND', 404);
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'SESSION_ISSUE_OBSERVATION_STATE_CONFLICT', 409);
    }

    public static function invalidSubjectReference(string $message): self
    {
        return new self($message, 'SESSION_ISSUE_OBSERVATION_REFERENCE_INVALID', 422);
    }
}
