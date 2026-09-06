<?php

namespace App\Models;

use Database\Factories\AssetFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Asset extends Model
{
    /** @use HasFactory<AssetFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id', 'asset_code', 'name', 'category', 'brand', 'model', 'serial_number',
        'home_laboratory_id', 'condition', 'lifecycle_status', 'acquisition_date',
        'acquisition_year', 'funding_source', 'purchase_price', 'supplier_name',
        'warranty_until', 'notes', 'linked_device_id', 'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function homeLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'home_laboratory_id');
    }

    public function linkedDevice(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'linked_device_id');
    }

    public function changeEvents(): HasMany
    {
        return $this->hasMany(AssetChangeEvent::class);
    }

    protected function casts(): array
    {
        return [
            'acquisition_date' => 'date',
            'acquisition_year' => 'integer',
            'purchase_price' => 'decimal:2',
            'warranty_until' => 'date',
            'version' => 'integer',
        ];
    }
}
