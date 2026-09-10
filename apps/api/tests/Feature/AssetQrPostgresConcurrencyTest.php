<?php

namespace Tests\Feature;

use App\Application\Asset\AssetQrIdentityService;
use App\Application\Identity\CurrentMembershipContext;
use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;
use Throwable;

#[Group('postgres-concurrency')]
class AssetQrPostgresConcurrencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Asset QR contention proof runs only on PostgreSQL.');
        }

        if (! function_exists('pcntl_fork')) {
            $this->fail('pcntl_fork is required for Asset QR contention proof.');
        }
    }

    public function test_concurrent_first_issue_creates_only_one_active_identity(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create(['school_id' => $schoolId]);

        $results = $this->race(
            fn () => app(AssetQrIdentityService::class)->issue(
                $this->context($membershipId),
                User::query()->findOrFail($userId),
                (string) $asset->id,
            ),
            fn () => app(AssetQrIdentityService::class)->issue(
                $this->context($membershipId),
                User::query()->findOrFail($userId),
                (string) $asset->id,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['ASSET_QR_ALREADY_ACTIVE'], $this->failureCodes($results));
        $this->assertSame(1, AssetQrIdentity::query()
            ->where('asset_id', $asset->id)
            ->where('status', 'active')
            ->count());
    }

    public function test_concurrent_rotate_same_token_allows_only_one_replacement(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create(['school_id' => $schoolId]);
        $service = app(AssetQrIdentityService::class);
        $service->issue(
            $this->context($membershipId),
            User::query()->findOrFail($userId),
            (string) $asset->id,
        );

        $results = $this->race(
            fn () => app(AssetQrIdentityService::class)->rotate(
                $this->context($membershipId),
                User::query()->findOrFail($userId),
                (string) $asset->id,
                1,
                'Concurrent rotate A',
            ),
            fn () => app(AssetQrIdentityService::class)->rotate(
                $this->context($membershipId),
                User::query()->findOrFail($userId),
                (string) $asset->id,
                1,
                'Concurrent rotate B',
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['ASSET_QR_VERSION_CONFLICT'], $this->failureCodes($results));
        $this->assertSame(2, AssetQrIdentity::query()->where('asset_id', $asset->id)->count());
        $this->assertSame(1, AssetQrIdentity::query()
            ->where('asset_id', $asset->id)
            ->where('status', 'active')
            ->where('token_version', 2)
            ->count());
    }

    /** @return array{string,string,string} */
    private function actorContext(): array
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        return [(string) $user->id, (string) $membership->id, (string) $school->id];
    }

    private function context(string $membershipId): CurrentMembershipContext
    {
        return new CurrentMembershipContext(
            SchoolMembership::query()->findOrFail($membershipId),
            collect(),
        );
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} */
    private function race(callable $left, callable $right): array
    {
        $token = (string) Str::uuid();
        $barrier = sys_get_temp_dir().'/smartlab-asset-qr-'.$token.'.go';
        $resultFiles = [
            sys_get_temp_dir().'/smartlab-asset-qr-'.$token.'-left.json',
            sys_get_temp_dir().'/smartlab-asset-qr-'.$token.'-right.json',
        ];
        @unlink($barrier);
        foreach ($resultFiles as $file) @unlink($file);

        $pids = [];
        foreach ([$left, $right] as $index => $callback) {
            $pid = pcntl_fork();
            if ($pid === -1) $this->fail('Unable to fork Asset QR contention worker.');
            if ($pid === 0) $this->runChild($barrier, $resultFiles[$index], $callback);
            $pids[] = $pid;
        }

        usleep(100_000);
        touch($barrier);

        foreach ($pids as $pid) {
            $status = 0;
            pcntl_waitpid($pid, $status);
            $this->assertTrue(pcntl_wifexited($status));
            $this->assertSame(0, pcntl_wexitstatus($status));
        }

        @unlink($barrier);
        $results = [];
        foreach ($resultFiles as $file) {
            $content = is_file($file) ? file_get_contents($file) : false;
            @unlink($file);
            $this->assertIsString($content);
            $decoded = json_decode((string) $content, true, flags: JSON_THROW_ON_ERROR);
            $this->assertIsArray($decoded);
            $results[] = $decoded;
        }

        DB::purge();
        DB::reconnect();

        return [$results[0], $results[1]];
    }

    private function runChild(string $barrier, string $resultFile, callable $callback): never
    {
        while (! is_file($barrier)) usleep(1_000);

        DB::disconnect();
        DB::purge();
        DB::reconnect();
        DB::statement("SET lock_timeout = '5s'");
        DB::statement("SET statement_timeout = '15s'");

        try {
            $callback();
            $result = ['ok' => true, 'code' => null];
        } catch (Throwable $exception) {
            $result = [
                'ok' => false,
                'code' => property_exists($exception, 'errorCode') ? $exception->errorCode : null,
                'class' => $exception::class,
                'message' => $exception->getMessage(),
            ];
        }

        file_put_contents($resultFile, json_encode($result, JSON_THROW_ON_ERROR));
        DB::disconnect();
        exit(0);
    }

    /** @param array<int,array<string,mixed>> $results */
    private function successCount(array $results): int
    {
        return count(array_filter($results, fn (array $result): bool => $result['ok'] === true));
    }

    /** @param array<int,array<string,mixed>> $results @return list<string|null> */
    private function failureCodes(array $results): array
    {
        return array_values(array_map(
            fn (array $result): ?string => $result['code'],
            array_filter($results, fn (array $result): bool => $result['ok'] === false),
        ));
    }
}
