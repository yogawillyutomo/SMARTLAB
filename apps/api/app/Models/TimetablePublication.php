<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TimetablePublication extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'source_system',
        'source_publication_id',
        'source_version',
        'schema_version',
        'academic_reference_source',
        'source_school_id',
        'source_academic_year_id',
        'source_semester_id',
        'academic_year_id',
        'semester_id',
        'published_at',
        'effective_from',
        'effective_to',
        'payload_sha256',
        'source_payload',
        'status',
        'validation_summary',
        'validated_at',
        'activated_at',
        'superseded_at',
        'superseded_by_id',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class);
    }

    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class);
    }

    public function supersededBy(): BelongsTo
    {
        return $this->belongsTo(self::class, 'superseded_by_id');
    }

    public function entries(): HasMany
    {
        return $this->hasMany(TimetableEntry::class, 'publication_id');
    }

    public function occurrences(): HasMany
    {
        return $this->hasMany(ScheduleOccurrence::class, 'publication_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(TimetablePublicationEvent::class, 'publication_id');
    }

    protected function casts(): array
    {
        return [
            'source_version' => 'integer',
            'published_at' => 'immutable_datetime',
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
            'source_payload' => 'array',
            'validation_summary' => 'array',
            'validated_at' => 'immutable_datetime',
            'activated_at' => 'immutable_datetime',
            'superseded_at' => 'immutable_datetime',
        ];
    }
}
