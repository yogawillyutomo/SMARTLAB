<?php

namespace App\Application\Reservation;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Reservation\LaboratoryReservationException;
use App\Models\LaboratoryReservation;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class LaboratoryReservationQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<LaboratoryReservation> */
    public function reservations(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $schoolId = (string) $context->membership->school_id;
        $canViewAll = $context->permissions->contains('bookings.view-all');
        $requestedScope = $filters['scope'] ?? ($canViewAll ? 'all' : 'mine');

        if ($requestedScope === 'all' && ! $canViewAll) {
            throw new LaboratoryReservationException(
                'You do not have permission to view all Laboratory reservations.',
                'LABORATORY_RESERVATION_SCOPE_FORBIDDEN',
                403,
            );
        }

        $query = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->whereBetween('reservation_date', [$filters['from'], $filters['to']])
            ->with([
                'laboratory:id,school_id,code,name,capacity,status',
                'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
            ]);

        if ($requestedScope === 'mine') {
            $query->where('requester_membership_id', $context->membership->id);
        }
        if (isset($filters['laboratoryId'])) {
            $query->where('laboratory_id', $filters['laboratoryId']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query
            ->orderByDesc('reservation_date')
            ->orderByDesc('starts_at')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 100,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function reservation(CurrentMembershipContext $context, string $id): LaboratoryReservation
    {
        $reservation = LaboratoryReservation::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->with([
                'laboratory:id,school_id,code,name,capacity,status',
                'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
            ])
            ->first();

        if ($reservation === null) {
            throw LaboratoryReservationException::notFound();
        }

        if (! $context->permissions->contains('bookings.view-all')
            && $reservation->requester_membership_id !== $context->membership->id) {
            throw LaboratoryReservationException::notFound();
        }

        return $reservation;
    }
}
