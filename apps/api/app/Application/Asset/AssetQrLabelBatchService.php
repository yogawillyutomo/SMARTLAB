<?php

namespace App\Application\Asset;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Models\Asset;
use App\Models\AssetQrIdentity;
use App\Models\AssetQrLabelBatch;
use App\Models\AssetQrLabelBatchEvent;
use App\Models\AssetQrLabelBatchItem;
use App\Models\Laboratory;
use App\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AssetQrLabelBatchService
{
    public function __construct(
        private readonly AssetQrIdentityService $qrIdentityService,
    ) {}

    /** @param array<string,mixed> $filters */
    public function candidates(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->with([
                'homeLaboratory:id,code,name',
                'qrIdentities' => fn ($query) => $query
                    ->where('status', 'active')
                    ->withCount('labelBatchItems'),
            ]);

        foreach ([
            'laboratoryId' => 'home_laboratory_id',
            'category' => 'category',
            'condition' => 'condition',
            'lifecycleStatus' => 'lifecycle_status',
        ] as $field => $column) {
            if (array_key_exists($field, $filters)) {
                $query->where($column, $filters[$field]);
            }
        }

        if (($filters['linkStatus'] ?? null) === 'linked') {
            $query->whereNotNull('linked_device_id');
        } elseif (($filters['linkStatus'] ?? null) === 'unlinked') {
            $query->whereNull('linked_device_id');
        }

        if (($filters['qrStatus'] ?? null) === 'active') {
            $query->whereHas('qrIdentities', fn (Builder $query) => $query->where('status', 'active'));
        } elseif (($filters['qrStatus'] ?? null) === 'missing') {
            $query->whereDoesntHave('qrIdentities', fn (Builder $query) => $query->where('status', 'active'));
        }

        if (($filters['printedStatus'] ?? null) === 'printed') {
            $query->whereHas('qrIdentities', fn (Builder $query) => $query
                ->where('status', 'active')
                ->whereHas('labelBatchItems'));
        } elseif (($filters['printedStatus'] ?? null) === 'unprinted') {
            $query->whereDoesntHave('qrIdentities', fn (Builder $query) => $query
                ->where('status', 'active')
                ->whereHas('labelBatchItems'));
        }

        if (isset($filters['search']) && $filters['search'] !== '') {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower((string) $filters['search'])).'%';
            $query->where(function (Builder $query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['asset_code', 'name', 'category', 'brand', 'model', 'serial_number'] as $index => $column) {
                    $query->whereRaw(
                        'LOWER('.$grammar->wrap($column).") LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        return $query
            ->orderBy('asset_code')
            ->orderBy('id')
            ->paginate((int) ($filters['perPage'] ?? 50), ['*'], 'page', (int) ($filters['page'] ?? 1));
    }

    /** @param array<string,mixed> $filters */
    public function batches(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = AssetQrLabelBatch::query()
            ->where('school_id', $context->membership->school_id);

        if (array_key_exists('laboratoryId', $filters)) {
            $query->where('laboratory_id', $filters['laboratoryId']);
        }

        return $query
            ->orderByDesc('generated_at')
            ->orderByDesc('id')
            ->paginate((int) ($filters['perPage'] ?? 25), ['*'], 'page', (int) ($filters['page'] ?? 1));
    }

    public function show(CurrentMembershipContext $context, string $batchId): AssetQrLabelBatch
    {
        return $this->batchQuery($context, $batchId)
            ->with([
                'items' => fn ($query) => $query->orderBy('ordinal'),
                'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
            ])
            ->firstOr(function (): never {
                throw new AssetDomainException('Asset QR label batch not found.', 'ASSET_QR_LABEL_BATCH_NOT_FOUND', 404);
            });
    }

    /** @param array<string,mixed> $data */
    public function generate(
        CurrentMembershipContext $context,
        User $actor,
        array $data,
    ): AssetQrLabelBatch {
        return DB::transaction(function () use ($context, $actor, $data): AssetQrLabelBatch {
            $schoolId = (string) $context->membership->school_id;
            $selection = $this->normalizeSelection((array) ($data['selection'] ?? []));
            $assetIds = collect($data['assetIds'])
                ->map(fn ($id): string => (string) $id)
                ->values();

            $assets = Asset::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $assetIds->all())
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            if ($assets->count() !== $assetIds->count()) {
                throw new AssetDomainException(
                    'One or more selected Assets were not found in the active School.',
                    'ASSET_QR_LABEL_ASSET_NOT_FOUND',
                    404,
                );
            }

            $labIds = $assets->pluck('home_laboratory_id')->filter()->unique()->sort()->values();
            if (isset($selection['laboratoryId'])) {
                $labIds->push((string) $selection['laboratoryId']);
                $labIds = $labIds->unique()->sort()->values();
            }

            $laboratories = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $labIds->all())
                ->orderBy('id')
                ->sharedLock()
                ->get()
                ->keyBy('id');

            $batchLaboratory = null;
            if (isset($selection['laboratoryId'])) {
                $batchLaboratory = $laboratories->get((string) $selection['laboratoryId']);
                if ($batchLaboratory === null || $batchLaboratory->status !== 'active') {
                    throw new AssetDomainException(
                        'Label batch Laboratory not found.',
                        'ASSET_QR_LABEL_LAB_NOT_FOUND',
                        404,
                    );
                }
            }

            $activeIdentities = AssetQrIdentity::query()
                ->where('school_id', $schoolId)
                ->whereIn('asset_id', $assetIds->all())
                ->where('status', 'active')
                ->orderBy('asset_id')
                ->lockForUpdate()
                ->get()
                ->keyBy('asset_id');

            $printedIdentityIds = AssetQrLabelBatchItem::query()
                ->where('school_id', $schoolId)
                ->whereIn('asset_qr_identity_id', $activeIdentities->pluck('id')->all())
                ->pluck('asset_qr_identity_id')
                ->map(fn ($id): string => (string) $id)
                ->flip();

            foreach ($assets as $asset) {
                $identity = $activeIdentities->get($asset->id);
                $printed = $identity !== null && $printedIdentityIds->has((string) $identity->id);
                $this->assertSelectionStillMatches($asset, $selection, $identity, $printed);
            }

            $requiresQrIssue = $assets->contains(
                fn (Asset $asset): bool => ! $activeIdentities->has($asset->id),
            );
            if ($requiresQrIssue && ! $context->permissions->contains('assets.manage-qr')) {
                throw new AssetDomainException(
                    'You do not have permission to issue missing Asset QR identities.',
                    'FORBIDDEN',
                    403,
                );
            }

            $autoIssuedCount = 0;
            foreach ($assets as $asset) {
                if ($activeIdentities->has($asset->id)) {
                    continue;
                }

                $identity = $this->qrIdentityService->issue($context, $actor, (string) $asset->id);
                $activeIdentities->put($asset->id, $identity);
                $autoIssuedCount++;
            }

            $orderedAssets = $assets
                ->sortBy(fn (Asset $asset): string => $asset->asset_code.'|'.$asset->id)
                ->values();
            $now = now();

            $batch = AssetQrLabelBatch::query()->create([
                'school_id' => $schoolId,
                'laboratory_id' => $batchLaboratory?->id,
                'laboratory_code_snapshot' => $batchLaboratory?->code,
                'laboratory_name_snapshot' => $batchLaboratory?->name,
                'template_key' => (string) $data['templateKey'],
                'filters' => (object) $selection,
                'asset_count' => $orderedAssets->count(),
                'generated_by_user_id' => $actor->id,
                'generated_by_membership_id' => $context->membership->id,
                'generated_by_user_id_snapshot' => $actor->id,
                'generated_by_membership_id_snapshot' => $context->membership->id,
                'generated_by_name_snapshot' => $actor->name,
                'generated_at' => $now,
            ]);

            foreach ($orderedAssets as $index => $asset) {
                $identity = $activeIdentities->get($asset->id);
                $laboratory = $asset->home_laboratory_id === null
                    ? null
                    : $laboratories->get($asset->home_laboratory_id);

                if ($asset->home_laboratory_id !== null && $laboratory === null) {
                    throw new AssetDomainException(
                        'Asset Laboratory changed while generating labels.',
                        'ASSET_QR_LABEL_SELECTION_STALE',
                        409,
                    );
                }

                AssetQrLabelBatchItem::query()->create([
                    'school_id' => $schoolId,
                    'asset_qr_label_batch_id' => $batch->id,
                    'asset_id' => $asset->id,
                    'asset_qr_identity_id' => $identity->id,
                    'ordinal' => $index + 1,
                    'asset_code_snapshot' => $asset->asset_code,
                    'asset_name_snapshot' => $asset->name,
                    'laboratory_id_snapshot' => $asset->home_laboratory_id,
                    'laboratory_code_snapshot' => $laboratory?->code,
                    'laboratory_name_snapshot' => $laboratory?->name,
                    'public_id_snapshot' => $identity->public_id,
                    'token_version_snapshot' => $identity->token_version,
                    'created_at' => $now,
                ]);
            }

            AssetQrLabelBatchEvent::query()->create([
                'school_id' => $schoolId,
                'asset_qr_label_batch_id' => $batch->id,
                'event_type' => 'generated',
                'actor_user_id' => $actor->id,
                'actor_membership_id' => $context->membership->id,
                'actor_user_id_snapshot' => $actor->id,
                'actor_membership_id_snapshot' => $context->membership->id,
                'actor_name_snapshot' => $actor->name,
                'payload' => [
                    'assetCount' => $orderedAssets->count(),
                    'templateKey' => (string) $data['templateKey'],
                    'autoIssuedQrCount' => $autoIssuedCount,
                ],
                'created_at' => $now,
            ]);

            return $this->show($context, (string) $batch->id);
        });
    }

    public function reprint(
        CurrentMembershipContext $context,
        User $actor,
        string $batchId,
        string $reason,
    ): AssetQrLabelBatch {
        return DB::transaction(function () use ($context, $actor, $batchId, $reason): AssetQrLabelBatch {
            $schoolId = (string) $context->membership->school_id;
            $batch = $this->batchQuery($context, $batchId)
                ->lockForUpdate()
                ->first();

            if ($batch === null) {
                throw new AssetDomainException('Asset QR label batch not found.', 'ASSET_QR_LABEL_BATCH_NOT_FOUND', 404);
            }

            $items = AssetQrLabelBatchItem::query()
                ->where('school_id', $schoolId)
                ->where('asset_qr_label_batch_id', $batch->id)
                ->orderBy('ordinal')
                ->get();

            if ($items->count() !== $batch->asset_count) {
                throw new AssetDomainException(
                    'Asset QR label batch evidence is incomplete.',
                    'ASSET_QR_LABEL_BATCH_STALE',
                    409,
                );
            }

            $assets = Asset::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $items->pluck('asset_id')->all())
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $labIds = $items->pluck('laboratory_id_snapshot')->filter()->unique()->sort()->values();
            $laboratories = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $labIds->all())
                ->orderBy('id')
                ->sharedLock()
                ->get()
                ->keyBy('id');

            $identities = AssetQrIdentity::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $items->pluck('asset_qr_identity_id')->all())
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            foreach ($items as $item) {
                $asset = $assets->get($item->asset_id);
                $identity = $identities->get($item->asset_qr_identity_id);
                $laboratory = $item->laboratory_id_snapshot === null
                    ? null
                    : $laboratories->get($item->laboratory_id_snapshot);

                $fresh = $asset !== null
                    && $identity !== null
                    && $identity->status === 'active'
                    && (string) $identity->asset_id === (string) $asset->id
                    && (string) $identity->public_id === (string) $item->public_id_snapshot
                    && $identity->token_version === $item->token_version_snapshot
                    && $asset->asset_code === $item->asset_code_snapshot
                    && $asset->name === $item->asset_name_snapshot
                    && (string) ($asset->home_laboratory_id ?? '') === (string) ($item->laboratory_id_snapshot ?? '')
                    && ($item->laboratory_id_snapshot === null || (
                        $laboratory !== null
                        && $laboratory->code === $item->laboratory_code_snapshot
                        && $laboratory->name === $item->laboratory_name_snapshot
                    ));

                if (! $fresh) {
                    throw new AssetDomainException(
                        'Asset QR label batch is stale. Generate a new batch from current Asset and QR authority.',
                        'ASSET_QR_LABEL_BATCH_STALE',
                        409,
                    );
                }
            }

            AssetQrLabelBatchEvent::query()->create([
                'school_id' => $schoolId,
                'asset_qr_label_batch_id' => $batch->id,
                'event_type' => 'reprinted',
                'actor_user_id' => $actor->id,
                'actor_membership_id' => $context->membership->id,
                'actor_user_id_snapshot' => $actor->id,
                'actor_membership_id_snapshot' => $context->membership->id,
                'actor_name_snapshot' => $actor->name,
                'payload' => [
                    'reason' => trim($reason),
                    'assetCount' => $batch->asset_count,
                    'templateKey' => $batch->template_key,
                ],
                'created_at' => now(),
            ]);

            return $this->show($context, (string) $batch->id);
        });
    }

    private function batchQuery(CurrentMembershipContext $context, string $batchId): Builder
    {
        return AssetQrLabelBatch::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($batchId);
    }

    /** @param array<string,mixed> $selection @return array<string,mixed> */
    private function normalizeSelection(array $selection): array
    {
        return collect($selection)
            ->reject(fn ($value): bool => $value === null || $value === '')
            ->all();
    }

    /** @param array<string,mixed> $selection */
    private function assertSelectionStillMatches(
        Asset $asset,
        array $selection,
        ?AssetQrIdentity $identity,
        bool $printed,
    ): void {
        $matches = true;

        foreach ([
            'laboratoryId' => $asset->home_laboratory_id,
            'category' => $asset->category,
            'condition' => $asset->condition,
            'lifecycleStatus' => $asset->lifecycle_status,
        ] as $field => $actual) {
            if (isset($selection[$field]) && (string) $selection[$field] !== (string) $actual) {
                $matches = false;
            }
        }

        if (($selection['linkStatus'] ?? null) === 'linked' && $asset->linked_device_id === null) {
            $matches = false;
        }
        if (($selection['linkStatus'] ?? null) === 'unlinked' && $asset->linked_device_id !== null) {
            $matches = false;
        }
        if (($selection['qrStatus'] ?? null) === 'active' && $identity === null) {
            $matches = false;
        }
        if (($selection['qrStatus'] ?? null) === 'missing' && $identity !== null) {
            $matches = false;
        }
        if (($selection['printedStatus'] ?? null) === 'printed' && ! $printed) {
            $matches = false;
        }
        if (($selection['printedStatus'] ?? null) === 'unprinted' && $printed) {
            $matches = false;
        }

        if (isset($selection['search'])) {
            $needle = mb_strtolower((string) $selection['search']);
            $haystack = mb_strtolower(implode(' ', array_filter([
                $asset->asset_code,
                $asset->name,
                $asset->category,
                $asset->brand,
                $asset->model,
                $asset->serial_number,
            ], fn ($value): bool => is_string($value) && $value !== '')));
            if (! str_contains($haystack, $needle)) {
                $matches = false;
            }
        }

        if (! $matches) {
            throw new AssetDomainException(
                'Selected Asset no longer matches the recorded label filters.',
                'ASSET_QR_LABEL_SELECTION_STALE',
                409,
            );
        }
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
