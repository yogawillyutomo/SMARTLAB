<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LayoutStructuralElement extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id', 'layout_id', 'element_type', 'label', 'row', 'column',
        'row_span', 'column_span', 'rotation',
    ];

    public function layout(): BelongsTo
    {
        return $this->belongsTo(Layout::class);
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
