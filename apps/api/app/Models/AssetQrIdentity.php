<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AssetQrIdentity extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id', 'asset_id', 'public_id', 'token_version', 'status',
        'issued_by_user_id', 'issued_by_membership_id',
        'issued_by_user_id_snapshot', 'issued_by_membership_id_snapshot', 'issued_by_name_snapshot', 'issued_at',
        'revoked_by_user_id', 'revoked_by_membership_id',
        'revoked_by_user_id_snapshot', 'revoked_by_membership_id_snapshot', 'revoked_by_name_snapshot',
        'revoked_reason', 'revoked_at',
    ];

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function labelBatchItems(): HasMany
    {
        return $this->hasMany(AssetQrLabelBatchItem::class, 'asset_qr_identity_id');
    }

    protected function casts(): array
    {
        return [
            'token_version' => 'integer',
            'issued_at' => 'immutable_datetime',
            'revoked_at' => 'immutable_datetime',
        ];
    }
}
