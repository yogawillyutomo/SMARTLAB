<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetQrIdentityService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Requests\AssetReasonRequest;
use App\Http\Middleware\RequireAssetQrTokenVersionPrecondition;
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
            ->setStatusCode(201)
            ->header('ETag', '"'.$identity->token_version.'"');
    }

    public function rotate(
        AssetReasonRequest $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        $identity = $service->rotate(
            $this->context($request),
            $request->user(),
            $assetId,
            $this->expectedTokenVersion($request),
            (string) $request->validated('reason'),
        );

        return (new AssetQrIdentityResource($identity))
            ->response($request)
            ->setStatusCode(201)
            ->header('ETag', '"'.$identity->token_version.'"');
    }

    public function revoke(
        AssetReasonRequest $request,
        string $assetId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        $identity = $service->revoke(
            $this->context($request),
            $request->user(),
            $assetId,
            $this->expectedTokenVersion($request),
            (string) $request->validated('reason'),
        );

        return (new AssetQrIdentityResource($identity))
            ->response($request)
            ->header('ETag', '"'.$identity->token_version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function expectedTokenVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireAssetQrTokenVersionPrecondition::ATTRIBUTE);
    }
}
