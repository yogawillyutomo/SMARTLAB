<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActivityReportDraftSyncMutation extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'report_id',
        'client_mutation_id',
        'base_version',
        'payload_sha256',
        'resulting_version',
        'applied_by_user_id',
        'applied_by_membership_id',
        'applied_at',
    ];

    public function report(): BelongsTo
    {
        return $this->belongsTo(ActivityReport::class, 'report_id');
    }

    protected function casts(): array
    {
        return [
            'base_version' => 'integer',
            'resulting_version' => 'integer',
            'applied_at' => 'immutable_datetime',
        ];
    }
}
