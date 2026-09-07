<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class WorkOrder extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'work_order_number', 'incident_id', 'incident_ticket_snapshot',
        'asset_id', 'asset_code_snapshot', 'asset_name_snapshot',
        'laboratory_id', 'laboratory_code_snapshot', 'laboratory_name_snapshot',
        'problem_summary', 'priority', 'scheduled_for', 'notes', 'status',
        'assignee_membership_id', 'assignee_user_id_snapshot', 'assignee_membership_id_snapshot',
        'assignee_name_snapshot', 'diagnosis', 'action_taken', 'test_result',
        'condition_before', 'condition_after', 'asset_version_at_start', 'custody_active',
        'started_at', 'completed_at', 'verified_at', 'cancelled_at', 'cancel_reason', 'version',
    ];

    public function school(): BelongsTo { return $this->belongsTo(School::class); }
    public function incident(): BelongsTo { return $this->belongsTo(Incident::class); }
    public function asset(): BelongsTo { return $this->belongsTo(Asset::class); }
    public function laboratory(): BelongsTo { return $this->belongsTo(Laboratory::class); }
    public function assigneeMembership(): BelongsTo { return $this->belongsTo(SchoolMembership::class, 'assignee_membership_id'); }
    public function events(): HasMany { return $this->hasMany(WorkOrderEvent::class); }
    public function partUsages(): HasMany { return $this->hasMany(WorkOrderPartUsage::class); }

    protected function casts(): array
    {
        return [
            'scheduled_for' => 'immutable_date',
            'custody_active' => 'boolean',
            'asset_version_at_start' => 'integer',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
