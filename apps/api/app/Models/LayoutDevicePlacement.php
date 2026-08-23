<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LayoutDevicePlacement extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'layout_id', 'device_id', 'role', 'label', 'row', 'column',
        'row_span', 'column_span', 'rotation',
    ];

    public function layout(): BelongsTo
    {
        return $this->belongsTo(Layout::class);
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    protected function casts(): array
    {
        return [
            'row' => 'integer',
            'column' => 'integer',
            'row_span' => 'integer',
            'column_span' => 'integer',
            'rotation' => 'integer',
        ];
    }
}
