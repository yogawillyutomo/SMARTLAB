<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Inventory\InventoryMutationService;
use App\Application\Loan\LoanMutationService;
use App\Application\Maintenance\MaintenanceMutationService;
use App\Models\Asset;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Loan;
use App\Models\LoanItem;
use App\Models\MaintenanceExecution;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Group;
use Tests\TestCase;
use Throwable;

#[Group('postgres-concurrency')]
class S4PostgresConcurrencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('S4 contention proof runs only on PostgreSQL.');
        }

        if (! function_exists('pcntl_fork')) {
            $this->fail('pcntl_fork is required for the PostgreSQL S4 contention proof.');
        }
    }

    public function test_concurrent_inventory_issues_never_make_stock_negative(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $item = InventoryItem::factory()->create([
            'school_id' => $schoolId,
            'on_hand_quantity' => '0.000',
            'version' => 1,
        ]);

        app(InventoryMutationService::class)->transact(
            $this->context($membershipId, ['stock.transact']),
            User::query()->findOrFail($userId),
            [
                'inventoryItemId' => $item->id,
                'clientMutationId' => (string) Str::uuid(),
                'kind' => 'opening',
                'quantity' => '5.000',
                'reason' => 'S4 PostgreSQL contention opening',
            ],
        );

        $leftMutation = (string) Str::uuid();
        $rightMutation = (string) Str::uuid();

        $results = $this->race(
            fn () => app(InventoryMutationService::class)->transact(
                $this->context($membershipId, ['stock.transact']),
                User::query()->findOrFail($userId),
                [
                    'inventoryItemId' => $item->id,
                    'clientMutationId' => $leftMutation,
                    'kind' => 'issue',
                    'quantity' => '4.000',
                    'reason' => 'S4 concurrent issue A',
                ],
            ),
            fn () => app(InventoryMutationService::class)->transact(
                $this->context($membershipId, ['stock.transact']),
                User::query()->findOrFail($userId),
                [
                    'inventoryItemId' => $item->id,
                    'clientMutationId' => $rightMutation,
                    'kind' => 'issue',
                    'quantity' => '4.000',
                    'reason' => 'S4 concurrent issue B',
                ],
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['STOCK_INSUFFICIENT'], $this->failureCodes($results));

        $fresh = InventoryItem::query()->findOrFail($item->id);
        $this->assertSame('1.000', $fresh->on_hand_quantity);
        $this->assertGreaterThanOrEqual(0, $this->toMilli($fresh->on_hand_quantity));

        $transactions = InventoryTransaction::query()
            ->where('inventory_item_id', $item->id)
            ->orderBy('created_at')
            ->get();

        $this->assertCount(2, $transactions);
        $this->assertSame(1, $transactions->where('kind', 'issue')->count());
        $this->assertSame(
            $this->toMilli($fresh->on_hand_quantity),
            $transactions->sum(fn (InventoryTransaction $transaction): int => $this->toMilli($transaction->signed_delta)),
        );
    }

    public function test_concurrent_checkout_of_the_same_asset_allows_at_most_one_loan(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $service = app(LoanMutationService::class);
        $context = $this->context($membershipId, []);
        $actor = User::query()->findOrFail($userId);

        $first = $service->create($context, $actor, $this->loanPayload((string) $asset->id, 'Concurrent Borrower A'));
        $second = $service->create($context, $actor, $this->loanPayload((string) $asset->id, 'Concurrent Borrower B'));
        $service->approve($context, $actor, (string) $first->id, 1);
        $service->approve($context, $actor, (string) $second->id, 1);

        $results = $this->race(
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $first->id,
                2,
            ),
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $second->id,
                2,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $this->assertSame(['LOAN_ASSET_UNAVAILABLE'], $this->failureCodes($results));
        $this->assertSame(1, LoanItem::query()->where('asset_id', $asset->id)->where('custody_active', true)->count());

        $statuses = Loan::query()
            ->whereIn('id', [$first->id, $second->id])
            ->pluck('status')
            ->sort()
            ->values()
            ->all();

        $this->assertSame(['approved', 'checked_out'], $statuses);
    }

    public function test_concurrent_loan_checkout_and_maintenance_start_never_create_dual_custody(): void
    {
        [$userId, $membershipId, $schoolId] = $this->actorContext();
        $asset = Asset::factory()->create([
            'school_id' => $schoolId,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]);
        $actor = User::query()->findOrFail($userId);
        $context = $this->context($membershipId, []);

        $loanService = app(LoanMutationService::class);
        $loan = $loanService->create($context, $actor, $this->loanPayload((string) $asset->id, 'Loan vs Maintenance'));
        $loanService->approve($context, $actor, (string) $loan->id, 1);

        $maintenanceService = app(MaintenanceMutationService::class);
        $plan = $maintenanceService->createPlan($context, $actor, [
            'assetId' => (string) $asset->id,
            'name' => 'S4 race plan',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Check custody'],
            'assignedTechnicianName' => 'S4 Technician',
            'nextDueDate' => now()->addWeek()->toDateString(),
        ]);
        $execution = $maintenanceService->scheduleExecution($context, $actor, (string) $plan->id, 1, [
            'scheduledFor' => now()->toDateString(),
            'technicianName' => 'S4 Technician',
        ]);

        $results = $this->race(
            fn () => app(LoanMutationService::class)->checkout(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $loan->id,
                2,
            ),
            fn () => app(MaintenanceMutationService::class)->startExecution(
                $this->context($membershipId, []),
                User::query()->findOrFail($userId),
                (string) $execution->id,
                1,
            ),
        );

        $this->assertSame(1, $this->successCount($results), json_encode($results));
        $failureCodes = $this->failureCodes($results);
        $this->assertCount(1, $failureCodes);
        $this->assertContains($failureCodes[0], ['LOAN_ASSET_UNAVAILABLE', 'MAINTENANCE_ASSET_UNAVAILABLE']);

        $loanActive = LoanItem::query()
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->count();
        $maintenanceActive = MaintenanceExecution::query()
            ->where('asset_id', $asset->id)
            ->where('custody_active', true)
            ->count();

        $this->assertSame(1, $loanActive + $maintenanceActive);
        $this->assertFalse($loanActive === 1 && $maintenanceActive === 1);

        $loan->refresh();
        $execution->refresh();

        if ($loanActive === 1) {
            $this->assertSame('checked_out', $loan->status);
            $this->assertSame('scheduled', $execution->status);
        } else {
            $this->assertSame('approved', $loan->status);
            $this->assertSame('in_progress', $execution->status);
        }
    }

    /**
     * @return array{string,string,string}
     */
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

    /**
     * @param list<string> $permissions
     */
    private function context(string $membershipId, array $permissions): CurrentMembershipContext
    {
        return new CurrentMembershipContext(
            SchoolMembership::query()->findOrFail($membershipId),
            collect($permissions),
        );
    }

    /**
     * @return array<string,mixed>
     */
    private function loanPayload(string $assetId, string $borrower): array
    {
        return [
            'borrowerName' => $borrower,
            'purpose' => 'S4 PostgreSQL concurrency proof',
            'requestedReturnAt' => now()->addDay()->toISOString(),
            'assetIds' => [$assetId],
        ];
    }

    /**
     * @return array{0:array<string,mixed>,1:array<string,mixed>}
     */
    private function race(callable $left, callable $right): array
    {
        $token = (string) Str::uuid();
        $barrier = sys_get_temp_dir().'/smartlab-s4-'.$token.'.go';
        $resultFiles = [
            sys_get_temp_dir().'/smartlab-s4-'.$token.'-left.json',
            sys_get_temp_dir().'/smartlab-s4-'.$token.'-right.json',
        ];
        @unlink($barrier);
        foreach ($resultFiles as $file) {
            @unlink($file);
        }

        $pids = [];
        foreach ([$left, $right] as $index => $callback) {
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('Unable to fork PostgreSQL contention worker.');
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
            $this->assertTrue(pcntl_wifexited($status), 'Contention worker did not exit normally.');
            $this->assertSame(0, pcntl_wexitstatus($status), 'Contention worker exited with failure.');
        }

        @unlink($barrier);
        $results = [];
        foreach ($resultFiles as $file) {
            $content = is_file($file) ? file_get_contents($file) : false;
            @unlink($file);
            $this->assertIsString($content, 'Contention worker did not emit a result.');
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
            $result = ['ok' => true, 'code' => null, 'class' => null, 'message' => null];
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

    private function toMilli(mixed $value): int
    {
        return (int) str_replace('.', '', number_format((float) $value, 3, '.', ''));
    }
}
