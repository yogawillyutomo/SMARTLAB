<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Device> */
class DeviceFactory extends Factory
{
    protected $model = Device::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'device_code' => 'DEV-'.fake()->unique()->numerify('######'),
            'qr_public_id' => 'devq_'.rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '='),
            'device_type' => 'desktop_pc',
            'lifecycle_status' => 'in_service',
            'home_laboratory_id' => null,
            'serial_number' => null,
            'hostname' => null,
            'brand' => null,
            'model' => null,
            'technical_profile_version' => 1,
            'technical_profile' => [],
            'version' => 1,
        ];
    }
}
