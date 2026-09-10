<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MaintenanceCampaignEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id',
        'maintenance_campaign_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'before_status',
        'after_status',
        'payload',
        'created_at',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(MaintenanceCampaign::class, 'maintenance_campaign_id');
    }

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
