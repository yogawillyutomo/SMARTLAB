<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TimetableEntry extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'publication_id',
        'source_schedule_id',
        'teacher_id',
        'academic_class_id',
        'subject_id',
        'lesson_period_set_id',
        'start_lesson_period_id',
        'end_lesson_period_id',
        'planned_laboratory_id',
        'activity_type',
        'recurrence_kind',
        'weekday',
        'entry_effective_from',
        'entry_effective_to',
        'occurs_on',
        'start_time_snapshot',
        'end_time_snapshot',
        'instruction_period_count',
        'source_snapshots',
    ];

    public function publication(): BelongsTo
    {
        return $this->belongsTo(TimetablePublication::class, 'publication_id');
    }

    public function occurrences(): HasMany
    {
        return $this->hasMany(ScheduleOccurrence::class, 'entry_id');
    }

    protected function casts(): array
    {
        return [
            'weekday' => 'integer',
            'entry_effective_from' => 'date:Y-m-d',
            'entry_effective_to' => 'date:Y-m-d',
            'occurs_on' => 'date:Y-m-d',
            'instruction_period_count' => 'integer',
            'source_snapshots' => 'array',
        ];
    }
}
