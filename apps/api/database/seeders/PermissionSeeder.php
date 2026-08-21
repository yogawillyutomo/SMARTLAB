<?php

namespace Database\Seeders;

use App\Models\Permission;
use Illuminate\Database\Seeder;

class PermissionSeeder extends Seeder
{
    public const CATALOG = [
        'laboratories' => [
            'view' => 'Lihat Laboratorium',
            'create' => 'Buat Laboratorium',
            'update' => 'Ubah Laboratorium',
            'export' => 'Ekspor Laboratorium',
            'manage' => 'Kelola Laboratorium',
        ],
        'assets' => [
            'view' => 'Lihat Aset',
            'create' => 'Buat Aset',
            'update' => 'Ubah Aset',
            'delete' => 'Hapus Aset',
            'export' => 'Ekspor Aset',
        ],
        'devices' => [
            'view' => 'Lihat Perangkat',
            'create' => 'Buat Perangkat',
            'update' => 'Ubah Perangkat',
            'export' => 'Ekspor Perangkat',
            'manage' => 'Kelola Perangkat',
        ],
        'layouts' => [
            'view' => 'Lihat Tata Letak',
            'create' => 'Buat Tata Letak',
            'update' => 'Ubah Tata Letak',
            'delete' => 'Hapus Tata Letak',
            'manage' => 'Kelola Tata Letak',
        ],
        'incidents' => [
            'view' => 'Lihat Insiden',
            'create' => 'Buat Insiden',
            'update' => 'Ubah Insiden',
            'approve' => 'Setujui Insiden',
            'assign' => 'Tugaskan Insiden',
            'export' => 'Ekspor Insiden',
        ],
        'work-orders' => [
            'view' => 'Lihat Perintah Kerja',
            'create' => 'Buat Perintah Kerja',
            'update' => 'Ubah Perintah Kerja',
            'approve' => 'Setujui Perintah Kerja',
            'assign' => 'Tugaskan Perintah Kerja',
            'export' => 'Ekspor Perintah Kerja',
        ],
        'audit-logs' => [
            'view' => 'Lihat Log Audit',
            'export' => 'Ekspor Log Audit',
        ],
    ];

    public function run(): void
    {
        foreach (self::CATALOG as $module => $actions) {
            foreach ($actions as $action => $name) {
                Permission::query()->updateOrCreate(
                    ['key' => $module.'.'.$action],
                    ['name' => $name],
                );
            }
        }

        Permission::query()->whereNotIn('key', self::keys())->delete();
    }

    /**
     * @return list<string>
     */
    public static function keys(): array
    {
        $keys = [];

        foreach (self::CATALOG as $module => $actions) {
            foreach (array_keys($actions) as $action) {
                $keys[] = $module.'.'.$action;
            }
        }

        return $keys;
    }
}
