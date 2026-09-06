<?php

namespace Database\Factories;

use App\Models\InventoryItem;
use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<InventoryItem> */
class InventoryItemFactory extends Factory
{
    protected $model = InventoryItem::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'item_code' => 'STK-'.fake()->unique()->numerify('######'),
            'name' => fake()->words(3, true),
            'category' => 'Spare Part',
            'unit' => 'pcs',
            'minimum_stock' => '0.000',
            'storage_location' => null,
            'supplier_name' => null,
            'unit_price_snapshot' => null,
            'on_hand_quantity' => '0.000',
            'version' => 1,
        ];
    }
}
