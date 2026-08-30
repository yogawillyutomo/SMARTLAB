<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentListQueryService;
use App\Application\Incident\IncidentQueryService;
use App\Application\Incident\IncidentReportingContextQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\ListIncidentReportingDevicesRequest;
use App\Http\Requests\ListIncidentReportingLaboratoriesRequest;
use App\Http\Requests\ListIncidentsRequest;
use App\Http\Resources\IncidentReportingDeviceResource;
use App\Http\Resources\IncidentReportingLaboratoryResource;
use App\Http\Resources\IncidentResource;
use App\Http\Resources\IncidentSummaryResource;
use App\Models\Incident;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IncidentController extends Controller
{
    public function index(ListIncidentsRequest $request, IncidentListQueryService $queries): JsonResponse
    {
        $paginator = $queries->list($this->context($request), $request->validated());

        return response()->json([
            'data' => IncidentSummaryResource::collection($paginator->items())->resolve($request),
            'meta' => $this->paginationMeta($paginator),
        ]);
    }

    public function reportingLaboratories(
        ListIncidentReportingLaboratoriesRequest $request,
        IncidentReportingContextQueryService $queries,
    ): JsonResponse {
        $paginator = $queries->laboratories($this->context($request), $request->validated());

        return response()->json([
            'data' => IncidentReportingLaboratoryResource::collection($paginator->items())->resolve($request),
            'meta' => $this->paginationMeta($paginator),
        ]);
    }

    public function reportingDevices(
        ListIncidentReportingDevicesRequest $request,
        string $laboratoryId,
        IncidentReportingContextQueryService $queries,
    ): JsonResponse {
        $result = $queries->devices($this->context($request), $laboratoryId, $request->validated());

        return response()->json([
            'data' => IncidentReportingDeviceResource::collection($result['devices'])->resolve($request),
            'meta' => ['hasMore' => $result['hasMore']],
        ]);
    }

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

    /** @return array{page: int, perPage: int, total: int, lastPage: int} */
    private function paginationMeta($paginator): array
    {
        return [
            'page' => $paginator->currentPage(),
            'perPage' => $paginator->perPage(),
            'total' => $paginator->total(),
            'lastPage' => $paginator->lastPage(),
        ];
    }
}
