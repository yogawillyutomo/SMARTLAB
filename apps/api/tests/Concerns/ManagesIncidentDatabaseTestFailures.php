<?php

namespace Tests\Concerns;

use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use LogicException;

trait ManagesIncidentDatabaseTestFailures
{
    private const FORCED_EVENT_INSERT_FAILURE = 'INCIDENT_TEST_FORCED_EVENT_INSERT_FAILURE';

    private ?string $incidentEventFailureTrigger = null;

    private ?string $incidentEventFailureFunction = null;

    protected function installIncidentEventInsertFailureTrigger(): void
    {
        $suffix = bin2hex(random_bytes(12));
        $this->incidentEventFailureTrigger = "incident_test_event_fail_trg_{$suffix}";
        $driver = DB::connection()->getDriverName();

        if ($driver === 'sqlite') {
            DB::unprepared(
                "CREATE TRIGGER {$this->incidentEventFailureTrigger} BEFORE INSERT ON incident_events "
                ."BEGIN SELECT RAISE(ABORT, '".self::FORCED_EVENT_INSERT_FAILURE."'); END"
            );

            return;
        }

        if ($driver === 'pgsql') {
            $this->incidentEventFailureFunction = "incident_test_event_fail_fn_{$suffix}";

            DB::unprepared(
                "CREATE FUNCTION {$this->incidentEventFailureFunction}() RETURNS trigger AS $$ "
                ."BEGIN RAISE EXCEPTION '".self::FORCED_EVENT_INSERT_FAILURE."'; END; $$ LANGUAGE plpgsql"
            );
            DB::unprepared(
                "CREATE TRIGGER {$this->incidentEventFailureTrigger} BEFORE INSERT ON incident_events "
                ."FOR EACH ROW EXECUTE FUNCTION {$this->incidentEventFailureFunction}()"
            );

            return;
        }

        throw new LogicException("Unsupported test database driver [{$driver}].");
    }

    protected function removeIncidentEventInsertFailureTrigger(): void
    {
        $trigger = $this->incidentEventFailureTrigger;
        $function = $this->incidentEventFailureFunction;

        try {
            if ($trigger === null) {
                return;
            }

            if (DB::connection()->getDriverName() === 'pgsql') {
                DB::unprepared("DROP TRIGGER IF EXISTS {$trigger} ON incident_events");

                if ($function !== null) {
                    DB::unprepared("DROP FUNCTION IF EXISTS {$function}()");
                }

                return;
            }

            DB::unprepared("DROP TRIGGER IF EXISTS {$trigger}");
        } finally {
            $this->incidentEventFailureTrigger = null;
            $this->incidentEventFailureFunction = null;
        }
    }

    /** @param Closure(): mixed $operation */
    protected function assertDatabaseOperationIsRejected(Closure $operation, string $message): void
    {
        try {
            DB::transaction(function () use ($operation): void {
                $operation();
            });

            $this->fail($message);
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
    }

    /** @param Closure(): mixed $operation */
    protected function assertIncidentEventInsertFailureIsRejected(Closure $operation, string $message): void
    {
        try {
            DB::transaction(function () use ($operation): void {
                $operation();
            });

            $this->fail($message);
        } catch (QueryException $exception) {
            $this->assertStringContainsString(self::FORCED_EVENT_INSERT_FAILURE, $exception->getMessage());
        }
    }
}
