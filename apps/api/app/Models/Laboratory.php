<?php

namespace App\Models;

use Database\Factories\LaboratoryFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Laboratory extends Model
{
    /** @use HasFactory<LaboratoryFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id',
        'code',
        'name',
        'location',
        'capacity',
        'status',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function homeDevices(): HasMany
    {
        return $this->hasMany(Device::class, 'home_laboratory_id');
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'capacity' => 'integer',
        ];
    }
}
