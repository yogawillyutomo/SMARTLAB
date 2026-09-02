<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentEventQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\ListIncidentEventsRequest;
use App\Http\Resources\IncidentEventResource;
use Illuminate\Http\JsonResponse;

class IncidentEventController extends Controller
{
    public function index(
        ListIncidentEventsRequest $request,
        string $incidentId,
        IncidentEventQueryService $events,
    ): JsonResponse {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);
        $paginator = $events->list($context, $incidentId, $request->validated());

        return response()->json([
            'data' => IncidentEventResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }
}
