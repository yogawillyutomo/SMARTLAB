<?php

namespace Database\Seeders;

use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class UatAdminSeeder extends Seeder
{
    public const EMAIL = 'uat.admin@smartlab.local';

    private const PASSWORD_ENV = 'SMARTLAB_UAT_ADMIN_PASSWORD';

    private const MIN_PASSWORD_LENGTH = 12;

    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new RuntimeException(
                'UatAdminSeeder hanya boleh dijalankan pada environment local/testing.',
            );
        }

        $password = getenv(self::PASSWORD_ENV);

        if (! is_string($password) || mb_strlen($password) < self::MIN_PASSWORD_LENGTH) {
            throw new RuntimeException(
                self::PASSWORD_ENV.' wajib diisi dengan password minimal '.self::MIN_PASSWORD_LENGTH.' karakter.',
            );
        }

        DB::transaction(function () use ($password): void {
            $user = User::query()
                ->where('email', self::EMAIL)
                ->sole();

            if ($user->status !== 'active') {
                throw new RuntimeException('UAT admin user harus berstatus active.');
            }

            $membership = SchoolMembership::query()
                ->where('user_id', $user->id)
                ->where('status', 'active')
                ->sole();

            if (! $membership->roles()->where('key', 'super-admin')->exists()) {
                throw new RuntimeException(
                    'UAT admin membership harus sudah memiliki role SMARTLAB local super-admin.',
                );
            }

            $user->forceFill([
                'password' => $password,
            ])->save();
        });

        $this->command?->info('UAT admin password updated for '.self::EMAIL.'.');
    }
}
