<?php

namespace Database\Seeders;

use App\Domain\Identity\IdentityCatalog;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public const ROLES = IdentityCatalog::ROLES;

    public function run(): void
    {
        foreach (self::ROLES as $key => $name) {
            Role::query()->updateOrCreate(['key' => $key], ['name' => $name]);
        }
    }
}
