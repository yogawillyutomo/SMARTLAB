<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MaintenanceCampaignItem extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'maintenance_campaign_id',
        'asset_id',
        'asset_code_snapshot',
        'asset_name_snapshot',
        'maintenance_plan_id',
        'plan_code_snapshot',
        'created_at',
    ];

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(MaintenanceCampaign::class, 'maintenance_campaign_id');
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(MaintenancePlan::class, 'maintenance_plan_id');
    }

    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime'];
    }
}
