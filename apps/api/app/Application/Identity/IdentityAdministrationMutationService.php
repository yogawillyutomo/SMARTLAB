<?php

namespace App\Application\Identity;

use App\Domain\Identity\IdentityAdministrationException;
use App\Domain\Identity\IdentityChangeEventType;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class IdentityAdministrationMutationService
{
    public function __construct(
        private readonly IdentityChangeEventRecorder $eventRecorder,
    ) {}

    /**
     * @param array{name: string, email: string, password: string, nip?: ?string, nis?: ?string, phone?: ?string, roleKeys: list<string>} $data
     */
    public function create(
        CurrentMembershipContext $context,
        User $actor,
        array $data,
    ): SchoolMembership {
        try {
            return DB::transaction(function () use ($context, $actor, $data): SchoolMembership {
                $schoolId = $context->membership->school_id;
                $this->lockSchool($schoolId);
                $this->assertEmailAvailable($data['email']);

                $roles = $this->rolesForKeys($data['roleKeys']);
                $roleKeys = $roles->pluck('key')->sort()->values()->all();

                $user = User::query()->create([
                    'name' => $data['name'],
                    'email' => $data['email'],
                    'password' => $data['password'],
                    'nip' => $data['nip'] ?? null,
                    'nis' => $data['nis'] ?? null,
                    'phone' => $data['phone'] ?? null,
                    'status' => 'active',
                ]);

                $membership = SchoolMembership::query()->create([
                    'school_id' => $schoolId,
                    'user_id' => $user->id,
                    'status' => 'active',
                ]);
                $membership->roles()->sync($roles->modelKeys());

                if (! $this->qualifiesAsActiveSuperAdmin('active', 'active', $roleKeys)
                    && ! $this->otherActiveSuperAdminExists($schoolId, $membership->id)) {
                    throw IdentityAdministrationException::lastSuperAdminRequired();
                }

                $membership = $this->freshProjection($membership->id);
                $this->eventRecorder->record(
                    $context,
                    $actor,
                    $membership,
                    IdentityChangeEventType::MembershipCreated,
                    [
                        'userStatus' => 'active',
                        'membershipStatus' => 'active',
                        'roleKeys' => $roleKeys,
                    ],
                );

                return $membership;
            }, 3);
        } catch (QueryException $exception) {
            if ($this->isUniqueViolation($exception)) {
                throw ValidationException::withMessages([
                    'email' => ['The email has already been taken.'],
                ]);
            }

            throw $exception;
        }
    }

    /**
     * @param array{name?: string, email?: string, nip?: ?string, nis?: ?string, phone?: ?string, userStatus?: string, membershipStatus?: string, roleKeys?: list<string>} $data
     */
    public function update(
        CurrentMembershipContext $context,
        User $actor,
        string $membershipId,
        array $data,
    ): SchoolMembership {
        try {
            return DB::transaction(function () use ($context, $actor, $membershipId, $data): SchoolMembership {
                $schoolId = $context->membership->school_id;
                $this->lockSchool($schoolId);

                $reference = SchoolMembership::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($membershipId)
                    ->first(['id', 'user_id']);

                if ($reference === null) {
                    throw IdentityAdministrationException::membershipNotFound();
                }

                $user = User::query()->whereKey($reference->user_id)->lockForUpdate()->firstOrFail();
                $membership = SchoolMembership::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($membershipId)
                    ->lockForUpdate()
                    ->first();

                if ($membership === null) {
                    throw IdentityAdministrationException::membershipNotFound();
                }

                $membership->load('roles:id,key,name');
                $before = $this->state($user, $membership);
                $after = $before;
                $roles = null;

                foreach (['name', 'email', 'nip', 'nis', 'phone'] as $field) {
                    if (array_key_exists($field, $data)) {
                        $after[$field] = $data[$field];
                    }
                }

                if (array_key_exists('userStatus', $data)) {
                    $after['userStatus'] = $data['userStatus'];
                }

                if (array_key_exists('membershipStatus', $data)) {
                    $after['membershipStatus'] = $data['membershipStatus'];
                }

                if (array_key_exists('roleKeys', $data)) {
                    $roles = $this->rolesForKeys($data['roleKeys']);
                    $after['roleKeys'] = $roles->pluck('key')->sort()->values()->all();
                }

                if ($after['email'] !== $before['email']) {
                    $this->assertEmailAvailable($after['email'], $user->id);
                }

                if (! $this->qualifiesAsActiveSuperAdmin(
                    $after['userStatus'],
                    $after['membershipStatus'],
                    $after['roleKeys'],
                ) && ! $this->otherActiveSuperAdminExists($schoolId, $membership->id)) {
                    throw IdentityAdministrationException::lastSuperAdminRequired();
                }

                [$changedBefore, $changedAfter] = $this->changes($before, $after);
                if ($changedBefore === []) {
                    return $this->freshProjection($membership->id);
                }

                $userAttributes = [];
                foreach (['name', 'email', 'nip', 'nis', 'phone'] as $field) {
                    if (array_key_exists($field, $changedAfter)) {
                        $userAttributes[$field] = $changedAfter[$field];
                    }
                }
                if (array_key_exists('userStatus', $changedAfter)) {
                    $userAttributes['status'] = $changedAfter['userStatus'];
                }
                if ($userAttributes !== []) {
                    $user->fill($userAttributes)->save();
                }

                if (array_key_exists('membershipStatus', $changedAfter)) {
                    $membership->status = $changedAfter['membershipStatus'];
                    $membership->save();
                }

                if (array_key_exists('roleKeys', $changedAfter)) {
                    if ($roles === null) {
                        throw new LogicException('Resolved roles are required for a role assignment change.');
                    }
                    $membership->roles()->sync($roles->modelKeys());
                }

                $membership->touch();
                $membership = $this->freshProjection($membership->id);
                $this->eventRecorder->record(
                    $context,
                    $actor,
                    $membership,
                    IdentityChangeEventType::MembershipUpdated,
                    [
                        'before' => $changedBefore,
                        'after' => $changedAfter,
                    ],
                );

                return $membership;
            }, 3);
        } catch (QueryException $exception) {
            if ($this->isUniqueViolation($exception)) {
                throw ValidationException::withMessages([
                    'email' => ['The email has already been taken.'],
                ]);
            }

            throw $exception;
        }
    }

    private function lockSchool(string $schoolId): void
    {
        School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();
    }

    /** @param list<string> $roleKeys @return Collection<int, Role> */
    private function rolesForKeys(array $roleKeys): Collection
    {
        $keys = collect($roleKeys)->sort()->values();
        $roles = Role::query()->whereIn('key', $keys)->orderBy('key')->get();

        if ($roles->count() !== $keys->count()) {
            throw new LogicException('Canonical identity role catalog is not seeded correctly.');
        }

        return $roles;
    }

    private function assertEmailAvailable(string $email, ?string $exceptUserId = null): void
    {
        $query = User::query()->whereRaw('LOWER(email) = ?', [mb_strtolower($email)]);
        if ($exceptUserId !== null) {
            $query->whereKeyNot($exceptUserId);
        }

        if ($query->exists()) {
            throw ValidationException::withMessages([
                'email' => ['The email has already been taken.'],
            ]);
        }
    }

    /** @return array{name: string, email: string, nip: ?string, nis: ?string, phone: ?string, userStatus: string, membershipStatus: string, roleKeys: list<string>} */
    private function state(User $user, SchoolMembership $membership): array
    {
        return [
            'name' => $user->name,
            'email' => $user->email,
            'nip' => $user->nip,
            'nis' => $user->nis,
            'phone' => $user->phone,
            'userStatus' => $user->status,
            'membershipStatus' => $membership->status,
            'roleKeys' => $membership->roles->pluck('key')->sort()->values()->all(),
        ];
    }

    /**
     * @param array<string, mixed> $before
     * @param array<string, mixed> $after
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function changes(array $before, array $after): array
    {
        $changedBefore = [];
        $changedAfter = [];

        foreach ($before as $field => $value) {
            if ($value === $after[$field]) {
                continue;
            }

            $changedBefore[$field] = $value;
            $changedAfter[$field] = $after[$field];
        }

        return [$changedBefore, $changedAfter];
    }

    /** @param list<string> $roleKeys */
    private function qualifiesAsActiveSuperAdmin(
        string $userStatus,
        string $membershipStatus,
        array $roleKeys,
    ): bool {
        return $userStatus === 'active'
            && $membershipStatus === 'active'
            && in_array('super-admin', $roleKeys, true);
    }

    private function otherActiveSuperAdminExists(string $schoolId, string $excludedMembershipId): bool
    {
        return SchoolMembership::query()
            ->where('school_id', $schoolId)
            ->where('id', '!=', $excludedMembershipId)
            ->where('status', 'active')
            ->whereHas('user', fn ($query) => $query->where('status', 'active'))
            ->whereHas('roles', fn ($query) => $query->where('roles.key', 'super-admin'))
            ->exists();
    }

    private function freshProjection(string $membershipId): SchoolMembership
    {
        return SchoolMembership::query()
            ->whereKey($membershipId)
            ->with([
                'user:id,name,email,nip,nis,phone,status,last_login_at',
                'roles:id,key,name',
            ])
            ->firstOrFail();
    }

    private function isUniqueViolation(QueryException $exception): bool
    {
        return in_array((string) $exception->getCode(), ['23000', '23505'], true);
    }
}
