<?php

namespace App\Domain\Asset;

use RuntimeException;

class AssetDomainException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }
}
