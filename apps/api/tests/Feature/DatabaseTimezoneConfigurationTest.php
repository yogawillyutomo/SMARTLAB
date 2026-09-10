<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DatabaseTimezoneConfigurationTest extends TestCase
{
    public function test_application_and_postgres_connection_are_pinned_to_utc(): void
    {
        $this->assertSame('UTC', config('app.timezone'));
        $this->assertSame('UTC', config('database.connections.pgsql.timezone'));
    }

    public function test_active_postgres_session_is_utc_when_postgres_is_under_test(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL session timezone proof runs only on PostgreSQL.');
        }

        $row = DB::selectOne('SHOW TIME ZONE');

        $this->assertNotNull($row);
        $this->assertSame('UTC', $row->TimeZone);
    }
}
