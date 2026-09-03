<?php

namespace App\Domain\Identity;

final class IdentityCatalog
{
    public const STATUSES = ['active', 'inactive'];

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

    /** @return list<string> */
    public static function roleKeys(): array
    {
        return array_keys(self::ROLES);
    }
}
