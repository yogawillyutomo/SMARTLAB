<?php

namespace App\Application\Incident;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Incident\IncidentTimestamp;
use App\Models\Incident;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

final class IncidentListQueryService
{
    public function __construct(private readonly IncidentVisibility $visibility) {}

    /** @param array<string, mixed> $filters */
    public function list(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = $this->visibility->query($context);

        foreach ([
            'status' => 'status',
            'priority' => 'priority',
            'category' => 'category',
            'laboratoryId' => 'laboratory_id_snapshot',
            'deviceId' => 'device_id_snapshot',
            'assigneeMembershipId' => 'assignee_membership_id',
        ] as $filter => $column) {
            if (isset($filters[$filter])) {
                $query->where($column, $filters[$filter]);
            }
        }

        if (isset($filters['reportedFrom'])) {
            $query->where('reported_at', '>=', $this->timestamp((string) $filters['reportedFrom']));
        }
        if (isset($filters['reportedTo'])) {
            $query->where('reported_at', '<=', $this->timestamp((string) $filters['reportedTo']));
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, (string) $filters['search']);
        }

        return $query
            ->orderByDesc('reported_at')
            ->orderByDesc('id')
            ->paginate(
                (int) ($filters['perPage'] ?? 25),
                [
                    'id', 'ticket_number', 'reporter_user_id_snapshot', 'reporter_name_snapshot',
                    'laboratory_id_snapshot', 'laboratory_code_snapshot', 'laboratory_name_snapshot',
                    'device_id_snapshot', 'device_code_snapshot', 'device_type_snapshot',
                    'category', 'priority', 'title', 'blocks_laboratory_operation', 'status',
                    'assignee_user_id_snapshot', 'assignee_name_snapshot', 'version', 'occurred_at', 'reported_at',
                ],
                'page',
                (int) ($filters['page'] ?? 1),
            );
    }

    /** @param Builder<Incident> $query */
    private function applySearch(Builder $query, string $search): void
    {
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';

        $query->where(function (Builder $query) use ($pattern): void {
            $grammar = $query->getQuery()->getGrammar();
            foreach (['ticket_number', 'title', 'laboratory_code_snapshot', 'device_code_snapshot'] as $index => $column) {
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

    private function timestamp(string $value): CarbonImmutable
    {
        return CarbonImmutable::parse(IncidentTimestamp::canonicalize($value));
    }
}
