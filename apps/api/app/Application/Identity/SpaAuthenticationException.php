<?php

namespace App\Application\Identity;

use RuntimeException;

class SpaAuthenticationException extends RuntimeException
{
    private function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
        public readonly ?int $retryAfter = null,
    ) {
        parent::__construct($message);
    }

    public static function invalidCredentials(): self
    {
        return new self(
            'The provided credentials are invalid.',
            'INVALID_CREDENTIALS',
            401,
        );
    }

    public static function tooManyLoginAttempts(int $retryAfter): self
    {
        return new self(
            'Too many login attempts. Please try again later.',
            'TOO_MANY_LOGIN_ATTEMPTS',
            429,
            $retryAfter,
        );
    }
}
