<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoanEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id',
        'loan_id',
        'actor_user_id',
        'actor_membership_id',
        'actor_user_id_snapshot',
        'actor_membership_id_snapshot',
        'actor_name_snapshot',
        'event_type',
        'before_status',
        'after_status',
        'payload',
        'created_at',
    ];

    public function loan(): BelongsTo
    {
        return $this->belongsTo(Loan::class);
    }

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
