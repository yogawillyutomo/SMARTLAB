<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LayoutChangeEvent extends Model
{
    use HasUlids;

    public const UPDATED_AT = null;

    protected $fillable = [
        'school_id', 'layout_id', 'layout_id_snapshot', 'laboratory_id_snapshot',
        'actor_user_id', 'actor_id_snapshot', 'actor_name_snapshot', 'event_type',
        'changed_fields', 'changes', 'created_at',
    ];

    public function layout(): BelongsTo
    {
        return $this->belongsTo(Layout::class);
    }

    protected function casts(): array
    {
        return [
            'changed_fields' => 'array',
            'changes' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
