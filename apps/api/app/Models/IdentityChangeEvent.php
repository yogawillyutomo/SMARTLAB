<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

class IdentityChangeEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'target_user_id',
        'target_membership_id',
        'target_user_id_snapshot',
        'target_membership_id_snapshot',
        'target_name_snapshot',
        'event_type',
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
