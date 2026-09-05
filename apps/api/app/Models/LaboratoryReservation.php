<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LaboratoryReservation extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'reservation_number',
        'laboratory_id',
        'requester_user_id',
        'requester_membership_id',
        'requester_name_snapshot',
        'requester_email_snapshot',
        'reservation_date',
        'starts_at',
        'ends_at',
        'activity',
        'participants',
        'device_needs',
        'notes',
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

    public function requesterUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_user_id');
    }

    public function requesterMembership(): BelongsTo
    {
        return $this->belongsTo(SchoolMembership::class, 'requester_membership_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(LaboratoryReservationEvent::class, 'reservation_id');
    }

    protected function casts(): array
    {
        return [
            'reservation_date' => 'date:Y-m-d',
            'participants' => 'integer',
            'version' => 'integer',
            'decided_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
        ];
    }
}
