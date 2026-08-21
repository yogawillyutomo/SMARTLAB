<?php

namespace Database\Factories;

use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<School>
 */
class SchoolFactory extends Factory
{
    protected $model = School::class;

    public function definition(): array
    {
        return [
            'code' => fake()->unique()->bothify('SCH-####'),
            'name' => fake()->company().' School',
            'timezone' => 'Asia/Jakarta',
            'status' => 'active',
        ];
    }
}
