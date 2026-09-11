<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Asset\AssetQrIdentityService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AuthenticatedAssetQrController extends Controller
{
    public function __invoke(
        Request $request,
        string $publicId,
        AssetQrIdentityService $service,
    ): JsonResponse {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);
        $identity = $service->resolvePublic($publicId);

        if ((string) $identity->school_id !== (string) $context->membership->school_id) {
            throw new AssetDomainException('Asset QR not found.', 'ASSET_QR_NOT_FOUND', 404);
        }

        return response()->json([
            'data' => [
                'assetId' => (string) $identity->asset_id,
            ],
        ]);
    }
}
