<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PriorityEvent extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'event_number',
        'laboratory_id',
        'requester_user_id',
        'requester_membership_id',
        'requester_name_snapshot',
        'requester_email_snapshot',
        'event_date',
        'starts_at',
        'ends_at',
        'category',
        'title',
        'participants',
        'description',
        'pic_name',
        'status',
        'rejection_reason',
        'decided_at',
        'cancelled_at',
        'version',
    ];

    public function laboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(PriorityEventEvent::class, 'priority_event_id');
    }

    protected function casts(): array
    {
        return [
            'event_date' => 'date:Y-m-d',
            'participants' => 'integer',
            'version' => 'integer',
            'decided_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
        ];
    }
}
