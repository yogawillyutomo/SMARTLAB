<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AcademicYear extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'code',
        'name',
        'starts_on',
        'ends_on',
        'status',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function semesters(): HasMany
    {
        return $this->hasMany(Semester::class);
    }

    public function lessonPeriodSets(): HasMany
    {
        return $this->hasMany(LessonPeriodSet::class);
    }

    protected function casts(): array
    {
        return [
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
            'version' => 'integer',
        ];
    }
}
