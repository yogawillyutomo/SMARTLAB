<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceChangeEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id', 'device_id', 'actor_user_id', 'actor_membership_id',
        'actor_user_id_snapshot', 'actor_membership_id_snapshot',
        'event_type', 'changed_fields', 'changes', 'created_at',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    protected function casts(): array
    {
        return [
            'changed_fields' => 'array',
            'changes' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
