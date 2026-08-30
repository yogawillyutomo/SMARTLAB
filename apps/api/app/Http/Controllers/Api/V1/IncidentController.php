<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentQueryService;
use App\Http\Controllers\Controller;
use App\Http\Resources\IncidentResource;
use App\Models\Incident;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IncidentController extends Controller
{
    public function show(Request $request, string $incidentId, IncidentQueryService $queries): JsonResponse
    {
        $incident = $queries->find($this->context($request), $incidentId);

        return $this->incidentResponse($incident, $request);
    }

    private function incidentResponse(Incident $incident, Request $request): JsonResponse
    {
        return (new IncidentResource($incident))
            ->response($request)
            ->header('ETag', '"'.$incident->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }
}
