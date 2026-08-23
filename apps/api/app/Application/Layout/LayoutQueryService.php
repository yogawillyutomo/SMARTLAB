<?php

namespace App\Application\Layout;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Layout\LayoutDomainException;
use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Layout;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

class LayoutQueryService
{
    public function find(CurrentMembershipContext $context, string $layoutId): Layout
    {
        $layout = Layout::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($layoutId)
            ->first();

        if ($layout === null) {
            throw new LayoutDomainException('Layout not found.', 'LAYOUT_NOT_FOUND', 404);
        }

        return $this->loadAggregate($layout);
    }

    /** @param array<string, mixed> $filters */
    public function list(
        CurrentMembershipContext $context,
        string $laboratoryId,
        array $filters,
    ): LengthAwarePaginator {
        $schoolId = $context->membership->school_id;
        if (! Laboratory::query()->where('school_id', $schoolId)->whereKey($laboratoryId)->exists()) {
            throw new LayoutDomainException('Laboratory not found.', 'LABORATORY_NOT_FOUND', 404);
        }

        $query = Layout::query()->where('school_id', $schoolId)->where('laboratory_id', $laboratoryId);
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return $query->orderByDesc('created_at')->orderBy('id')->paginate(
            (int) ($filters['perPage'] ?? 25),
            ['*'],
            'page',
            (int) ($filters['page'] ?? 1),
        );
    }

    /** @param array<string, mixed> $filters */
    public function unplacedDevices(
        CurrentMembershipContext $context,
        string $layoutId,
        array $filters,
    ): LengthAwarePaginator {
        $layout = Layout::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($layoutId)
            ->first();
        if ($layout === null) {
            throw new LayoutDomainException('Layout not found.', 'LAYOUT_NOT_FOUND', 404);
        }
        if (! in_array($layout->status, ['draft', 'active'], true)) {
            throw new LayoutDomainException(
                'The requested operation is not valid for this Layout status.',
                'LAYOUT_STATUS_CONFLICT',
                409,
            );
        }

        $query = Device::query()
            ->where('school_id', $layout->school_id)
            ->where('home_laboratory_id', $layout->laboratory_id)
            ->whereIn('lifecycle_status', ['in_service', 'spare'])
            ->whereDoesntHave('layoutPlacements', fn (Builder $query) => $query->where('layout_id', $layout->id));

        if (isset($filters['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower((string) $filters['search'])).'%';
            $query->where(function (Builder $query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['device_code', 'hostname', 'serial_number', 'brand', 'model'] as $index => $column) {
                    $query->whereRaw(
                        'LOWER('.$grammar->wrap($column).") LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        return $query->orderBy('device_code')->orderBy('id')->paginate(
            (int) ($filters['perPage'] ?? 25),
            ['id', 'device_code', 'device_type', 'lifecycle_status', 'hostname', 'brand', 'model'],
            'page',
            (int) ($filters['page'] ?? 1),
        );
    }

    public function loadAggregate(Layout $layout): Layout
    {
        return $layout->load([
            'structuralElements' => fn ($query) => $query->orderBy('row')->orderBy('column')->orderBy('id'),
            'devicePlacements' => fn ($query) => $query->orderBy('row')->orderBy('column')->orderBy('id'),
        ]);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
