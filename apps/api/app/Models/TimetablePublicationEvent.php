<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TimetablePublicationEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'publication_id',
        'source_system',
        'source_publication_id',
        'source_version',
        'payload_sha256',
        'actor_type',
        'actor_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'payload',
        'created_at',
    ];

    public function publication(): BelongsTo
    {
        return $this->belongsTo(TimetablePublication::class, 'publication_id');
    }

    protected function casts(): array
    {
        return [
            'source_version' => 'integer',
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
