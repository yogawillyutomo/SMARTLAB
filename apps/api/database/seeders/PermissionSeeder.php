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
        'device-transfers' => [
            'create' => 'Pindahkan Perangkat Antar Laboratorium',
            'view' => 'Lihat Riwayat Pemindahan Perangkat',
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
            'view-all' => 'Lihat Semua Insiden',
            'view-history' => 'Lihat Riwayat Insiden',
            'create' => 'Buat Insiden',
            'update' => 'Ubah Insiden',
            'approve' => 'Setujui Insiden',
            'assign' => 'Tugaskan Insiden',
            'comment' => 'Komentari Insiden',
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
        'users' => [
            'view' => 'Lihat Pengguna Sekolah',
            'create' => 'Buat Pengguna Sekolah',
            'update' => 'Ubah Pengguna Sekolah',
        ],
        'roles' => [
            'view' => 'Lihat Hak Akses',
        ],
        'master-data' => [
            'view' => 'Lihat Master Data',
            'create' => 'Buat Master Data',
            'update' => 'Ubah Master Data',
        ],
        'schedules' => [
            'view' => 'Lihat Jadwal',
            'ingest' => 'Terima Publikasi Jadwal',
            'activate' => 'Aktifkan Publikasi Jadwal',
        ],
        'schedule-exceptions' => [
            'view' => 'Lihat Pengecualian Jadwal',
            'create' => 'Terapkan Pengecualian Jadwal',
            'cancel' => 'Batalkan Pengecualian Jadwal',
        ],
        'calendar' => [
            'view' => 'Lihat Kalender Operasional',
            'create' => 'Buat Event Kalender',
            'update' => 'Ubah Event Kalender',
            'cancel' => 'Batalkan Event Kalender',
            'export' => 'Ekspor Kalender',
        ],
        'availability' => [
            'view' => 'Lihat Ketersediaan Laboratorium',
        ],
        'priority-events' => [
            'view' => 'Lihat Kegiatan Prioritas',
            'view-all' => 'Lihat Semua Kegiatan Prioritas',
            'create' => 'Ajukan Kegiatan Prioritas',
            'approve' => 'Putuskan Kegiatan Prioritas',
            'cancel' => 'Batalkan Kegiatan Prioritas',
            'export' => 'Ekspor Kegiatan Prioritas',
        ],
        'bookings' => [
            'view' => 'Lihat Reservasi Laboratorium',
            'view-all' => 'Lihat Semua Reservasi Laboratorium',
            'create' => 'Ajukan Reservasi Laboratorium',
            'approve' => 'Putuskan Reservasi Laboratorium',
            'cancel' => 'Batalkan Reservasi Laboratorium',
            'export' => 'Ekspor Reservasi Laboratorium',
        ],
        'sessions' => [
            'view' => 'Lihat Pelaksanaan Laboratorium',
            'view-all' => 'Lihat Semua Pelaksanaan Laboratorium',
            'prepare' => 'Persiapkan Pelaksanaan Laboratorium',
            'start' => 'Mulai Pelaksanaan Laboratorium',
            'end' => 'Akhiri Pelaksanaan Laboratorium',
            'cancel' => 'Batalkan Pelaksanaan Laboratorium',
            'export' => 'Ekspor Pelaksanaan Laboratorium',
        ],
        'activity-reports' => [
            'view' => 'Lihat Laporan Pelaksanaan',
            'view-all' => 'Lihat Semua Laporan Pelaksanaan',
            'edit' => 'Ubah Draft Laporan Pelaksanaan',
            'submit' => 'Ajukan Laporan Pelaksanaan',
            'verify' => 'Verifikasi Laporan Pelaksanaan',
            'request-revision' => 'Minta Perbaikan Laporan Pelaksanaan',
            'create-backfill' => 'Buat Backfill Laporan Pelaksanaan',
            'export' => 'Ekspor Laporan Pelaksanaan',
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

    /** @return list<string> */
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
