<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AssetQrLabelBatchEvent extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id', 'asset_qr_label_batch_id', 'event_type',
        'actor_user_id', 'actor_membership_id',
        'actor_user_id_snapshot', 'actor_membership_id_snapshot', 'actor_name_snapshot',
        'payload', 'created_at',
    ];

    public function batch(): BelongsTo
    {
        return $this->belongsTo(AssetQrLabelBatch::class, 'asset_qr_label_batch_id');
    }

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'created_at' => 'immutable_datetime',
        ];
    }
}
