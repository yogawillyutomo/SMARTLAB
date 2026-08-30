<?php

namespace Tests\Feature;

use App\Models\Permission;
use App\Models\Role;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\PermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class IncidentPermissionFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_incident_permission_catalog_contains_exactly_the_locked_keys_and_no_delete(): void
    {
        $this->seed(DatabaseSeeder::class);

        $this->assertSame([
            'incidents.approve',
            'incidents.assign',
            'incidents.comment',
            'incidents.create',
            'incidents.export',
            'incidents.update',
            'incidents.view',
            'incidents.view-all',
            'incidents.view-history',
        ], Permission::query()->where('key', 'like', 'incidents.%')->orderBy('key')->pluck('key')->all());
        $this->assertFalse(Permission::query()->where('key', 'incidents.delete')->exists());
    }

    public function test_incident_role_grants_exactly_match_the_locked_matrix(): void
    {
        $this->seed(DatabaseSeeder::class);

        $expected = [
            'admin-lab' => ['assign', 'comment', 'create', 'export', 'update', 'view', 'view-all', 'view-history'],
            'kepala-lab' => ['approve', 'comment', 'export', 'view', 'view-all', 'view-history'],
            'teknisi' => ['comment', 'update', 'view', 'view-all', 'view-history'],
            'guru' => ['comment', 'create', 'view'],
            'ketua-kelas' => ['comment', 'create', 'view'],
            'siswa' => ['comment', 'create', 'view'],
            'pimpinan' => ['export', 'view', 'view-all', 'view-history'],
            'super-admin' => ['approve', 'assign', 'comment', 'create', 'export', 'update', 'view', 'view-all', 'view-history'],
        ];

        foreach ($expected as $roleKey => $actions) {
            $actual = Role::query()->where('key', $roleKey)->firstOrFail()->permissions()
                ->where('key', 'like', 'incidents.%')
                ->pluck('key')
                ->map(fn (string $key): string => str($key)->after('incidents.')->toString())
                ->sort()
                ->values()
                ->all();
            $this->assertSame($actions, $actual, "Unexpected Incident grants for {$roleKey}.");
        }

        $superAdmin = Role::query()->where('key', 'super-admin')->firstOrFail();
        $this->assertSame(count(PermissionSeeder::keys()), $superAdmin->permissions()->count());
    }
}
