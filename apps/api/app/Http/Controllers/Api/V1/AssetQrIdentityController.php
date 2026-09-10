<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetQrIdentityService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Requests\AssetReasonRequest;
use App\Http\Resources\AssetQrIdentityResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AssetQrIdentityController extends Controller
{
    public function index(
        Request $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        return response()->json([
            'data' => AssetQrIdentityResource::collection(
                $service->history($this->context($request), $assetId),
            )->resolve($request),
        ]);
    }

    public function store(
        Request $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        $identity = $service->issue(
            $this->context($request),
            $request->user(),
            $assetId,
        );

        return (new AssetQrIdentityResource($identity))
            ->response($request)
            ->setStatusCode(201);
    }

    public function rotate(
        AssetReasonRequest $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        return (new AssetQrIdentityResource($service->rotate(
            $this->context($request),
            $request->user(),
            $assetId,
            (string) $request->validated('reason'),
        )))->response($request);
    }

    public function revoke(
        AssetReasonRequest $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        return (new AssetQrIdentityResource($service->revoke(
            $this->context($request),
            $request->user(),
            $assetId,
            (string) $request->validated('reason'),
        )))->response($request);
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }
}
