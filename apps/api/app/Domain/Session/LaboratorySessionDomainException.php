<?php

namespace App\Domain\Session;

use RuntimeException;

class LaboratorySessionDomainException extends RuntimeException
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
        return new self('Laboratory Session not found.', 'LABORATORY_SESSION_NOT_FOUND', 404);
    }

    public static function scopeForbidden(): self
    {
        return new self('You do not have permission to view all Laboratory Sessions.', 'LABORATORY_SESSION_SCOPE_FORBIDDEN', 403);
    }

    public static function sourceNotFound(): self
    {
        return new self('Laboratory Session source not found.', 'LABORATORY_SESSION_SOURCE_NOT_FOUND', 404);
    }

    public static function sourceIneligible(string $message, array $details = []): self
    {
        return new self($message, 'LABORATORY_SESSION_SOURCE_INELIGIBLE', 409, $details);
    }

    public static function duplicateSource(string $sessionId): self
    {
        return new self(
            'A non-cancelled Laboratory Session already exists for this source.',
            'LABORATORY_SESSION_DUPLICATE_SOURCE',
            409,
            ['sessionId' => $sessionId],
        );
    }

    public static function stateConflict(string $message): self
    {
        return new self($message, 'LABORATORY_SESSION_STATE_CONFLICT', 409);
    }

    public static function versionConflict(): self
    {
        return new self('Laboratory Session has changed since it was loaded.', 'LABORATORY_SESSION_VERSION_CONFLICT', 412);
    }

    public static function sourceChanged(array $details = []): self
    {
        return new self(
            'The Laboratory Session source changed after preparation. Reload and reconcile before starting.',
            'SESSION_SOURCE_CHANGED',
            409,
            $details,
        );
    }

    public static function startUnavailable(array $availability): self
    {
        return new self(
            'The Laboratory Session cannot start while incompatible Laboratory blockers remain.',
            'LABORATORY_SESSION_START_UNAVAILABLE',
            409,
            ['availability' => $availability],
        );
    }

    public static function sourceActiveConflict(string $operation, array $session): self
    {
        return new self(
            'The source cannot be changed while a prepared or in-progress Laboratory Session exists.',
            'LABORATORY_SESSION_ACTIVE_SOURCE_CONFLICT',
            409,
            ['operation' => $operation, 'session' => $session],
        );
    }
}
