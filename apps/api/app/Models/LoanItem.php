<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoanItem extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'loan_id',
        'asset_id',
        'asset_code_snapshot',
        'asset_name_snapshot',
        'condition_out',
        'condition_return',
        'return_notes',
        'custody_active',
    ];

    public function loan(): BelongsTo
    {
        return $this->belongsTo(Loan::class);
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    protected function casts(): array
    {
        return [
            'custody_active' => 'boolean',
        ];
    }
}
