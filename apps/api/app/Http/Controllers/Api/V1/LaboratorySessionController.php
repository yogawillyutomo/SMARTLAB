<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Session\LaboratorySessionMutationService;
use App\Application\Session\LaboratorySessionQueryService;
use App\Application\Session\LaboratorySessionSourceQueryService;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireLaboratorySessionVersionPrecondition;
use App\Http\Requests\CancelLaboratorySessionRequest;
use App\Http\Requests\EndLaboratorySessionRequest;
use App\Http\Requests\ListLaboratorySessionsRequest;
use App\Http\Requests\ListLaboratorySessionSourcesRequest;
use App\Http\Requests\PrepareLaboratorySessionRequest;
use App\Http\Requests\StartLaboratorySessionRequest;
use App\Http\Resources\LaboratorySessionResource;
use App\Models\LaboratorySession;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LaboratorySessionController extends Controller
{
    public function index(ListLaboratorySessionsRequest $request, LaboratorySessionQueryService $service): JsonResponse
    {
        $paginator = $service->sessions($this->context($request), $request->validated());

        return response()->json([
            'data' => LaboratorySessionResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
                'from' => $request->validated('from'),
                'to' => $request->validated('to'),
            ],
        ]);
    }

    public function sources(ListLaboratorySessionSourcesRequest $request, LaboratorySessionSourceQueryService $service): JsonResponse
    {
        $filters = $request->validated();
        $data = $service->sources($this->context($request), $filters);

        return response()->json([
            'data' => $data,
            'meta' => [
                'from' => $filters['from'],
                'to' => $filters['to'],
                'scope' => $filters['scope'] ?? ($this->context($request)->permissions->contains('sessions.view-all') ? 'all' : 'mine'),
                'count' => count($data),
            ],
        ]);
    }

    public function store(PrepareLaboratorySessionRequest $request, LaboratorySessionMutationService $service): JsonResponse
    {
        return $this->response(
            $service->prepare($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $sessionId, LaboratorySessionQueryService $service): JsonResponse
    {
        return $this->response($service->session($this->context($request), $sessionId), $request);
    }

    public function start(
        StartLaboratorySessionRequest $request,
        string $sessionId,
        LaboratorySessionMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->start($this->context($request), $this->actor($request), $sessionId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function end(
        EndLaboratorySessionRequest $request,
        string $sessionId,
        LaboratorySessionMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->end(
                $this->context($request),
                $this->actor($request),
                $sessionId,
                $this->expectedVersion($request),
                $request->validated(),
            ),
            $request,
        );
    }

    public function cancel(
        CancelLaboratorySessionRequest $request,
        string $sessionId,
        LaboratorySessionMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->cancel(
                $this->context($request),
                $this->actor($request),
                $sessionId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function response(LaboratorySession $session, Request $request, int $status = 200): JsonResponse
    {
        return (new LaboratorySessionResource($session))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$session->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        return $request->attributes->get(CurrentMembershipContext::class);
    }

    private function actor(Request $request): User
    {
        return $request->user();
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireLaboratorySessionVersionPrecondition::ATTRIBUTE);
    }
}
