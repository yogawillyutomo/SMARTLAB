<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ActivityReport extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'report_number',
        'origin',
        'session_id',
        'owner_membership_id',
        'manual_backfill_reason',
        'report_type',
        'status',
        'laboratory_id',
        'occurred_on',
        'source_snapshot',
        'session_snapshot',
        'responsible_teacher_id',
        'responsible_name_snapshot',
        'academic_class_id',
        'subject_id',
        'planned_participant_count',
        'present_count',
        'absent_count',
        'attendance_notes',
        'external_attendance_system',
        'external_attendance_reference_id',
        'common_content',
        'type_specific_content',
        'revision_reason',
        'submitted_at',
        'submitted_by_user_id',
        'submitted_by_membership_id',
        'verified_at',
        'verified_by_user_id',
        'verified_by_membership_id',
        'created_by_user_id',
        'created_by_membership_id',
        'version',
    ];

    public function laboratory(): BelongsTo { return $this->belongsTo(Laboratory::class); }
    public function session(): BelongsTo { return $this->belongsTo(LaboratorySession::class, 'session_id'); }
    public function ownerMembership(): BelongsTo { return $this->belongsTo(SchoolMembership::class, 'owner_membership_id'); }
    public function responsibleTeacher(): BelongsTo { return $this->belongsTo(Teacher::class, 'responsible_teacher_id'); }
    public function academicClass(): BelongsTo { return $this->belongsTo(AcademicClass::class); }
    public function subject(): BelongsTo { return $this->belongsTo(Subject::class); }
    public function events(): HasMany { return $this->hasMany(ActivityReportEvent::class, 'report_id'); }

    protected function casts(): array
    {
        return [
            'occurred_on' => 'date:Y-m-d',
            'source_snapshot' => 'array',
            'session_snapshot' => 'array',
            'planned_participant_count' => 'integer',
            'present_count' => 'integer',
            'absent_count' => 'integer',
            'common_content' => 'array',
            'type_specific_content' => 'array',
            'submitted_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
