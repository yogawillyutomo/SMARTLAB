<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class IncidentTicketSequence extends Model
{
    protected $table = 'incident_number_sequences';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['school_id', 'ticket_year', 'last_value'];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    protected function casts(): array
    {
        return [
            'ticket_year' => 'integer',
            'last_value' => 'integer',
        ];
    }
}
