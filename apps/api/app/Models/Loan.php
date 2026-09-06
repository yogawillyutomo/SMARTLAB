<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Loan extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id',
        'loan_number',
        'borrower_reference',
        'borrower_name_snapshot',
        'borrower_unit_snapshot',
        'purpose',
        'requested_return_at',
        'status',
        'terminal_reason',
        'requested_by_user_id',
        'requested_by_membership_id',
        'requested_by_user_id_snapshot',
        'requested_by_membership_id_snapshot',
        'requested_by_name_snapshot',
        'approved_at',
        'approved_by_user_id',
        'approved_by_membership_id',
        'approved_by_user_id_snapshot',
        'approved_by_membership_id_snapshot',
        'approved_by_name_snapshot',
        'handed_over_at',
        'handed_over_by_user_id',
        'handed_over_by_membership_id',
        'handed_over_by_user_id_snapshot',
        'handed_over_by_membership_id_snapshot',
        'handed_over_by_name_snapshot',
        'returned_at',
        'returned_by_user_id',
        'returned_by_membership_id',
        'returned_by_user_id_snapshot',
        'returned_by_membership_id_snapshot',
        'returned_by_name_snapshot',
        'inspected_at',
        'inspected_by_user_id',
        'inspected_by_membership_id',
        'inspected_by_user_id_snapshot',
        'inspected_by_membership_id_snapshot',
        'inspected_by_name_snapshot',
        'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(LoanItem::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(LoanEvent::class);
    }

    protected function casts(): array
    {
        return [
            'requested_return_at' => 'immutable_datetime',
            'approved_at' => 'immutable_datetime',
            'handed_over_at' => 'immutable_datetime',
            'returned_at' => 'immutable_datetime',
            'inspected_at' => 'immutable_datetime',
            'version' => 'integer',
        ];
    }
}
