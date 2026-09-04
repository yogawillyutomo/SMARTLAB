<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class OperationalCalendarEvent extends Model
{
    use HasUlids;

    protected $fillable = [
        'school_id','scope','laboratory_id','category','availability_effect','title','description',
        'starts_on','ends_on','all_day','starts_at','ends_at','status','version','cancelled_at',
    ];

    public function laboratory(): BelongsTo { return $this->belongsTo(Laboratory::class); }
    public function events(): HasMany { return $this->hasMany(OperationalCalendarEventEvent::class, 'calendar_event_id'); }

    protected function casts(): array
    {
        return [
            'starts_on' => 'date:Y-m-d',
            'ends_on' => 'date:Y-m-d',
            'all_day' => 'boolean',
            'version' => 'integer',
            'cancelled_at' => 'immutable_datetime',
        ];
    }
}
