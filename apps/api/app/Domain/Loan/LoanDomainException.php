<?php

namespace App\Domain\Loan;

use RuntimeException;

class LoanDomainException extends RuntimeException
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
        return new self('Loan not found.', 'LOAN_NOT_FOUND', 404);
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'LOAN_STATE_CONFLICT', 409);
    }
}
