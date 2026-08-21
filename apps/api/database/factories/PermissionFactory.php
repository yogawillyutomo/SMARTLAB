<?php

namespace Database\Factories;

use App\Models\Permission;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Permission>
 */
class PermissionFactory extends Factory
{
    protected $model = Permission::class;

    public function definition(): array
    {
        $module = fake()->unique()->slug(1);

        return [
            'key' => $module.'.view',
            'name' => str($module)->replace('-', ' ')->title()->append(' View')->toString(),
        ];
    }
}
