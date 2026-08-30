<?php

namespace App\Models;

use App\Domain\Incident\IncidentCategory;
use App\Domain\Incident\IncidentPriority;
use App\Domain\Incident\IncidentStatus;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use LogicException;

class Incident extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'ticket_year', 'ticket_sequence', 'ticket_number',
        'reporter_user_id', 'reporter_membership_id', 'reporter_user_id_snapshot',
        'reporter_membership_id_snapshot', 'reporter_name_snapshot',
        'laboratory_id', 'laboratory_id_snapshot', 'laboratory_code_snapshot', 'laboratory_name_snapshot',
        'device_id', 'device_id_snapshot', 'device_code_snapshot', 'device_type_snapshot',
        'category', 'priority', 'title', 'description', 'impact', 'blocks_laboratory_operation',
        'steps_taken', 'occurred_at', 'status', 'triage_summary', 'resolution_summary',
        'rejection_reason', 'verification_note', 'assignee_membership_id',
        'assignee_user_id_snapshot', 'assignee_name_snapshot', 'reported_at', 'triaged_at',
        'assigned_at', 'started_at', 'resolved_at', 'verified_at', 'closed_at', 'rejected_at', 'version',
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Incidents cannot be deleted in v1.'));
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function reporterUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporter_user_id');
    }

    public function reporterMembership(): BelongsTo
    {
        return $this->belongsTo(SchoolMembership::class, 'reporter_membership_id');
    }

    public function laboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function assigneeMembership(): BelongsTo
    {
        return $this->belongsTo(SchoolMembership::class, 'assignee_membership_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(IncidentEvent::class);
    }

    public function submission(): HasOne
    {
        return $this->hasOne(IncidentSubmission::class);
    }

    protected function casts(): array
    {
        return [
            'ticket_year' => 'integer',
            'ticket_sequence' => 'integer',
            'category' => IncidentCategory::class,
            'priority' => IncidentPriority::class,
            'blocks_laboratory_operation' => 'boolean',
            'status' => IncidentStatus::class,
            'occurred_at' => 'immutable_datetime',
            'reported_at' => 'immutable_datetime',
            'triaged_at' => 'immutable_datetime',
            'assigned_at' => 'immutable_datetime',
            'started_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
            'rejected_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
