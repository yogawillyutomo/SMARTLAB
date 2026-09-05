<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class LaboratorySession extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'session_number',
        'source_type',
        'schedule_occurrence_id',
        'reservation_id',
        'priority_event_id',
        'source_publication_id',
        'source_version_evidence',
        'source_fingerprint',
        'source_evidence',
        'source_owner_membership_id',
        'laboratory_id',
        'source_date',
        'source_starts_at',
        'source_ends_at',
        'activity_kind',
        'responsible_teacher_id',
        'responsible_name_snapshot',
        'academic_class_id',
        'subject_id',
        'planned_participant_count',
        'status',
        'opening_condition',
        'closing_condition',
        'end_outcome',
        'operational_notes',
        'prepared_by_user_id',
        'prepared_by_membership_id',
        'started_by_user_id',
        'started_by_membership_id',
        'ended_by_user_id',
        'ended_by_membership_id',
        'actual_started_at',
        'actual_ended_at',
        'cancelled_at',
        'cancellation_reason',
        'version',
    ];

    public function laboratory(): BelongsTo { return $this->belongsTo(Laboratory::class); }
    public function scheduleOccurrence(): BelongsTo { return $this->belongsTo(ScheduleOccurrence::class); }
    public function reservation(): BelongsTo { return $this->belongsTo(LaboratoryReservation::class); }
    public function priorityEvent(): BelongsTo { return $this->belongsTo(PriorityEvent::class); }
    public function sourcePublication(): BelongsTo { return $this->belongsTo(TimetablePublication::class, 'source_publication_id'); }
    public function sourceOwnerMembership(): BelongsTo { return $this->belongsTo(SchoolMembership::class, 'source_owner_membership_id'); }
    public function responsibleTeacher(): BelongsTo { return $this->belongsTo(Teacher::class, 'responsible_teacher_id'); }
    public function academicClass(): BelongsTo { return $this->belongsTo(AcademicClass::class); }
    public function subject(): BelongsTo { return $this->belongsTo(Subject::class); }
    public function events(): HasMany { return $this->hasMany(LaboratorySessionEvent::class, 'session_id'); }
    public function activityReport(): HasOne { return $this->hasOne(ActivityReport::class, 'session_id'); }

    public function sourceId(): string
    {
        return (string) match ($this->source_type) {
            'schedule_occurrence' => $this->schedule_occurrence_id,
            'laboratory_reservation' => $this->reservation_id,
            'priority_event' => $this->priority_event_id,
            default => '',
        };
    }

    protected function casts(): array
    {
        return [
            'source_version_evidence' => 'integer',
            'source_evidence' => 'array',
            'source_date' => 'date:Y-m-d',
            'planned_participant_count' => 'integer',
            'version' => 'integer',
            'actual_started_at' => 'immutable_datetime',
            'actual_ended_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
        ];
    }
}
