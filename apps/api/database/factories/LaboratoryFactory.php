<?php

namespace Database\Factories;

use App\Models\Laboratory;
use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Laboratory>
 */
class LaboratoryFactory extends Factory
{
    protected $model = Laboratory::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'code' => fake()->unique()->bothify('LAB-###'),
            'name' => 'Laboratorium '.fake()->unique()->word(),
            'location' => fake()->streetName(),
            'capacity' => fake()->numberBetween(10, 48),
            'status' => 'active',
        ];
    }
}
