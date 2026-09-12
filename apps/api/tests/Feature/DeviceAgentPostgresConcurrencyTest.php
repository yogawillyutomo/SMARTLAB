<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Telemetry\DeviceAgentIdentityService;
use App\Models\Device;
use App\Models\DeviceAgentEnrollment;
use App\Models\DeviceAgentInstallation;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;
use Throwable;

#[Group('postgres-concurrency')]
class DeviceAgentPostgresConcurrencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Device agent contention proof runs only on PostgreSQL.');
        }

        if (! function_exists('pcntl_fork')) {
            $this->fail('pcntl_fork is required for Device agent contention proof.');
        }
    }

    public function test_concurrent_redeem_of_same_one_time_code_allows_exactly_one_installation(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $device = Device::factory()->create(['school_id' => $schoolId]);
        $service = app(DeviceAgentIdentityService::class);
        $created = $service->createEnrollment(
            $this->context($membershipId),
            User::query()->findOrFail($userId),
            (string) $device->id,
        );
        $code = $created['code'];
        $enrollmentId = (string) $created['enrollment']->id;

        $results = $this->race(
            fn () => app(DeviceAgentIdentityService::class)->redeem($code, '0.1.0-left'),
            fn () => app(DeviceAgentIdentityService::class)->redeem($code, '0.1.0-right'),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['DEVICE_AGENT_ENROLLMENT_INVALID'], $this->failureCodes($results));
        $this->assertDatabaseHas('device_agent_enrollments', [
            'id' => $enrollmentId,
            'status' => 'redeemed',
        ]);
        $this->assertSame(1, DeviceAgentInstallation::query()
            ->where('device_id', $device->id)
            ->where('status', 'active')
            ->count());
        $this->assertSame(1, DeviceAgentInstallation::query()
            ->where('device_id', $device->id)
            ->count());
    }

    public function test_partial_unique_index_blocks_competing_active_installations_for_same_device(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $device = Device::factory()->create(['school_id' => $schoolId]);
        $service = app(DeviceAgentIdentityService::class);
        $context = $this->context($membershipId);
        $actor = User::query()->findOrFail($userId);

        $first = $service->createEnrollment($context, $actor, (string) $device->id)['enrollment'];
        $second = $service->createEnrollment($context, $actor, (string) $device->id)['enrollment'];

        DeviceAgentEnrollment::query()
            ->whereKey([$first->id, $second->id])
            ->update(['status' => 'redeemed', 'redeemed_at' => now()]);

        $results = $this->race(
            fn () => $this->insertActiveInstallation(
                (string) $schoolId,
                (string) $device->id,
                (string) $first->id,
                (string) $userId,
                (string) $membershipId,
                'left',
            ),
            fn () => $this->insertActiveInstallation(
                (string) $schoolId,
                (string) $device->id,
                (string) $second->id,
                (string) $userId,
                (string) $membershipId,
                'right',
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failures = array_values(array_filter($results, fn (array $result): bool => $result['ok'] === false));
        $this->assertCount(1, $failures, json_encode($results));
        $this->assertSame(QueryException::class, $failures[0]['class']);
        $this->assertSame(1, DeviceAgentInstallation::query()
            ->where('device_id', $device->id)
            ->where('status', 'active')
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

    private function insertActiveInstallation(
        string $schoolId,
        string $deviceId,
        string $enrollmentId,
        string $userId,
        string $membershipId,
        string $suffix,
    ): void {
        $now = now();

        DB::table('device_agent_installations')->insert([
            'id' => (string) Str::ulid(),
            'school_id' => $schoolId,
            'device_id' => $deviceId,
            'enrollment_id' => $enrollmentId,
            'status' => 'active',
            'credential_id' => substr(hash('sha256', 'credential-'.$suffix.'-'.Str::uuid()), 0, 32),
            'credential_secret_hash' => hash('sha256', 'secret-'.$suffix.'-'.Str::uuid()),
            'credential_version' => 1,
            'enrolled_by_user_id' => $userId,
            'enrolled_by_membership_id' => $membershipId,
            'enrolled_by_user_id_snapshot' => $userId,
            'enrolled_by_membership_id_snapshot' => $membershipId,
            'enrolled_by_name_snapshot' => 'Concurrency Test Actor',
            'enrolled_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    /** @return array{0:array<string,mixed>,1:array<string,mixed>} */
    private function race(callable $left, callable $right): array
    {
        $token = (string) Str::uuid();
        $barrier = sys_get_temp_dir().'/smartlab-device-agent-'.$token.'.go';
        $resultFiles = [
            sys_get_temp_dir().'/smartlab-device-agent-'.$token.'-left.json',
            sys_get_temp_dir().'/smartlab-device-agent-'.$token.'-right.json',
        ];
        @unlink($barrier);
        foreach ($resultFiles as $file) {
            @unlink($file);
        }

        $pids = [];
        foreach ([$left, $right] as $index => $callback) {
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('Unable to fork Device agent contention worker.');
            }
            if ($pid === 0) {
                $this->runChild($barrier, $resultFiles[$index], $callback);
            }
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
        while (! is_file($barrier)) {
            usleep(1_000);
        }

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
