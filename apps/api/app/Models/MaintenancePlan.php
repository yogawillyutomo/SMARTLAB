<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenancePlan extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'plan_code',
        'asset_id',
        'asset_code_snapshot',
        'asset_name_snapshot',
        'name',
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

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function executions(): HasMany
    {
        return $this->hasMany(MaintenanceExecution::class);
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
