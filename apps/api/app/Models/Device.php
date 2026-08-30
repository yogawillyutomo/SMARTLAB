<?php

namespace App\Models;

use Database\Factories\DeviceFactory;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Device extends Model
{
    /** @use HasFactory<DeviceFactory> */
    use HasFactory, HasUlids;

    protected $fillable = [
        'school_id', 'device_code', 'qr_public_id', 'device_type', 'lifecycle_status',
        'home_laboratory_id', 'serial_number', 'hostname', 'brand', 'model',
        'technical_profile_version', 'technical_profile', 'version',
    ];

    public function school(): BelongsTo
    {
        return $this->belongsTo(School::class);
    }

    public function homeLaboratory(): BelongsTo
    {
        return $this->belongsTo(Laboratory::class, 'home_laboratory_id');
    }

    public function changeEvents(): HasMany
    {
        return $this->hasMany(DeviceChangeEvent::class);
    }

    public function transfers(): HasMany
    {
        return $this->hasMany(DeviceTransfer::class);
    }

    public function layoutPlacements(): HasMany
    {
        return $this->hasMany(LayoutDevicePlacement::class);
    }

    public function incidents(): HasMany
    {
        return $this->hasMany(Incident::class);
    }

    protected function technicalProfile(): Attribute
    {
        return Attribute::make(
            get: fn (mixed $value): array => json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR),
            set: fn (mixed $value): string => json_encode($value === [] ? (object) [] : $value, JSON_THROW_ON_ERROR),
        );
    }

    protected function casts(): array
    {
        return [
            'technical_profile_version' => 'integer',
            'version' => 'integer',
        ];
    }
}
