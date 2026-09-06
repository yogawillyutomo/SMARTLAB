<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireAssetVersionPrecondition;
use App\Http\Requests\AssetReasonRequest;
use App\Http\Requests\CreateAssetRequest;
use App\Http\Requests\LinkAssetDeviceRequest;
use App\Http\Requests\ListAssetsRequest;
use App\Http\Requests\UpdateAssetRequest;
use App\Http\Resources\AssetResource;
use App\Models\Asset;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AssetController extends Controller
{
    public function index(ListAssetsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = Asset::query()->where('school_id', $this->context($request)->membership->school_id);

        foreach ([
            'homeLaboratoryId' => 'home_laboratory_id',
            'condition' => 'condition',
            'lifecycleStatus' => 'lifecycle_status',
            'linkedDeviceId' => 'linked_device_id',
        ] as $field => $column) {
            if (array_key_exists($field, $validated)) {
                $query->where($column, $validated[$field]);
            }
        }

        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
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

        $paginator = $query
            ->orderBy('asset_code')
            ->orderBy('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => AssetResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateAssetRequest $request, AssetMutationService $service): JsonResponse
    {
        return $this->assetResponse(
            $service->create($this->context($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $assetId): JsonResponse
    {
        $asset = Asset::query()
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($assetId)
            ->first();

        if ($asset === null) {
            throw new AssetDomainException('Asset not found.', 'ASSET_NOT_FOUND', 404);
        }

        return $this->assetResponse($asset, $request);
    }

    public function update(UpdateAssetRequest $request, string $assetId, AssetMutationService $service): JsonResponse
    {
        return $this->assetResponse(
            $service->update(
                $this->context($request),
                $assetId,
                $this->expectedVersion($request),
                $request->validated(),
            ),
            $request,
        );
    }

    public function linkDevice(
        LinkAssetDeviceRequest $request,
        string $assetId,
        AssetMutationService $service,
    ): JsonResponse {
        return $this->assetResponse(
            $service->linkDevice(
                $this->context($request),
                $assetId,
                $this->expectedVersion($request),
                (string) $request->validated('deviceId'),
            ),
            $request,
        );
    }

    public function unlinkDevice(
        AssetReasonRequest $request,
        string $assetId,
        AssetMutationService $service,
    ): JsonResponse {
        return $this->assetResponse(
            $service->unlinkDevice(
                $this->context($request),
                $assetId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function retire(
        AssetReasonRequest $request,
        string $assetId,
        AssetMutationService $service,
    ): JsonResponse {
        return $this->assetResponse(
            $service->retire(
                $this->context($request),
                $assetId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function dispose(
        AssetReasonRequest $request,
        string $assetId,
        AssetMutationService $service,
    ): JsonResponse {
        return $this->assetResponse(
            $service->dispose(
                $this->context($request),
                $assetId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function assetResponse(Asset $asset, Request $request, int $status = 200): JsonResponse
    {
        return (new AssetResource($asset))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$asset->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireAssetVersionPrecondition::ATTRIBUTE);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
