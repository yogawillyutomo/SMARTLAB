<?php

namespace Tests\Feature;

use App\Application\Incident\IncidentTicketAllocator;
use App\Domain\Incident\IncidentDomainException;
use App\Models\School;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class IncidentTicketAllocatorTest extends TestCase
{
    use RefreshDatabase;

    public function test_sequence_formats_six_digits_and_increments_without_counting_incidents(): void
    {
        $school = School::factory()->create();
        $allocator = app(IncidentTicketAllocator::class);
        $clock = new CarbonImmutable('2026-08-29T03:00:00Z');

        $first = DB::transaction(fn () => $allocator->allocate($school->id, $clock));
        $second = DB::transaction(fn () => $allocator->allocate($school->id, $clock));

        $this->assertSame(['year' => 2026, 'sequence' => 1, 'ticketNumber' => 'INC-2026-000001'], $first);
        $this->assertSame(['year' => 2026, 'sequence' => 2, 'ticketNumber' => 'INC-2026-000002'], $second);
        $this->assertDatabaseCount('incidents', 0);
    }

    public function test_sequences_are_isolated_by_school_and_utc_year(): void
    {
        $firstSchool = School::factory()->create();
        $secondSchool = School::factory()->create();
        $allocator = app(IncidentTicketAllocator::class);

        $a = DB::transaction(fn () => $allocator->allocate($firstSchool->id, new CarbonImmutable('2026-12-31T23:59:59Z')));
        $b = DB::transaction(fn () => $allocator->allocate($secondSchool->id, new CarbonImmutable('2026-12-31T23:59:59Z')));
        $c = DB::transaction(fn () => $allocator->allocate($firstSchool->id, new CarbonImmutable('2027-01-01T00:00:00Z')));

        $this->assertSame('INC-2026-000001', $a['ticketNumber']);
        $this->assertSame('INC-2026-000001', $b['ticketNumber']);
        $this->assertSame('INC-2027-000001', $c['ticketNumber']);
    }

    public function test_exhausted_sequence_returns_stable_domain_error_without_incrementing(): void
    {
        $school = School::factory()->create();
        DB::table('incident_number_sequences')->insert([
            'school_id' => $school->id,
            'ticket_year' => 2026,
            'last_value' => 999999,
        ]);

        try {
            DB::transaction(fn () => app(IncidentTicketAllocator::class)->allocate(
                $school->id,
                new CarbonImmutable('2026-08-29T03:00:00Z'),
            ));
            $this->fail('Expected sequence exhaustion.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_TICKET_SEQUENCE_EXHAUSTED', $exception->errorCode);
            $this->assertSame(999999, DB::table('incident_number_sequences')->value('last_value'));
        }
    }

    public function test_school_year_uniqueness_rejects_duplicate_sequence_rows(): void
    {
        $school = School::factory()->create();
        DB::table('incident_number_sequences')->insert(['school_id' => $school->id, 'ticket_year' => 2026, 'last_value' => 1]);

        $this->expectException(QueryException::class);
        DB::table('incident_number_sequences')->insert(['school_id' => $school->id, 'ticket_year' => 2026, 'last_value' => 1]);
    }
}
