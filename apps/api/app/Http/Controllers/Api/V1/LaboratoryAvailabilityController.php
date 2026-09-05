<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Availability\LaboratoryAvailabilityQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Requests\CheckLaboratoryAvailabilityRequest;
use Illuminate\Http\JsonResponse;

class LaboratoryAvailabilityController extends Controller
{
    public function __invoke(
        CheckLaboratoryAvailabilityRequest $request,
        LaboratoryAvailabilityQueryService $service,
    ): JsonResponse {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return response()->json([
            'data' => $service->check($context, $request->validated()),
        ]);
    }
}
