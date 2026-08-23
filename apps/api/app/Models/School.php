<?php

namespace App\Models;

use Database\Factories\SchoolFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class School extends Model
{
    /** @use HasFactory<SchoolFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    protected $fillable = [
        'code',
        'name',
        'timezone',
        'status',
    ];

    public function memberships(): HasMany
    {
        return $this->hasMany(SchoolMembership::class);
    }

    public function laboratories(): HasMany
    {
        return $this->hasMany(Laboratory::class);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    public function layouts(): HasMany
    {
        return $this->hasMany(Layout::class);
    }
}
