<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    public const ROLES = [
        'super-admin' => 'Super Admin',
        'admin-lab' => 'Admin Lab',
        'kepala-lab' => 'Kepala Lab',
        'teknisi' => 'Teknisi',
        'guru' => 'Guru',
        'ketua-kelas' => 'Ketua Kelas',
        'siswa' => 'Siswa',
        'pimpinan' => 'Pimpinan',
    ];

    public function run(): void
    {
        foreach (self::ROLES as $key => $name) {
            Role::query()->updateOrCreate(['key' => $key], ['name' => $name]);
        }
    }
}
