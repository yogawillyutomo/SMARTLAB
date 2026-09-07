<?php

namespace App\Application\WorkOrder;

use App\Domain\WorkOrder\WorkOrderDomainException;
use Illuminate\Support\Facades\DB;

final class WorkOrderNumberAllocator
{
    public function next(string $schoolId): string
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Work Order number allocation requires an active transaction.');
        }

        $year = (int) now('UTC')->format('Y');

        DB::table('work_order_sequences')->insertOrIgnore([
            'school_id' => $schoolId,
            'year' => $year,
            'last_value' => 0,
        ]);

        $row = DB::table('work_order_sequences')
            ->where('school_id', $schoolId)
            ->where('year', $year)
            ->lockForUpdate()
            ->first();

        if ($row === null) {
            throw new \LogicException('Work Order sequence row could not be allocated.');
        }

        $next = (int) $row->last_value + 1;
        if ($next > 999999) {
            throw WorkOrderDomainException::numberExhausted();
        }

        DB::table('work_order_sequences')
            ->where('school_id', $schoolId)
            ->where('year', $year)
            ->update(['last_value' => $next]);

        return sprintf('WO-%04d-%06d', $year, $next);
    }
}
