<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AssetQrLabelBatch extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id', 'laboratory_id', 'laboratory_code_snapshot', 'laboratory_name_snapshot',
        'template_key', 'filters', 'asset_count',
        'generated_by_user_id', 'generated_by_membership_id',
        'generated_by_user_id_snapshot', 'generated_by_membership_id_snapshot', 'generated_by_name_snapshot',
        'generated_at',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(AssetQrLabelBatchItem::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(AssetQrLabelBatchEvent::class);
    }

    public function laboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class);
    }

    protected function casts(): array
    {
        return [
            'filters' => 'array',
            'asset_count' => 'integer',
            'generated_at' => 'immutable_datetime',
        ];
    }
}
