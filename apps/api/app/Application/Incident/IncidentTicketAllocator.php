<?php

namespace App\Application\Incident;

use App\Domain\Incident\IncidentDomainException;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

final class IncidentTicketAllocator
{
    /** @return array{year: int, sequence: int, ticketNumber: string} */
    public function allocate(string $schoolId, ?DateTimeInterface $clock = null): array
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Incident ticket allocation requires an active database transaction.');
        }

        $year = (int) CarbonImmutable::instance($clock ?? now())->utc()->format('Y');

        $inserted = DB::table('incident_number_sequences')->insertOrIgnore([
            'school_id' => $schoolId,
            'ticket_year' => $year,
            'last_value' => 1,
        ]);

        $row = DB::table('incident_number_sequences')
            ->where('school_id', $schoolId)
            ->where('ticket_year', $year)
            ->lockForUpdate()
            ->first();

        if ($row === null) {
            throw new \LogicException('Incident sequence row could not be established.');
        }

        if ($inserted === 1) {
            $sequence = 1;
        } else {
            $lastValue = (int) $row->last_value;
            if ($lastValue >= 999999) {
                throw IncidentDomainException::ticketSequenceExhausted();
            }
            $sequence = $lastValue + 1;
            DB::table('incident_number_sequences')
                ->where('school_id', $schoolId)
                ->where('ticket_year', $year)
                ->update(['last_value' => $sequence]);
        }

        return [
            'year' => $year,
            'sequence' => $sequence,
            'ticketNumber' => sprintf('INC-%d-%06d', $year, $sequence),
        ];
    }
}
