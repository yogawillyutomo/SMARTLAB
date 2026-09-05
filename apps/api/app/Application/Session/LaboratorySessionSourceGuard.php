<?php

namespace App\Application\Session;

use App\Domain\Session\LaboratorySessionDomainException;
use App\Models\LaboratorySession;

class LaboratorySessionSourceGuard
{
    public function assertMutable(string $schoolId, string $sourceType, string $sourceId, string $operation): void
    {
        $column = match ($sourceType) {
            'schedule_occurrence' => 'schedule_occurrence_id',
            'laboratory_reservation' => 'reservation_id',
            'priority_event' => 'priority_event_id',
            default => throw new \InvalidArgumentException('Unsupported Laboratory Session source type.'),
        };

        $session = LaboratorySession::query()
            ->where('school_id', $schoolId)
            ->where($column, $sourceId)
            ->whereIn('status', ['prepared', 'in_progress'])
            ->orderByRaw("CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END")
            ->orderBy('id')
            ->first();

        if ($session !== null) {
            throw LaboratorySessionDomainException::sourceActiveConflict($operation, [
                'id' => (string) $session->id,
                'sessionNumber' => (string) $session->session_number,
                'status' => (string) $session->status,
            ]);
        }
    }
}
