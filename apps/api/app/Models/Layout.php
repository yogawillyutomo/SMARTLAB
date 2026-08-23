<?php

namespace App\Models;

use Database\Factories\LayoutFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Layout extends Model
{
    /** @use HasFactory<LayoutFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id', 'laboratory_id', 'name', 'template_key', 'rows', 'columns',
        'status', 'version', 'activated_at', 'archived_at',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function laboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class);
    }

    public function structuralElements(): HasMany
    {
        return $this->hasMany(LayoutStructuralElement::class);
    }

    public function devicePlacements(): HasMany
    {
        return $this->hasMany(LayoutDevicePlacement::class);
    }

    public function changeEvents(): HasMany
    {
        return $this->hasMany(LayoutChangeEvent::class);
    }

    protected function casts(): array
    {
        return [
            'rows' => 'integer',
            'columns' => 'integer',
            'version' => 'integer',
            'activated_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }
}
