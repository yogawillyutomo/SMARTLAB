<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\WorkOrder\WorkOrderMutationService;
use App\Domain\WorkOrder\WorkOrderDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireWorkOrderVersionPrecondition;
use App\Http\Requests\AssignWorkOrderRequest;
use App\Http\Requests\CompleteWorkOrderRequest;
use App\Http\Requests\CreateWorkOrderRequest;
use App\Http\Requests\EmptyWorkOrderActionRequest;
use App\Http\Requests\ListWorkOrdersRequest;
use App\Http\Requests\UpdateWorkOrderRequest;
use App\Http\Requests\WorkOrderReasonRequest;
use App\Http\Resources\WorkOrderEventResource;
use App\Http\Resources\WorkOrderResource;
use App\Models\User;
use App\Models\WorkOrder;
use App\Models\WorkOrderEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WorkOrderController extends Controller
{
    public function index(ListWorkOrdersRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $context = $this->context($request);
        $query = WorkOrder::query()->where('school_id', $context->membership->school_id);

        foreach ([
            'status' => 'status',
            'assetId' => 'asset_id',
            'incidentId' => 'incident_id',
            'laboratoryId' => 'laboratory_id',
            'assigneeMembershipId' => 'assignee_membership_id',
        ] as $input => $column) {
            if (isset($validated[$input])) {
                $query->where($column, $validated[$input]);
            }
        }

        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower((string) $validated['search'])).'%';
            $query->where(function ($query) use ($pattern): void {
                $grammar = $query->getQuery()->getGrammar();
                foreach (['work_order_number', 'problem_summary', 'asset_code_snapshot', 'asset_name_snapshot', 'assignee_name_snapshot'] as $index => $column) {
                    $query->whereRaw(
                        'LOWER(COALESCE('.$grammar->wrap($column).", '')) LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        $paginator = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => WorkOrderResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateWorkOrderRequest $request, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $workOrderId): JsonResponse
    {
        $workOrder = WorkOrder::query()
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($workOrderId)
            ->first();

        if ($workOrder === null) {
            throw WorkOrderDomainException::notFound();
        }

        return $this->workOrderResponse($workOrder, $request);
    }

    public function update(UpdateWorkOrderRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->update($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), $request->validated()),
            $request,
        );
    }

    public function history(Request $request, string $workOrderId): JsonResponse
    {
        $context = $this->context($request);
        if (! WorkOrder::query()->where('school_id', $context->membership->school_id)->whereKey($workOrderId)->exists()) {
            throw WorkOrderDomainException::notFound();
        }

        $events = WorkOrderEvent::query()
            ->where('school_id', $context->membership->school_id)
            ->where('work_order_id', $workOrderId)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        return response()->json(['data' => WorkOrderEventResource::collection($events)->resolve($request)]);
    }

    public function assign(AssignWorkOrderRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->assign(
                $this->context($request),
                $this->actor($request),
                $workOrderId,
                $this->expectedVersion($request),
                (string) $request->validated('assigneeMembershipId'),
                $request->validated('reason'),
            ),
            $request,
        );
    }

    public function start(EmptyWorkOrderActionRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->start($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function hold(WorkOrderReasonRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->hold($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), (string) $request->validated('reason')),
            $request,
        );
    }

    public function waitingPart(WorkOrderReasonRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->waitingPart($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), (string) $request->validated('reason')),
            $request,
        );
    }

    public function resume(EmptyWorkOrderActionRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->resume($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function complete(CompleteWorkOrderRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->complete($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), $request->validated()),
            $request,
        );
    }

    public function rework(WorkOrderReasonRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->rework($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), (string) $request->validated('reason')),
            $request,
        );
    }

    public function cancel(WorkOrderReasonRequest $request, string $workOrderId, WorkOrderMutationService $service): JsonResponse
    {
        return $this->workOrderResponse(
            $service->cancel($this->context($request), $this->actor($request), $workOrderId, $this->expectedVersion($request), (string) $request->validated('reason')),
            $request,
        );
    }

    private function workOrderResponse(WorkOrder $workOrder, Request $request, int $status = 200): JsonResponse
    {
        return (new WorkOrderResource($workOrder))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$workOrder->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);
        return $context;
    }

    private function actor(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();
        return $user;
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireWorkOrderVersionPrecondition::ATTRIBUTE);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
