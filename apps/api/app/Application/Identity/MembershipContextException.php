<?php

namespace App\Application\Identity;

use RuntimeException;

class MembershipContextException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status = 409,
    ) {
        parent::__construct($message);
    }
}
