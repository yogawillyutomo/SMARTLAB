<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Session\SessionIssueObservationService;
use App\Http\Controllers\Controller;
use App\Http\Requests\CreateSessionIssueObservationRequest;
use App\Http\Requests\PromoteSessionIssueObservationRequest;
use App\Http\Resources\SessionIssueObservationResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SessionIssueObservationController extends Controller
{
    public function index(Request $request, string $sessionId, SessionIssueObservationService $service): JsonResponse
    {
        $items = $service->list($this->context($request), $sessionId);

        return response()->json([
            'data' => SessionIssueObservationResource::collection($items)->resolve($request),
        ]);
    }

    public function store(
        CreateSessionIssueObservationRequest $request,
        string $sessionId,
        SessionIssueObservationService $service,
    ): JsonResponse {
        $observation = $service->create(
            $this->context($request),
            $this->actor($request),
            $sessionId,
            $request->validated(),
        );

        return (new SessionIssueObservationResource($observation))
            ->response($request)
            ->setStatusCode(201);
    }

    public function promote(
        PromoteSessionIssueObservationRequest $request,
        string $observationId,
        SessionIssueObservationService $service,
        IncidentCreationService $incidents,
    ): JsonResponse {
        $observation = $service->promote(
            $this->context($request),
            $this->actor($request),
            $observationId,
            $request->validated(),
            $incidents,
        );

        return (new SessionIssueObservationResource($observation))->response($request);
    }

    private function context(Request $request): CurrentMembershipContext
    {
        return $request->attributes->get(CurrentMembershipContext::class);
    }

    private function actor(Request $request): User
    {
        return $request->user();
    }
}
