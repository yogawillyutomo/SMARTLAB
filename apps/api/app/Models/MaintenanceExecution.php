<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class MaintenanceExecution extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'execution_number',
        'maintenance_plan_id',
        'plan_code_snapshot',
        'asset_id',
        'asset_code_snapshot',
        'asset_name_snapshot',
        'scheduled_for',
        'status',
        'checklist_snapshot',
        'checklist_results',
        'findings',
        'action_taken',
        'condition_before',
        'condition_after',
        'technician_reference',
        'technician_name_snapshot',
        'asset_version_at_start',
        'custody_active',
        'started_at',
        'completed_at',
        'cancelled_at',
        'cancel_reason',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(MaintenancePlan::class, 'maintenance_plan_id');
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function inventoryTransactions(): HasMany
    {
        return $this->hasMany(InventoryTransaction::class, 'source_id')
            ->where('source_type', 'maintenance_execution');
    }

    protected function casts(): array
    {
        return [
            'scheduled_for' => 'date',
            'checklist_snapshot' => 'array',
            'checklist_results' => 'array',
            'asset_version_at_start' => 'integer',
            'custody_active' => 'boolean',
            'started_at' => 'immutable_datetime',
            'completed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
