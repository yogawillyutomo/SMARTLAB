<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LessonPeriodSet extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'academic_year_id',
        'code',
        'name',
        'status',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public function periods(): HasMany
    {
        return $this->hasMany(LessonPeriod::class);
    }

    protected function casts(): array
    {
        return [
            'version' => 'integer',
        ];
    }
}
