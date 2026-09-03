<?php

namespace App\Domain\Identity;

use RuntimeException;

class IdentityAdministrationException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly int $status,
    ) {
        parent::__construct($message);
    }

    public static function membershipNotFound(): self
    {
        return new self(
            'School membership not found.',
            'IDENTITY_MEMBERSHIP_NOT_FOUND',
            404,
        );
    }

    public static function lastSuperAdminRequired(): self
    {
        return new self(
            'At least one active Super Admin membership is required for this school.',
            'IDENTITY_LAST_SUPER_ADMIN_REQUIRED',
            409,
        );
    }

    public static function sharedUserMutationRequiresGlobalAuthority(): self
    {
        return new self(
            'Shared user account fields cannot be changed from a school-scoped administration context.',
            'IDENTITY_SHARED_USER_MUTATION_REQUIRES_GLOBAL_AUTHORITY',
            409,
        );
    }
}
