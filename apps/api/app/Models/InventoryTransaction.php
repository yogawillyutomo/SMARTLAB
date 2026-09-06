<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryTransaction extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'inventory_item_id',
        'client_mutation_id',
        'kind',
        'quantity',
        'signed_delta',
        'balance_before',
        'balance_after',
        'item_version_after',
        'reason',
        'source_type',
        'source_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'item_code_snapshot',
        'item_name_snapshot',
        'unit_snapshot',
        'request_sha256',
        'occurred_at',
        'created_at',
    ];

    public function item(): BelongsTo
    {
        return $this->belongsTo(InventoryItem::class, 'inventory_item_id');
    }

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'signed_delta' => 'decimal:3',
            'balance_before' => 'decimal:3',
            'balance_after' => 'decimal:3',
            'item_version_after' => 'integer',
            'occurred_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
