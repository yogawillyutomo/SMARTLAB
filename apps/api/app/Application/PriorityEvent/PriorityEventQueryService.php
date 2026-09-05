<?php

namespace App\Application\PriorityEvent;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\PriorityEvent\PriorityEventDomainException;
use App\Models\PriorityEvent;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class PriorityEventQueryService
{
    /** @param array<string,mixed> $filters @return LengthAwarePaginator<PriorityEvent> */
    public function events(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $schoolId = (string) $context->membership->school_id;
        $canViewAll = $context->permissions->contains('priority-events.view-all');
        $requestedScope = $filters['scope'] ?? ($canViewAll ? 'all' : 'mine');

        if ($requestedScope === 'all' && ! $canViewAll) {
            throw PriorityEventDomainException::scopeForbidden();
        }

        $query = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->whereBetween('event_date', [$filters['from'], $filters['to']])
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
            ->orderByDesc('event_date')
            ->orderByDesc('starts_at')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 100,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function event(CurrentMembershipContext $context, string $id): PriorityEvent
    {
        $event = PriorityEvent::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->with([
                'laboratory:id,school_id,code,name,capacity,status',
                'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
            ])
            ->first();

        if ($event === null) {
            throw PriorityEventDomainException::notFound();
        }

        if (! $context->permissions->contains('priority-events.view-all')
            && $event->requester_membership_id !== $context->membership->id) {
            throw PriorityEventDomainException::notFound();
        }

        return $event;
    }
}
