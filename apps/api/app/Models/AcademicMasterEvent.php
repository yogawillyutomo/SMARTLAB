<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AcademicMasterEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'entity_type',
        'entity_id_snapshot',
        'entity_code_snapshot',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'payload',
        'entity_version_before',
        'entity_version_after',
        'created_at',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
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
