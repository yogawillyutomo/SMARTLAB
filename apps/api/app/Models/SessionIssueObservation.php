<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class SessionIssueObservation extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'session_id',
        'subject_type',
        'reference_id',
        'reference_code_snapshot',
        'summary',
        'severity',
        'observed_at',
        'observed_by_user_id',
        'observed_by_membership_id',
        'observed_by_name_snapshot',
        'promotion_submission_id',
        'incident_id',
        'incident_linked_at',
        'incident_linked_by_user_id',
        'incident_linked_by_membership_id',
        'version',
        'created_at',
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Session issue observations cannot be deleted.'));
    }

    public function session(): BelongsTo { return $this->belongsTo(LaboratorySession::class, 'session_id'); }
    public function incident(): BelongsTo { return $this->belongsTo(Incident::class); }

    protected function casts(): array
    {
        return [
            'observed_at' => 'immutable_datetime',
            'incident_linked_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
