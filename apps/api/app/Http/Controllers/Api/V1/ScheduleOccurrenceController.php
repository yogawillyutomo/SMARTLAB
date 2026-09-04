<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Schedule\ScheduleOccurrenceQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\ListScheduleOccurrencesRequest;
use App\Http\Resources\ScheduleOccurrenceResource;
use Illuminate\Http\JsonResponse;

class ScheduleOccurrenceController extends Controller
{
    public function index(
        ListScheduleOccurrencesRequest $request,
        ScheduleOccurrenceQueryService $service,
    ): JsonResponse {
        $context = $request->attributes->get(CurrentMembershipContext::class);
        /** @var CurrentMembershipContext $context */

        $result = $service->currentPlan($context, $request->validated());
        $paginator = $result['paginator'];

        return response()->json([
            'data' => ScheduleOccurrenceResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
                'from' => $request->validated('from'),
                'to' => $request->validated('to'),
                'activePublicationCount' => $result['activePublicationCount'],
            ],
        ]);
    }
}
