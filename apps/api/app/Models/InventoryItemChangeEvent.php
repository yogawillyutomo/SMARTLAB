<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryItemChangeEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id',
        'inventory_item_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'changed_fields',
        'changes',
        'created_at',
    ];

    public function item(): BelongsTo
    {
        return $this->belongsTo(InventoryItem::class, 'inventory_item_id');
    }

    protected function casts(): array
    {
        return [
            'changed_fields' => 'array',
            'changes' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
