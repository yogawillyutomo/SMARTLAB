<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetQrIdentityService;
use App\Http\Controllers\Controller;
use App\Http\Resources\PublicAssetQrResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PublicAssetQrController extends Controller
{
    public function __invoke(
        Request $request,
        string $publicId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        return (new PublicAssetQrResource($service->resolvePublic($publicId)))
            ->response($request);
    }
}
