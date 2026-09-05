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
            'device-transfers.create', 'device-transfers.view',
            'layouts.view', 'layouts.create', 'layouts.update', 'layouts.delete',
            'incidents.view', 'incidents.create', 'incidents.update', 'incidents.assign', 'incidents.export',
            'incidents.view-all', 'incidents.view-history', 'incidents.comment',
            'work-orders.view', 'work-orders.create', 'work-orders.update', 'work-orders.assign', 'work-orders.export',
            'users.view', 'users.create', 'users.update', 'roles.view',
            'master-data.view', 'master-data.create', 'master-data.update',
            'schedules.view', 'schedules.ingest', 'schedules.activate',
            'schedule-exceptions.view', 'schedule-exceptions.create', 'schedule-exceptions.cancel',
            'calendar.view', 'calendar.create', 'calendar.update', 'calendar.cancel', 'calendar.export',
            'availability.view',
            'priority-events.view', 'priority-events.view-all', 'priority-events.create', 'priority-events.approve', 'priority-events.cancel', 'priority-events.export',
            'bookings.view', 'bookings.view-all', 'bookings.create', 'bookings.approve', 'bookings.cancel', 'bookings.export',
            'sessions.view', 'sessions.view-all', 'sessions.prepare', 'sessions.start', 'sessions.end', 'sessions.cancel', 'sessions.export',
            'session-observations.view', 'session-observations.view-all', 'session-observations.create', 'session-observations.promote',
            'activity-reports.view', 'activity-reports.view-all', 'activity-reports.edit', 'activity-reports.submit', 'activity-reports.verify', 'activity-reports.request-revision', 'activity-reports.create-backfill', 'activity-reports.export',
            'audit-logs.view', 'audit-logs.export',
        ],
        'kepala-lab' => [
            'laboratories.view', 'laboratories.update', 'laboratories.export',
            'assets.view', 'assets.export',
            'devices.view', 'devices.export',
            'device-transfers.view',
            'layouts.view',
            'incidents.view', 'incidents.approve', 'incidents.export',
            'incidents.view-all', 'incidents.view-history', 'incidents.comment',
            'work-orders.view', 'work-orders.approve', 'work-orders.export',
            'users.view', 'roles.view',
            'master-data.view',
            'schedules.view',
            'schedule-exceptions.view', 'schedule-exceptions.create', 'schedule-exceptions.cancel',
            'calendar.view', 'calendar.create', 'calendar.update', 'calendar.cancel', 'calendar.export',
            'availability.view',
            'priority-events.view', 'priority-events.view-all', 'priority-events.create', 'priority-events.approve', 'priority-events.cancel', 'priority-events.export',
            'bookings.view', 'bookings.view-all', 'bookings.approve', 'bookings.cancel', 'bookings.export',
            'sessions.view', 'sessions.view-all', 'sessions.prepare', 'sessions.start', 'sessions.end', 'sessions.cancel', 'sessions.export',
            'session-observations.view', 'session-observations.view-all', 'session-observations.create',
            'activity-reports.view', 'activity-reports.view-all', 'activity-reports.edit', 'activity-reports.submit', 'activity-reports.verify', 'activity-reports.request-revision', 'activity-reports.export',
            'audit-logs.view', 'audit-logs.export',
        ],
        'teknisi' => [
            'laboratories.view',
            'assets.view', 'assets.update',
            'devices.view', 'devices.update', 'devices.manage',
            'device-transfers.view',
            'layouts.view', 'layouts.update',
            'incidents.view', 'incidents.update', 'incidents.view-all', 'incidents.view-history', 'incidents.comment',
            'work-orders.view', 'work-orders.update',
            'schedules.view',
            'schedule-exceptions.view',
            'calendar.view', 'availability.view',
            'priority-events.view', 'priority-events.view-all',
            'sessions.view', 'sessions.view-all',
            'session-observations.view', 'session-observations.view-all',
            'activity-reports.view', 'activity-reports.view-all',
        ],
        'guru' => [
            'laboratories.view', 'assets.view', 'devices.view',
            'incidents.view', 'incidents.create', 'incidents.comment',
            'schedules.view',
            'calendar.view', 'availability.view',
            'priority-events.view', 'priority-events.create', 'priority-events.cancel',
            'bookings.view', 'bookings.create', 'bookings.cancel',
            'sessions.view', 'sessions.prepare', 'sessions.start', 'sessions.end', 'sessions.cancel',
            'session-observations.view', 'session-observations.create', 'session-observations.promote',
            'activity-reports.view', 'activity-reports.edit', 'activity-reports.submit',
        ],
        'ketua-kelas' => [
            'incidents.view', 'incidents.create', 'incidents.comment',
            'calendar.view',
        ],
        'siswa' => [
            'incidents.view', 'incidents.create', 'incidents.comment',
            'calendar.view',
        ],
        'pimpinan' => [
            'laboratories.view', 'laboratories.export',
            'assets.view', 'assets.export',
            'devices.view', 'devices.export',
            'device-transfers.view',
            'layouts.view',
            'incidents.view', 'incidents.export', 'incidents.view-all', 'incidents.view-history',
            'work-orders.view', 'work-orders.export',
            'users.view', 'roles.view',
            'schedules.view',
            'schedule-exceptions.view',
            'calendar.view', 'calendar.export',
            'availability.view',
            'priority-events.view', 'priority-events.view-all', 'priority-events.export',
            'bookings.view', 'bookings.view-all', 'bookings.export',
            'sessions.view', 'sessions.view-all', 'sessions.export',
            'session-observations.view', 'session-observations.view-all',
            'activity-reports.view', 'activity-reports.view-all', 'activity-reports.export',
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
