<?php

namespace App\Domain\Reservation;

use RuntimeException;

class LaboratoryReservationException extends RuntimeException
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
        return new self('Laboratory reservation not found.', 'LABORATORY_RESERVATION_NOT_FOUND', 404);
    }

    public static function versionConflict(): self
    {
        return new self('Laboratory reservation has changed since it was loaded.', 'LABORATORY_RESERVATION_VERSION_CONFLICT', 412);
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'LABORATORY_RESERVATION_STATE_CONFLICT', 409);
    }

    /** @param array<string,mixed> $availability */
    public static function unavailable(array $availability): self
    {
        return new self(
            'The requested Laboratory window is not safely available.',
            'LABORATORY_RESERVATION_UNAVAILABLE',
            409,
            ['availability' => $availability],
        );
    }
}
