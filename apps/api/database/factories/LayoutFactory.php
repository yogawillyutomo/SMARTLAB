<?php

namespace Database\Factories;

use App\Models\Laboratory;
use App\Models\Layout;
use App\Models\School;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Layout> */
class LayoutFactory extends Factory
{
    protected $model = Layout::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'laboratory_id' => fn (array $attributes) => Laboratory::factory()->create([
                'school_id' => $attributes['school_id'],
            ])->id,
            'name' => 'Tata Letak '.fake()->unique()->word(),
            'template_key' => null,
            'rows' => 8,
            'columns' => 8,
            'status' => 'draft',
            'version' => 1,
            'activated_at' => null,
            'archived_at' => null,
        ];
    }

    public function active(): static
    {
        return $this->state(fn () => [
            'status' => 'active',
            'activated_at' => now(),
            'archived_at' => null,
        ]);
    }

    public function archived(): static
    {
        return $this->state(fn () => [
            'status' => 'archived',
            'activated_at' => now()->subDay(),
            'archived_at' => now(),
        ]);
    }
}
