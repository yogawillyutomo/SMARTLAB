<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCorrectionService;
use App\Application\Incident\IncidentCreationService;
use App\Application\Incident\IncidentListQueryService;
use App\Application\Incident\IncidentQueryService;
use App\Application\Incident\IncidentReportingContextQueryService;
use App\Application\Incident\IncidentSubmissionQueryService;
use App\Domain\Incident\IncidentCorrectionPayloadNormalizer;
use App\Domain\Incident\IncidentCreatePayloadValidationException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireIncidentVersionPrecondition;
use App\Http\Requests\CreateIncidentRequest;
use App\Http\Requests\ListIncidentReportingDevicesRequest;
use App\Http\Requests\ListIncidentReportingLaboratoriesRequest;
use App\Http\Requests\ListIncidentsRequest;
use App\Http\Requests\UpdateIncidentRequest;
use App\Http\Resources\IncidentReportingDeviceResource;
use App\Http\Resources\IncidentReportingLaboratoryResource;
use App\Http\Resources\IncidentResource;
use App\Http\Resources\IncidentSummaryResource;
use App\Models\Incident;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

class IncidentController extends Controller
{
    public function store(
        CreateIncidentRequest $request,
        IncidentCreationService $creation,
        IncidentQueryService $queries,
    ): JsonResponse {
        $context = $this->context($request);

        try {
            $result = $creation->create(
                $context,
                (string) $request->validated('submissionId'),
                $request->businessPayload(),
            );
        } catch (IncidentCreatePayloadValidationException $exception) {
            throw ValidationException::withMessages(['payload' => $exception->getMessage()]);
        }

        $incident = $queries->find($context, (string) $result->incident->id);

        return $this->incidentResponse($incident, $request, $result->wasExistingSubmission ? 200 : 201);
    }

    public function submission(
        Request $request,
        string $submissionId,
        IncidentSubmissionQueryService $queries,
    ): JsonResponse {
        $incident = $queries->find($this->context($request), $submissionId);

        return $this->incidentResponse($incident, $request);
    }

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

    public function update(
        UpdateIncidentRequest $request,
        string $incidentId,
        IncidentCorrectionPayloadNormalizer $normalizer,
        IncidentCorrectionService $corrections,
        IncidentQueryService $queries,
    ): JsonResponse {
        try {
            $payload = $normalizer->normalize($request->businessPayload(), CarbonImmutable::now('UTC'));
        } catch (InvalidArgumentException $exception) {
            throw ValidationException::withMessages(['payload' => $exception->getMessage()]);
        }

        $corrections->correct(
            $this->context($request),
            $incidentId,
            (int) $request->attributes->get(RequireIncidentVersionPrecondition::ATTRIBUTE),
            $payload,
        );
        $incident = $queries->find($this->context($request), $incidentId);

        return $this->incidentResponse($incident, $request);
    }

    private function incidentResponse(Incident $incident, Request $request, int $status = 200): JsonResponse
    {
        return (new IncidentResource($incident))
            ->response($request)
            ->setStatusCode($status)
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
