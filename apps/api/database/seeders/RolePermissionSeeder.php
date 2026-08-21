<?php

namespace Database\Seeders;

use App\Models\Permission;
use App\Models\Role;
use Illuminate\Database\Seeder;

class RolePermissionSeeder extends Seeder
{
    public const ROLE_PERMISSIONS = [
        'admin-lab' => [
            'laboratories.view', 'laboratories.create', 'laboratories.update', 'laboratories.export',
            'assets.view', 'assets.create', 'assets.update', 'assets.delete', 'assets.export',
            'devices.view', 'devices.create', 'devices.update', 'devices.export',
            'layouts.view', 'layouts.create', 'layouts.update', 'layouts.delete',
            'incidents.view', 'incidents.create', 'incidents.update', 'incidents.assign', 'incidents.export',
            'work-orders.view', 'work-orders.create', 'work-orders.update', 'work-orders.assign', 'work-orders.export',
            'audit-logs.view', 'audit-logs.export',
        ],
        'kepala-lab' => [
            'laboratories.view', 'laboratories.update', 'laboratories.export',
            'assets.view', 'assets.export',
            'devices.view', 'devices.export',
            'layouts.view',
            'incidents.view', 'incidents.approve', 'incidents.export',
            'work-orders.view', 'work-orders.approve', 'work-orders.export',
            'audit-logs.view', 'audit-logs.export',
        ],
        'teknisi' => [
            'laboratories.view',
            'assets.view', 'assets.update',
            'devices.view', 'devices.update', 'devices.manage',
            'layouts.view', 'layouts.update',
            'incidents.view', 'incidents.update',
            'work-orders.view', 'work-orders.update',
        ],
        'guru' => [
            'laboratories.view', 'assets.view', 'devices.view',
            'incidents.view', 'incidents.create',
        ],
        'ketua-kelas' => [
            'incidents.view', 'incidents.create',
        ],
        'siswa' => [
            'incidents.view', 'incidents.create',
        ],
        'pimpinan' => [
            'laboratories.view', 'laboratories.export',
            'assets.view', 'assets.export',
            'devices.view', 'devices.export',
            'layouts.view',
            'incidents.view', 'incidents.export',
            'work-orders.view', 'work-orders.export',
            'audit-logs.view', 'audit-logs.export',
        ],
    ];

    public function run(): void
    {
        $permissionIds = Permission::query()->pluck('id', 'key');

        foreach (RoleSeeder::ROLES as $roleKey => $roleName) {
            $keys = $roleKey === 'super-admin'
                ? PermissionSeeder::keys()
                : self::ROLE_PERMISSIONS[$roleKey];

            $ids = array_map(
                fn (string $key): string => $permissionIds->get($key)
                    ?? throw new \LogicException("Undefined permission in {$roleName} baseline: {$key}"),
                $keys,
            );

            Role::query()->where('key', $roleKey)->firstOrFail()->permissions()->sync($ids);
        }
    }
}
