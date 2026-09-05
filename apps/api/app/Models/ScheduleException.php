<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ScheduleException extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'occurrence_id',
        'publication_id',
        'entry_id',
        'occurs_on',
        'source_publication_id_snapshot',
        'source_version_snapshot',
        'source_schedule_id_snapshot',
        'resolution',
        'original_laboratory_id',
        'replacement_laboratory_id',
        'reason',
        'status',
        'approved_by_user_id',
        'approved_by_membership_id',
        'approved_by_name_snapshot',
        'cancelled_at',
        'version',
    ];

    public function occurrence(): BelongsTo
    {
        return $this->belongsTo(ScheduleOccurrence::class, 'occurrence_id');
    }

    public function publication(): BelongsTo
    {
        return $this->belongsTo(TimetablePublication::class, 'publication_id');
    }

    public function entry(): BelongsTo
    {
        return $this->belongsTo(TimetableEntry::class, 'entry_id');
    }

    public function originalLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'original_laboratory_id');
    }

    public function replacementLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'replacement_laboratory_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(ScheduleExceptionEvent::class, 'schedule_exception_id');
    }

    protected function casts(): array
    {
        return [
            'occurs_on' => 'date:Y-m-d',
            'source_version_snapshot' => 'integer',
            'version' => 'integer',
            'cancelled_at' => 'immutable_datetime',
        ];
    }
}
