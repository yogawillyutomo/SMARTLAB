<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AssetQrLabelBatchItem extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id', 'asset_qr_label_batch_id', 'asset_id', 'asset_qr_identity_id', 'ordinal',
        'asset_code_snapshot', 'asset_name_snapshot',
        'laboratory_id_snapshot', 'laboratory_code_snapshot', 'laboratory_name_snapshot',
        'public_id_snapshot', 'token_version_snapshot', 'created_at',
    ];

    public function batch(): BelongsTo
    {
        return $this->belongsTo(AssetQrLabelBatch::class, 'asset_qr_label_batch_id');
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function qrIdentity(): BelongsTo
    {
        return $this->belongsTo(AssetQrIdentity::class, 'asset_qr_identity_id');
    }

    protected function casts(): array
    {
        return [
            'ordinal' => 'integer',
            'token_version_snapshot' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
