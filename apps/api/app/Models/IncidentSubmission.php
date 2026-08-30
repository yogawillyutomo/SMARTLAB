<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class IncidentSubmission extends Model
{
    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = [
        'school_id', 'reporter_user_id_snapshot', 'submission_id', 'payload_fingerprint',
        'payload_fingerprint_version', 'incident_id', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Incident submissions are immutable.'));
        static::deleting(fn () => throw new LogicException('Incident submissions are immutable.'));
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function incident(): BelongsTo
    {
        return $this->belongsTo(Incident::class);
    }

    protected function casts(): array
    {
        return [
            'payload_fingerprint_version' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
