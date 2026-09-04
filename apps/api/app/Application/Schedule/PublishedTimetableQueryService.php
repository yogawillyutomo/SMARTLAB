<?php

namespace App\Application\Schedule;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Schedule\PublishedTimetableException;
use App\Models\TimetablePublication;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class PublishedTimetableQueryService
{
    /** @param array<string, mixed> $filters @return LengthAwarePaginator<TimetablePublication> */
    public function publications(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = TimetablePublication::query()
            ->where('school_id', $context->membership->school_id);

        if (isset($filters['semesterId'])) {
            $query->where('semester_id', $filters['semesterId']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['sourcePublicationId'])) {
            $query->where('source_publication_id', $filters['sourcePublicationId']);
        }

        return $query
            ->orderByDesc('published_at')
            ->orderByDesc('source_version')
            ->orderByDesc('id')
            ->paginate(
                perPage: $filters['perPage'] ?? 25,
                columns: ['*'],
                pageName: 'page',
                page: $filters['page'] ?? 1,
            );
    }

    public function publication(CurrentMembershipContext $context, string $id): TimetablePublication
    {
        return TimetablePublication::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw PublishedTimetableException::notFound();
    }
}
