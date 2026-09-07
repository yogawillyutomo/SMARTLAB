<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenanceCampaign extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'campaign_code',
        'laboratory_id',
        'laboratory_code_snapshot',
        'laboratory_name_snapshot',
        'name',
        'description',
        'frequency_kind',
        'interval_days',
        'checklist_template',
        'assigned_technician_reference',
        'assigned_technician_name_snapshot',
        'next_due_date',
        'status',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function laboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(MaintenanceCampaignItem::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(MaintenanceCampaignEvent::class);
    }

    protected function casts(): array
    {
        return [
            'interval_days' => 'integer',
            'checklist_template' => 'array',
            'next_due_date' => 'date',
            'version' => 'integer',
        ];
    }
}
