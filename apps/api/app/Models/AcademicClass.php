<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AcademicClass extends Model
{
    use HasUlids;

    protected $table = 'academic_classes';

    protected $fillable = [
        'school_id',
        'code',
        'name',
        'grade_level',
        'academic_unit_id',
        'homeroom_teacher_id',
        'student_count',
        'status',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function academicUnit(): BelongsTo
    {
        return $this->belongsTo(AcademicUnit::class);
    }

    public function homeroomTeacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'homeroom_teacher_id');
    }

    protected function casts(): array
    {
        return [
            'grade_level' => 'integer',
            'student_count' => 'integer',
            'version' => 'integer',
        ];
    }
}
