<?php

namespace App\Application\Layout;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Layout\LayoutAggregateValidator;
use App\Domain\Layout\LayoutDomainException;
use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Layout;
use App\Models\LayoutChangeEvent;
use App\Models\LayoutDevicePlacement;
use App\Models\LayoutStructuralElement;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class LayoutMutationService
{
    public function __construct(
        private readonly LayoutAggregateValidator $validator,
        private readonly LayoutQueryService $queries,
    ) {}

    /** @param array<string, mixed> $data */
    public function create(
        CurrentMembershipContext $context,
        string $laboratoryId,
        array $data,
    ): Layout {
        $schoolId = $context->membership->school_id;

        try {
            return DB::transaction(function () use ($context, $schoolId, $laboratoryId, $data): Layout {
                $laboratory = Laboratory::query()
                    ->where('school_id', $schoolId)
                    ->whereKey($laboratoryId)
                    ->lockForUpdate()
                    ->first();
                if ($laboratory === null) {
                    throw new LayoutDomainException('Laboratory not found.', 'LABORATORY_NOT_FOUND', 404);
                }
                $this->assertLaboratoryActive($laboratory);

                if (Layout::query()->where('school_id', $schoolId)->where('laboratory_id', $laboratoryId)
                    ->where('status', 'draft')->lockForUpdate()->first(['id']) !== null) {
                    throw new LayoutDomainException(
                        'A draft Layout already exists for this Laboratory.',
                        'LAYOUT_DRAFT_ALREADY_EXISTS',
                        409,
                    );
                }

                $active = Layout::query()
                    ->where('school_id', $schoolId)
                    ->where('laboratory_id', $laboratoryId)
                    ->where('status', 'active')
                    ->lockForUpdate()
                    ->first();

                if ($active !== null) {
                    foreach (['rows', 'columns', 'templateKey'] as $unsupported) {
                        if (array_key_exists($unsupported, $data)) {
                            throw ValidationException::withMessages([
                                $unsupported => ['This field cannot be supplied when cloning the active Layout.'],
                            ]);
                        }
                    }
                    $active = $this->queries->loadAggregate($active);
                    $draft = Layout::query()->create([
                        'school_id' => $schoolId,
                        'laboratory_id' => $laboratoryId,
                        'name' => array_key_exists('name', $data) ? trim((string) $data['name']) : $active->name,
                        'template_key' => $active->template_key,
                        'rows' => $active->rows,
                        'columns' => $active->columns,
                        'status' => 'draft',
                        'version' => 1,
                    ]);
                    foreach ($active->structuralElements as $element) {
                        $draft->structuralElements()->create([
                            'school_id' => $draft->school_id,
                            ...$this->structureAttributes($this->structureState($element)),
                        ]);
                    }
                    foreach ($active->devicePlacements as $placement) {
                        $draft->devicePlacements()->create([
                            'school_id' => $draft->school_id,
                            ...$this->placementAttributes($this->placementState($placement)),
                        ]);
                    }
                } else {
                    $missing = [];
                    foreach (['name', 'rows', 'columns'] as $field) {
                        if (! array_key_exists($field, $data)) {
                            $missing[$field] = ["The {$field} field is required when no active Layout exists."];
                        }
                    }
                    if ($missing !== []) {
                        throw ValidationException::withMessages($missing);
                    }

                    $draft = Layout::query()->create([
                        'school_id' => $schoolId,
                        'laboratory_id' => $laboratoryId,
                        'name' => trim((string) $data['name']),
                        'template_key' => $this->optionalString($data['templateKey'] ?? null),
                        'rows' => $data['rows'],
                        'columns' => $data['columns'],
                        'status' => 'draft',
                        'version' => 1,
                    ]);
                }

                $this->writeEvent($context, $draft, 'layout.created', ['layout'], [
                    'layout' => ['after' => $this->rootState($draft)],
                    'clonedFromLayoutId' => $active?->id,
                ]);

                return $this->queries->loadAggregate($draft);
            }, 3);
        } catch (UniqueConstraintViolationException $exception) {
            if (Layout::query()->where('school_id', $schoolId)->where('laboratory_id', $laboratoryId)
                ->where('status', 'draft')->exists()) {
                throw new LayoutDomainException(
                    'A draft Layout already exists for this Laboratory.',
                    'LAYOUT_DRAFT_ALREADY_EXISTS',
                    409,
                );
            }

            throw $exception;
        }
    }

    /** @param array<string, mixed> $data */
    public function replace(
        CurrentMembershipContext $context,
        string $layoutId,
        int $expectedVersion,
        array $data,
    ): Layout {
        return DB::transaction(function () use ($context, $layoutId, $expectedVersion, $data): Layout {
            $layout = $this->lockLayoutWithLaboratory($context, $layoutId);
            $this->assertVersion($layout, $expectedVersion);
            $this->assertDraft($layout);
            $this->assertLaboratoryActive($layout->laboratory);
            $layout = $this->queries->loadAggregate($layout);

            $target = $this->validator->normalize($data);
            $this->assertChildIdsBelongToDraft($layout, $target);
            $devices = $this->lockDevices($layout->school_id, $target['devicePlacements']);
            $this->validator->validate($target, $layout->laboratory_id, $devices);

            if ($this->aggregatesEqual($this->currentAggregate($layout), $target)) {
                return $layout;
            }

            $rootBefore = $this->rootState($layout);
            $rootFields = [];
            foreach ([
                'name' => 'name',
                'templateKey' => 'template_key',
                'rows' => 'rows',
                'columns' => 'columns',
            ] as $field => $attribute) {
                if ($layout->getAttribute($attribute) !== $target[$field]) {
                    $rootFields[] = $field;
                    $layout->setAttribute($attribute, $target[$field]);
                }
            }

            $structureChanges = $this->syncStructure($layout, $target['structuralElements']);
            $placementEvents = $this->syncPlacements($layout, $target['devicePlacements']);

            $layout->version++;
            $layout->save();

            if ($rootFields !== [] || $structureChanges !== []) {
                $this->writeEvent(
                    $context,
                    $layout,
                    'layout.structure_updated',
                    [...$rootFields, ...($structureChanges === [] ? [] : ['structuralElements'])],
                    [
                        'root' => ['before' => $rootBefore, 'after' => $this->rootState($layout)],
                        'structuralElements' => array_slice($structureChanges, 0, 100),
                        'structuralElementChangeCount' => count($structureChanges),
                        'truncated' => count($structureChanges) > 100,
                    ],
                );
            }
            foreach ($placementEvents as $event) {
                $this->writeEvent(
                    $context,
                    $layout,
                    $event['eventType'],
                    $event['changedFields'],
                    $event['changes'],
                );
            }

            return $this->queries->loadAggregate($layout->refresh());
        }, 3);
    }

    public function activate(
        CurrentMembershipContext $context,
        string $layoutId,
        int $expectedVersion,
    ): Layout {
        try {
            return DB::transaction(function () use ($context, $layoutId, $expectedVersion): Layout {
                $layout = $this->lockLayoutWithLaboratory($context, $layoutId);
                $this->assertVersion($layout, $expectedVersion);
                $this->assertDraft($layout);
                $this->assertLaboratoryActive($layout->laboratory);
                $layout = $this->queries->loadAggregate($layout);

                $predecessor = Layout::query()
                    ->where('school_id', $layout->school_id)
                    ->where('laboratory_id', $layout->laboratory_id)
                    ->where('status', 'active')
                    ->whereKeyNot($layout->id)
                    ->lockForUpdate()
                    ->first();
                $aggregate = $this->currentAggregate($layout);
                $devices = $this->lockDevices($layout->school_id, $aggregate['devicePlacements']);
                $this->validator->validate($aggregate, $layout->laboratory_id, $devices);
                $effectiveAt = now();

                if ($predecessor !== null) {
                    $predecessor->status = 'archived';
                    $predecessor->archived_at = $effectiveAt;
                    $predecessor->version++;
                    $predecessor->save();
                    $this->writeEvent($context, $predecessor, 'layout.archived', ['status', 'archivedAt'], [
                        'status' => ['before' => 'active', 'after' => 'archived'],
                        'archivedAt' => ['after' => $effectiveAt->toISOString()],
                        'successorLayoutId' => $layout->id,
                    ]);
                }

                $layout->status = 'active';
                $layout->activated_at = $effectiveAt;
                $layout->version++;
                $layout->save();
                $this->writeEvent($context, $layout, 'layout.activated', ['status', 'activatedAt'], [
                    'status' => ['before' => 'draft', 'after' => 'active'],
                    'activatedAt' => ['after' => $effectiveAt->toISOString()],
                    'predecessorLayoutId' => $predecessor?->id,
                ]);

                return $this->queries->loadAggregate($layout->refresh());
            }, 3);
        } catch (UniqueConstraintViolationException $exception) {
            throw new LayoutDomainException(
                'The requested operation is not valid for the current Layout state.',
                'LAYOUT_STATUS_CONFLICT',
                409,
            );
        }
    }

    public function delete(
        CurrentMembershipContext $context,
        string $layoutId,
        int $expectedVersion,
    ): void {
        DB::transaction(function () use ($context, $layoutId, $expectedVersion): void {
            $layout = $this->lockLayoutWithLaboratory($context, $layoutId);
            $this->assertVersion($layout, $expectedVersion);
            $this->assertDraft($layout);

            $this->writeEvent($context, $layout, 'layout.draft_deleted', ['status'], [
                'layout' => ['before' => $this->rootState($layout), 'after' => null],
            ]);
            $layout->delete();
        }, 3);
    }

    private function lockLayoutWithLaboratory(CurrentMembershipContext $context, string $layoutId): Layout
    {
        $schoolId = $context->membership->school_id;
        $candidate = Layout::query()->where('school_id', $schoolId)->whereKey($layoutId)->first(['id', 'laboratory_id']);
        if ($candidate === null) {
            throw new LayoutDomainException('Layout not found.', 'LAYOUT_NOT_FOUND', 404);
        }

        Laboratory::query()->where('school_id', $schoolId)->whereKey($candidate->laboratory_id)->lockForUpdate()->firstOrFail();
        $layout = Layout::query()->where('school_id', $schoolId)->whereKey($layoutId)->lockForUpdate()->first();
        if ($layout === null) {
            throw new LayoutDomainException('Layout not found.', 'LAYOUT_NOT_FOUND', 404);
        }

        return $layout->setRelation('laboratory', Laboratory::query()
            ->where('school_id', $schoolId)->whereKey($layout->laboratory_id)->firstOrFail());
    }

    private function assertVersion(Layout $layout, int $expectedVersion): void
    {
        if ($layout->version !== $expectedVersion) {
            throw new LayoutDomainException(
                'Layout has changed since it was loaded.',
                'LAYOUT_VERSION_CONFLICT',
                412,
            );
        }
    }

    private function assertDraft(Layout $layout): void
    {
        if ($layout->status !== 'draft') {
            throw new LayoutDomainException(
                'The requested operation is valid only for a draft Layout.',
                'LAYOUT_STATUS_CONFLICT',
                409,
            );
        }
    }

    private function assertLaboratoryActive(Laboratory $laboratory): void
    {
        if ($laboratory->status !== 'active') {
            throw new LayoutDomainException(
                'The Laboratory must be active for this Layout operation.',
                'LAYOUT_LABORATORY_INACTIVE',
                409,
            );
        }
    }

    /** @param array<string, mixed> $target */
    private function assertChildIdsBelongToDraft(Layout $layout, array $target): void
    {
        $structureIds = $layout->structuralElements->pluck('id')->flip();
        $placementIds = $layout->devicePlacements->pluck('id')->flip();

        foreach (['structuralElements' => $structureIds, 'devicePlacements' => $placementIds] as $kind => $validIds) {
            foreach ($target[$kind] as $index => $child) {
                if (array_key_exists('id', $child) && ! $validIds->has((string) $child['id'])) {
                    throw ValidationException::withMessages([
                        "{$kind}.{$index}.id" => ['The selected child identifier is invalid.'],
                    ]);
                }
            }
        }
    }

    /** @param list<array<string, mixed>> $placements @return Collection<string, Device> */
    private function lockDevices(string $schoolId, array $placements): Collection
    {
        $ids = collect($placements)->pluck('deviceId')->map(fn ($id) => (string) $id)->unique()->sort()->values();
        if ($ids->isEmpty()) {
            return collect();
        }

        return Device::query()
            ->where('school_id', $schoolId)
            ->whereIn('id', $ids->all())
            ->orderBy('id')
            ->lockForUpdate()
            ->get()
            ->keyBy('id');
    }

    /** @return array<string, mixed> */
    private function currentAggregate(Layout $layout): array
    {
        return [
            'name' => $layout->name,
            'templateKey' => $layout->template_key,
            'rows' => $layout->rows,
            'columns' => $layout->columns,
            'structuralElements' => $layout->structuralElements->map($this->structureState(...))->all(),
            'devicePlacements' => $layout->devicePlacements->map($this->placementState(...))->all(),
        ];
    }

    /** @param array<string, mixed> $current @param array<string, mixed> $target */
    private function aggregatesEqual(array $current, array $target): bool
    {
        if (collect($target['structuralElements'])->contains(fn ($item) => ! array_key_exists('id', $item))
            || collect($target['devicePlacements'])->contains(fn ($item) => ! array_key_exists('id', $item))) {
            return false;
        }

        foreach (['structuralElements', 'devicePlacements'] as $children) {
            usort($current[$children], fn ($left, $right) => strcmp($left['id'], $right['id']));
            usort($target[$children], fn ($left, $right) => strcmp($left['id'], $right['id']));
        }

        return $this->canonicalize($current) === $this->canonicalize($target);
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map($this->canonicalize(...), $value);
    }

    /** @param list<array<string, mixed>> $target @return list<array<string, mixed>> */
    private function syncStructure(Layout $layout, array $target): array
    {
        /** @var EloquentCollection<string, LayoutStructuralElement> $existing */
        $existing = $layout->structuralElements->keyBy('id');
        $retained = collect($target)->pluck('id')->filter()->all();
        $changes = [];

        foreach ($existing as $id => $element) {
            if (! in_array($id, $retained, true)) {
                $changes[] = ['operation' => 'removed', 'id' => $id, 'before' => $this->structureState($element)];
                $element->delete();
            }
        }
        foreach ($target as $item) {
            if (! isset($item['id'])) {
                $element = $layout->structuralElements()->create([
                    'school_id' => $layout->school_id,
                    ...$this->structureAttributes($item),
                ]);
                $changes[] = ['operation' => 'added', 'id' => $element->id, 'after' => $this->structureState($element)];

                continue;
            }

            $element = $existing->get($item['id']);
            $before = $this->structureState($element);
            $attributes = $this->structureAttributes($item);
            if ($this->attributesDiffer($element, $attributes)) {
                $element->fill($attributes)->save();
                $changes[] = ['operation' => 'updated', 'id' => $element->id, 'before' => $before, 'after' => $this->structureState($element)];
            }
        }

        return $changes;
    }

    /** @param list<array<string, mixed>> $target @return list<array<string, mixed>> */
    private function syncPlacements(Layout $layout, array $target): array
    {
        /** @var EloquentCollection<string, LayoutDevicePlacement> $existing */
        $existing = $layout->devicePlacements->keyBy('id');
        $retained = collect($target)->pluck('id')->filter()->all();
        $events = [];

        foreach ($existing as $id => $placement) {
            if (! in_array($id, $retained, true)) {
                $before = $this->placementState($placement);
                $placement->delete();
                $events[] = $this->placementEvent('device.unplaced', $before, null);
            }
        }
        foreach ($target as $item) {
            if (! isset($item['id'])) {
                $placement = $layout->devicePlacements()->create([
                    'school_id' => $layout->school_id,
                    ...$this->placementAttributes($item),
                ]);
                $events[] = $this->placementEvent('device.placed', null, $this->placementState($placement));

                continue;
            }

            $placement = $existing->get($item['id']);
            $before = $this->placementState($placement);
            $attributes = $this->placementAttributes($item);
            if (! $this->attributesDiffer($placement, $attributes)) {
                continue;
            }

            $placement->fill($attributes)->save();
            $after = $this->placementState($placement);
            if ($before['deviceId'] !== $after['deviceId']) {
                $events[] = $this->placementEvent('device.unplaced', $before, null);
                $events[] = $this->placementEvent('device.placed', null, $after);
            } else {
                $events[] = $this->placementEvent('device.moved', $before, $after);
            }
        }

        return $events;
    }

    /** @return array<string, mixed> */
    private function placementEvent(string $eventType, ?array $before, ?array $after): array
    {
        $fields = [];
        foreach (['deviceId', 'role', 'label', 'row', 'column', 'rowSpan', 'columnSpan', 'rotation'] as $field) {
            if (($before[$field] ?? null) !== ($after[$field] ?? null)) {
                $fields[] = $field;
            }
        }

        return [
            'eventType' => $eventType,
            'changedFields' => $fields,
            'changes' => [
                'placementId' => $before['id'] ?? $after['id'],
                'deviceId' => $before['deviceId'] ?? $after['deviceId'],
                'before' => $before,
                'after' => $after,
            ],
        ];
    }

    /** @param array<string, mixed> $attributes */
    private function attributesDiffer(LayoutStructuralElement|LayoutDevicePlacement $model, array $attributes): bool
    {
        foreach ($attributes as $attribute => $value) {
            if ($model->getAttribute($attribute) !== $value) {
                return true;
            }
        }

        return false;
    }

    /** @return array<string, mixed> */
    private function rootState(Layout $layout): array
    {
        return [
            'name' => $layout->name,
            'templateKey' => $layout->template_key,
            'rows' => $layout->rows,
            'columns' => $layout->columns,
            'status' => $layout->status,
            'version' => $layout->version,
        ];
    }

    /** @return array<string, mixed> */
    private function structureState(LayoutStructuralElement $element): array
    {
        return [
            'id' => $element->id,
            'type' => $element->element_type,
            'label' => $element->label,
            'row' => $element->row,
            'column' => $element->column,
            'rowSpan' => $element->row_span,
            'columnSpan' => $element->column_span,
            'rotation' => $element->rotation,
        ];
    }

    /** @return array<string, mixed> */
    private function placementState(LayoutDevicePlacement $placement): array
    {
        return [
            'id' => $placement->id,
            'deviceId' => $placement->device_id,
            'role' => $placement->role,
            'label' => $placement->label,
            'row' => $placement->row,
            'column' => $placement->column,
            'rowSpan' => $placement->row_span,
            'columnSpan' => $placement->column_span,
            'rotation' => $placement->rotation,
        ];
    }

    /** @param array<string, mixed> $item @return array<string, mixed> */
    private function structureAttributes(array $item): array
    {
        return [
            'element_type' => $item['type'],
            'label' => $item['label'] ?? null,
            'row' => $item['row'],
            'column' => $item['column'],
            'row_span' => $item['rowSpan'],
            'column_span' => $item['columnSpan'],
            'rotation' => $item['rotation'],
        ];
    }

    /** @param array<string, mixed> $item @return array<string, mixed> */
    private function placementAttributes(array $item): array
    {
        return [
            'device_id' => $item['deviceId'],
            'role' => $item['role'] ?? null,
            'label' => $item['label'] ?? null,
            'row' => $item['row'],
            'column' => $item['column'],
            'row_span' => $item['rowSpan'],
            'column_span' => $item['columnSpan'],
            'rotation' => $item['rotation'],
        ];
    }

    /** @param list<string> $changedFields @param array<string, mixed> $changes */
    private function writeEvent(
        CurrentMembershipContext $context,
        Layout $layout,
        string $eventType,
        array $changedFields,
        array $changes,
    ): void {
        $user = $context->membership->user()->first();
        LayoutChangeEvent::query()->create([
            'school_id' => $layout->school_id,
            'layout_id' => $layout->id,
            'layout_id_snapshot' => $layout->id,
            'laboratory_id_snapshot' => $layout->laboratory_id,
            'actor_user_id' => $context->membership->user_id,
            'actor_id_snapshot' => $context->membership->user_id,
            'actor_name_snapshot' => $user?->name,
            'event_type' => $eventType,
            'changed_fields' => array_values(array_unique($changedFields)),
            'changes' => $changes,
            'created_at' => now(),
        ]);
    }

    private function optionalString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
