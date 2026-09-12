<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class DeviceAgentEnrollment extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'device_id', 'code_hash', 'status',
        'created_by_user_id', 'created_by_membership_id',
        'created_by_user_id_snapshot', 'created_by_membership_id_snapshot', 'created_by_name_snapshot',
        'expires_at', 'redeemed_at',
        'revoked_by_user_id', 'revoked_by_membership_id',
        'revoked_by_user_id_snapshot', 'revoked_by_membership_id_snapshot', 'revoked_by_name_snapshot',
        'revoked_reason', 'revoked_at',
    ];

    protected $hidden = ['code_hash'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'redeemed_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function installation(): HasOne
    {
        return $this->hasOne(DeviceAgentInstallation::class, 'enrollment_id');
    }
}
