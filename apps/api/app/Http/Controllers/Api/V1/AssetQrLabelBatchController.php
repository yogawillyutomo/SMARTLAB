<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetQrLabelBatchService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Requests\CreateAssetQrLabelBatchRequest;
use App\Http\Requests\ListAssetQrLabelBatchesRequest;
use App\Http\Requests\ListAssetQrLabelCandidatesRequest;
use App\Http\Requests\ReprintAssetQrLabelBatchRequest;
use App\Http\Resources\AssetQrLabelBatchResource;
use App\Http\Resources\AssetQrLabelCandidateResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AssetQrLabelBatchController extends Controller
{
    public function candidates(
        ListAssetQrLabelCandidatesRequest $request,
        AssetQrLabelBatchService $service,
    ): JsonResponse {
        $paginator = $service->candidates($this->context($request), $request->validated());

        return response()->json([
            'data' => AssetQrLabelCandidateResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function index(
        ListAssetQrLabelBatchesRequest $request,
        AssetQrLabelBatchService $service,
    ): JsonResponse {
        $paginator = $service->batches($this->context($request), $request->validated());

        return response()->json([
            'data' => AssetQrLabelBatchResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(
        CreateAssetQrLabelBatchRequest $request,
        AssetQrLabelBatchService $service,
    ): JsonResponse {
        return (new AssetQrLabelBatchResource($service->generate(
            $this->context($request),
            $request->user(),
            $request->validated(),
        )))
            ->response($request)
            ->setStatusCode(201);
    }

    public function show(
        Request $request,
        string $batchId,
        AssetQrLabelBatchService $service,
    ): JsonResponse {
        return (new AssetQrLabelBatchResource($service->show($this->context($request), $batchId)))
            ->response($request);
    }

    public function reprint(
        ReprintAssetQrLabelBatchRequest $request,
        string $batchId,
        AssetQrLabelBatchService $service,
    ): JsonResponse {
        return (new AssetQrLabelBatchResource($service->reprint(
            $this->context($request),
            $request->user(),
            $batchId,
            (string) $request->validated('reason'),
        )))
            ->response($request);
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }
}
