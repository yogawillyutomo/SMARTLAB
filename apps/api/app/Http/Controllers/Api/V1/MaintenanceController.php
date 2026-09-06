<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Maintenance\MaintenanceMutationService;
use App\Domain\Maintenance\MaintenanceDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireMaintenanceExecutionVersionPrecondition;
use App\Http\Middleware\RequireMaintenancePlanVersionPrecondition;
use App\Http\Requests\CancelMaintenanceExecutionRequest;
use App\Http\Requests\CompleteMaintenanceExecutionRequest;
use App\Http\Requests\CreateMaintenancePlanRequest;
use App\Http\Requests\EmptyMaintenanceActionRequest;
use App\Http\Requests\ListMaintenanceExecutionsRequest;
use App\Http\Requests\ListMaintenancePlansRequest;
use App\Http\Requests\ScheduleMaintenanceExecutionRequest;
use App\Http\Requests\UpdateMaintenancePlanRequest;
use App\Http\Resources\MaintenanceExecutionResource;
use App\Http\Resources\MaintenancePlanResource;
use App\Models\MaintenanceExecution;
use App\Models\MaintenancePlan;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MaintenanceController extends Controller
{
    public function plans(ListMaintenancePlansRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $context = $this->context($request);
        $query = MaintenancePlan::query()->where('school_id', $context->membership->school_id);

        if (isset($validated['status'])) $query->where('status', $validated['status']);
        if (isset($validated['assetId'])) $query->where('asset_id', $validated['assetId']);
        if ($request->has('overdue')) {
            if ($request->boolean('overdue')) {
                $query->where('status', 'active')->whereDate('next_due_date', '<', today());
            } else {
                $query->where(fn (Builder $q) => $q->where('status', '!=', 'active')->orWhereDate('next_due_date', '>=', today()));
            }
        }
        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
            $grammar = $query->getQuery()->getGrammar();
            $query->where(function (Builder $q) use ($pattern, $grammar): void {
                foreach (['plan_code', 'asset_code_snapshot', 'asset_name_snapshot', 'name', 'assigned_technician_name_snapshot'] as $index => $column) {
                    $q->whereRaw(
                        'LOWER(COALESCE('.$grammar->wrap($column).", '')) LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        $paginator = $query->orderBy('next_due_date')->orderBy('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => MaintenancePlanResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function storePlan(CreateMaintenancePlanRequest $request, MaintenanceMutationService $service): JsonResponse
    {
        return $this->planResponse(
            $service->createPlan($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function showPlan(Request $request, string $planId): JsonResponse
    {
        $plan = MaintenancePlan::query()
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($planId)
            ->first();

        if ($plan === null) throw MaintenanceDomainException::planNotFound();

        return $this->planResponse($plan, $request);
    }

    public function updatePlan(
        UpdateMaintenancePlanRequest $request,
        string $planId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->planResponse(
            $service->updatePlan(
                $this->context($request),
                $this->actor($request),
                $planId,
                $this->planVersion($request),
                $request->validated(),
            ),
            $request,
        );
    }

    public function activatePlan(
        EmptyMaintenanceActionRequest $request,
        string $planId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->planResponse(
            $service->activatePlan($this->context($request), $this->actor($request), $planId, $this->planVersion($request)),
            $request,
        );
    }

    public function deactivatePlan(
        EmptyMaintenanceActionRequest $request,
        string $planId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->planResponse(
            $service->deactivatePlan($this->context($request), $this->actor($request), $planId, $this->planVersion($request)),
            $request,
        );
    }

    public function schedule(
        ScheduleMaintenanceExecutionRequest $request,
        string $planId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->executionResponse(
            $service->scheduleExecution(
                $this->context($request),
                $this->actor($request),
                $planId,
                $this->planVersion($request),
                $request->validated(),
            ),
            $request,
            201,
        );
    }

    public function executions(ListMaintenanceExecutionsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = MaintenanceExecution::query()
            ->with('inventoryTransactions')
            ->where('school_id', $this->context($request)->membership->school_id);

        if (isset($validated['status'])) $query->where('status', $validated['status']);
        if (isset($validated['assetId'])) $query->where('asset_id', $validated['assetId']);
        if (isset($validated['maintenancePlanId'])) $query->where('maintenance_plan_id', $validated['maintenancePlanId']);
        if (isset($validated['from'])) $query->whereDate('scheduled_for', '>=', $validated['from']);
        if (isset($validated['to'])) $query->whereDate('scheduled_for', '<=', $validated['to']);

        $paginator = $query->orderByDesc('scheduled_for')->orderByDesc('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => MaintenanceExecutionResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function showExecution(Request $request, string $executionId): JsonResponse
    {
        $execution = MaintenanceExecution::query()
            ->with('inventoryTransactions')
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($executionId)
            ->first();

        if ($execution === null) throw MaintenanceDomainException::executionNotFound();

        return $this->executionResponse($execution, $request);
    }

    public function start(
        EmptyMaintenanceActionRequest $request,
        string $executionId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->executionResponse(
            $service->startExecution($this->context($request), $this->actor($request), $executionId, $this->executionVersion($request)),
            $request,
        );
    }

    public function complete(
        CompleteMaintenanceExecutionRequest $request,
        string $executionId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->executionResponse(
            $service->completeExecution(
                $this->context($request),
                $this->actor($request),
                $executionId,
                $this->executionVersion($request),
                $request->validated(),
            ),
            $request,
        );
    }

    public function cancel(
        CancelMaintenanceExecutionRequest $request,
        string $executionId,
        MaintenanceMutationService $service,
    ): JsonResponse {
        return $this->executionResponse(
            $service->cancelExecution(
                $this->context($request),
                $this->actor($request),
                $executionId,
                $this->executionVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function planResponse(MaintenancePlan $plan, Request $request, int $status = 200): JsonResponse
    {
        return (new MaintenancePlanResource($plan))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$plan->version.'"');
    }

    private function executionResponse(MaintenanceExecution $execution, Request $request, int $status = 200): JsonResponse
    {
        return (new MaintenanceExecutionResource($execution))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$execution->version.'"');
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

    private function planVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireMaintenancePlanVersionPrecondition::ATTRIBUTE);
    }

    private function executionVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireMaintenanceExecutionVersionPrecondition::ATTRIBUTE);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
