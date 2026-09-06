<?php

namespace Database\Factories;

use App\Models\Asset;
use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Asset> */
class AssetFactory extends Factory
{
    protected $model = Asset::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'asset_code' => 'AST-'.fake()->unique()->numerify('######'),
            'name' => fake()->words(3, true),
            'category' => 'Komputer',
            'brand' => null,
            'model' => null,
            'serial_number' => null,
            'home_laboratory_id' => null,
            'condition' => 'unknown',
            'lifecycle_status' => 'active',
            'acquisition_date' => null,
            'acquisition_year' => null,
            'funding_source' => null,
            'purchase_price' => null,
            'supplier_name' => null,
            'warranty_until' => null,
            'notes' => null,
            'linked_device_id' => null,
            'version' => 1,
        ];
    }
}
