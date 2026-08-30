<?php

namespace App\Models;

use Database\Factories\SchoolMembershipFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;

class SchoolMembership extends Model
{
    /** @use HasFactory<SchoolMembershipFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id',
        'user_id',
        'status',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class, 'membership_roles', 'membership_id', 'role_id');
    }

    /**
     * @return Collection<int, Permission>
     */
    public function effectivePermissions(): Collection
    {
        $this->loadMissing('roles.permissions');

        return $this->roles
            ->flatMap(fn (Role $role) => $role->permissions)
            ->unique('key')
            ->sortBy('key')
            ->values();
    }

    public function hasPermission(string $permission): bool
    {
        return $this->effectivePermissions()->contains('key', $permission);
    }

    public function reportedIncidents(): HasMany
    {
        return $this->hasMany(Incident::class, 'reporter_membership_id');
    }

    public function assignedIncidents(): HasMany
    {
        return $this->hasMany(Incident::class, 'assignee_membership_id');
    }
}
