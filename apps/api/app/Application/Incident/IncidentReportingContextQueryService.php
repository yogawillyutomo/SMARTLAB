<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentCatalog;
use App\Domain\Incident\IncidentDomainException;
use App\Models\Device;
use App\Models\Laboratory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

final class IncidentReportingContextQueryService
{
    /** @param array<string, mixed> $filters */
    public function laboratories(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = Laboratory::query()
            ->where('school_id', $context->membership->school_id)
            ->where('status', 'active');

        if (isset($filters['search'])) {
            $this->applyLiteralSearch($query, ['code', 'name'], (string) $filters['search']);
        }

        return $query
            ->orderByRaw('LOWER('.$query->getQuery()->getGrammar()->wrap('code').') ASC')
            ->orderBy('id')
            ->paginate(
                (int) ($filters['perPage'] ?? 25),
                ['id', 'code', 'name'],
                'page',
                (int) ($filters['page'] ?? 1),
            );
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array{devices: Collection<int, Device>, hasMore: bool}
     */
    public function devices(
        CurrentMembershipContext $context,
        string $laboratoryId,
        array $filters,
    ): array {
        $schoolId = $context->membership->school_id;
        $laboratory = Laboratory::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->whereKey($laboratoryId)
            ->first(['id']);

        if ($laboratory === null) {
            throw IncidentDomainException::laboratoryNotFound();
        }

        $query = Device::query()
            ->where('school_id', $schoolId)
            ->where('home_laboratory_id', $laboratory->id)
            ->whereIn('lifecycle_status', IncidentCatalog::REPORTING_DEVICE_LIFECYCLE_STATUSES);

        $this->applyLiteralSearch($query, ['device_code'], (string) $filters['search']);

        $devices = $query
            ->orderBy('device_code')
            ->orderBy('id')
            ->limit(21)
            ->get(['id', 'device_code', 'device_type']);

        return [
            'devices' => $devices->take(20)->values(),
            'hasMore' => $devices->count() > 20,
        ];
    }

    /** @param list<string> $columns */
    private function applyLiteralSearch(Builder $query, array $columns, string $search): void
    {
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';

        $query->where(function (Builder $query) use ($columns, $pattern): void {
            $grammar = $query->getQuery()->getGrammar();
            foreach ($columns as $index => $column) {
                $query->whereRaw(
                    'LOWER('.$grammar->wrap($column).") LIKE ? ESCAPE '\\'",
                    [$pattern],
                    $index === 0 ? 'and' : 'or',
                );
            }
        });
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
