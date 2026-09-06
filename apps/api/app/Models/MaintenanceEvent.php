<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

class MaintenanceEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id',
        'entity_type',
        'maintenance_plan_id',
        'maintenance_execution_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'before_status',
        'after_status',
        'payload',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
