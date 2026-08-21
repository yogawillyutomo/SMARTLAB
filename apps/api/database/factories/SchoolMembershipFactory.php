<?php

namespace Database\Factories;

use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SchoolMembership>
 */
class SchoolMembershipFactory extends Factory
{
    protected $model = SchoolMembership::class;

    public function definition(): array
    {
        return [
            'school_id' => School::factory(),
            'user_id' => User::factory(),
            'status' => 'active',
        ];
    }
}
