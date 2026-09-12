<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceAgentInstallation extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'device_id', 'enrollment_id', 'status',
        'credential_id', 'credential_secret_hash', 'credential_version',
        'enrolled_by_user_id', 'enrolled_by_membership_id',
        'enrolled_by_user_id_snapshot', 'enrolled_by_membership_id_snapshot', 'enrolled_by_name_snapshot',
        'enrolled_at',
        'revoked_by_user_id', 'revoked_by_membership_id',
        'revoked_by_user_id_snapshot', 'revoked_by_membership_id_snapshot', 'revoked_by_name_snapshot',
        'revoked_reason', 'revoked_at', 'last_authenticated_at', 'last_agent_version',
    ];

    protected $hidden = ['credential_secret_hash'];

    protected function casts(): array
    {
        return [
            'credential_version' => 'integer',
            'enrolled_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
            'last_authenticated_at' => 'immutable_datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function enrollment(): BelongsTo
    {
        return $this->belongsTo(DeviceAgentEnrollment::class, 'enrollment_id');
    }
}
