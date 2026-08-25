<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\DeviceTransfer\DeviceTransferMutationService;
use App\Application\DeviceTransfer\DeviceTransferQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Requests\CreateDeviceTransferRequest;
use App\Http\Requests\ListDeviceTransfersRequest;
use App\Http\Resources\DeviceTransferResource;
use Illuminate\Http\JsonResponse;

class DeviceTransferController
{
    public function store(
        CreateDeviceTransferRequest $request,
        string $deviceId,
        DeviceTransferMutationService $service,
    ): JsonResponse {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);
        $transfer = $service->transfer(
            $context,
            $deviceId,
            (int) $request->attributes->get('device_expected_version'),
            $request->validated(),
        );

        return (new DeviceTransferResource($transfer))
            ->response()
            ->setStatusCode(201)
            ->header('ETag', '"'.$transfer->device_version_after.'"');
    }

    public function index(
        ListDeviceTransfersRequest $request,
        string $deviceId,
        DeviceTransferQueryService $service,
    ): JsonResponse {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);
        $page = $service->history($context, $deviceId, $request->validated());

        return response()->json([
            'data' => DeviceTransferResource::collection($page->getCollection())->resolve(),
            'meta' => [
                'page' => $page->currentPage(),
                'perPage' => $page->perPage(),
                'total' => $page->total(),
                'lastPage' => $page->lastPage(),
            ],
        ]);
    }
}
