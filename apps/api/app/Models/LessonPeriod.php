<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LessonPeriod extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'lesson_period_set_id',
        'code',
        'sequence',
        'starts_at',
        'ends_at',
        'kind',
        'status',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function lessonPeriodSet(): BelongsTo
    {
        return $this->belongsTo(LessonPeriodSet::class);
    }

    protected function casts(): array
    {
        return [
            'sequence' => 'integer',
            'version' => 'integer',
        ];
    }
}
