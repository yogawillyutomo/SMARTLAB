<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class ActivityReportAttachment extends Model
{
    use HasUlids;

    public $timestamps = false;

    protected $fillable = [
        'school_id',
        'report_id',
        'storage_provider',
        'storage_key',
        'file_name',
        'media_type',
        'size_bytes',
        'sha256',
        'uploaded_by_user_id',
        'uploaded_by_membership_id',
        'uploaded_by_name_snapshot',
        'created_at',
    ];

    protected static function booted(): void
    {
        static::deleting(fn () => throw new LogicException('Activity Report attachments cannot be deleted in S3.5.'));
    }

    public function report(): BelongsTo { return $this->belongsTo(ActivityReport::class, 'report_id'); }

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
