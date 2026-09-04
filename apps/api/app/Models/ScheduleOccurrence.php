<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ScheduleOccurrence extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'publication_id',
        'entry_id',
        'occurs_on',
        'teacher_id',
        'academic_class_id',
        'subject_id',
        'planned_laboratory_id',
        'lesson_period_set_id',
        'start_lesson_period_id',
        'end_lesson_period_id',
        'start_time_snapshot',
        'end_time_snapshot',
        'activity_type',
    ];

    public function publication(): BelongsTo
    {
        return $this->belongsTo(TimetablePublication::class, 'publication_id');
    }

    public function entry(): BelongsTo
    {
        return $this->belongsTo(TimetableEntry::class, 'entry_id');
    }

    protected function casts(): array
    {
        return ['occurs_on' => 'date:Y-m-d'];
    }
}
