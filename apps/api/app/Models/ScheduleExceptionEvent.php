<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ScheduleExceptionEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'schedule_exception_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'payload',
        'entity_version_before',
        'entity_version_after',
        'created_at',
    ];

    public function scheduleException(): BelongsTo
    {
        return $this->belongsTo(ScheduleException::class, 'schedule_exception_id');
    }

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'entity_version_before' => 'integer',
            'entity_version_after' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
