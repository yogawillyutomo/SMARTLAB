<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceTransfer extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id', 'device_id', 'device_id_snapshot', 'device_code_snapshot',
        'source_laboratory_id', 'source_laboratory_id_snapshot', 'source_laboratory_code_snapshot', 'source_laboratory_name_snapshot',
        'destination_laboratory_id', 'destination_laboratory_id_snapshot', 'destination_laboratory_code_snapshot', 'destination_laboratory_name_snapshot',
        'actor_user_id', 'actor_user_id_snapshot', 'actor_name_snapshot', 'reason',
        'device_version_before', 'device_version_after', 'created_at',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function sourceLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'source_laboratory_id');
    }

    public function destinationLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'destination_laboratory_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    protected function casts(): array
    {
        return [
            'device_version_before' => 'integer',
            'device_version_after' => 'integer',
            'created_at' => 'datetime',
        ];
    }
}
