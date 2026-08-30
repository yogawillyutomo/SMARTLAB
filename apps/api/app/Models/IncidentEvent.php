<?php

namespace App\Models;

use App\Domain\Incident\IncidentEventType;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class IncidentEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id', 'incident_id', 'incident_id_snapshot', 'ticket_number_snapshot',
        'actor_user_id', 'actor_membership_id', 'actor_user_id_snapshot',
        'actor_membership_id_snapshot', 'actor_name_snapshot', 'event_type',
        'incident_version_before', 'incident_version_after', 'payload', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Incident events are immutable.'));
        static::deleting(fn () => throw new LogicException('Incident events are immutable.'));
    }

    public function incident(): BelongsTo
    {
        return $this->belongsTo(Incident::class);
    }

    public function actorUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }

    public function actorMembership(): BelongsTo
    {
        return $this->belongsTo(SchoolMembership::class, 'actor_membership_id');
    }

    protected function casts(): array
    {
        return [
            'event_type' => IncidentEventType::class,
            'incident_version_before' => 'integer',
            'incident_version_after' => 'integer',
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
