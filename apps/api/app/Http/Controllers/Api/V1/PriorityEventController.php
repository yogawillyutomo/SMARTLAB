<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\PriorityEvent\PriorityEventMutationService;
use App\Application\PriorityEvent\PriorityEventQueryService;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequirePriorityEventVersionPrecondition;
use App\Http\Requests\ApprovePriorityEventRequest;
use App\Http\Requests\CancelPriorityEventRequest;
use App\Http\Requests\CreatePriorityEventRequest;
use App\Http\Requests\ListPriorityEventsRequest;
use App\Http\Requests\RejectPriorityEventRequest;
use App\Http\Resources\PriorityEventResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PriorityEventController extends Controller
{
    public function index(ListPriorityEventsRequest $request, PriorityEventQueryService $service): JsonResponse
    {
        $paginator = $service->events($this->context($request), $request->validated());

        return response()->json([
            'data' => PriorityEventResource::collection($paginator->items())->resolve($request),
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

    public function store(CreatePriorityEventRequest $request, PriorityEventMutationService $service): JsonResponse
    {
        return $this->response(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $priorityEventId, PriorityEventQueryService $service): JsonResponse
    {
        return $this->response($service->event($this->context($request), $priorityEventId), $request);
    }

    public function approve(
        ApprovePriorityEventRequest $request,
        string $priorityEventId,
        PriorityEventMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->approve($this->context($request), $this->actor($request), $priorityEventId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function reject(
        RejectPriorityEventRequest $request,
        string $priorityEventId,
        PriorityEventMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->reject(
                $this->context($request),
                $this->actor($request),
                $priorityEventId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function cancel(
        CancelPriorityEventRequest $request,
        string $priorityEventId,
        PriorityEventMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->cancel(
                $this->context($request),
                $this->actor($request),
                $priorityEventId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function response($event, Request $request, int $status = 200): JsonResponse
    {
        return (new PriorityEventResource($event))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$event->version.'"');
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
        return (int) $request->attributes->get(RequirePriorityEventVersionPrecondition::ATTRIBUTE);
    }
}
