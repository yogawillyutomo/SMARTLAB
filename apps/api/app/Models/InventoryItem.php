<?php

namespace App\Models;

use Database\Factories\InventoryItemFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class InventoryItem extends Model
{
    /** @use HasFactory<InventoryItemFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id',
        'item_code',
        'name',
        'category',
        'unit',
        'minimum_stock',
        'storage_location',
        'supplier_name',
        'unit_price_snapshot',
        'on_hand_quantity',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(InventoryTransaction::class);
    }

    public function changeEvents(): HasMany
    {
        return $this->hasMany(InventoryItemChangeEvent::class);
    }

    protected function casts(): array
    {
        return [
            'minimum_stock' => 'decimal:3',
            'unit_price_snapshot' => 'decimal:2',
            'on_hand_quantity' => 'decimal:3',
            'version' => 'integer',
        ];
    }
}
