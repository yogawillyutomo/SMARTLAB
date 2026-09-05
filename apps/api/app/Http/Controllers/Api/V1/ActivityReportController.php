<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\ActivityReport\ActivityReportMutationService;
use App\Application\ActivityReport\ActivityReportQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireActivityReportVersionPrecondition;
use App\Http\Requests\CreateActivityReportBackfillRequest;
use App\Http\Requests\EmptyActivityReportMutationRequest;
use App\Http\Requests\ListActivityReportsRequest;
use App\Http\Requests\RequestActivityReportRevisionRequest;
use App\Http\Requests\UpdateActivityReportRequest;
use App\Http\Resources\ActivityReportResource;
use App\Models\ActivityReport;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ActivityReportController extends Controller
{
    public function index(ListActivityReportsRequest $request, ActivityReportQueryService $service): JsonResponse
    {
        $paginator = $service->reports($this->context($request), $request->validated());

        return response()->json([
            'data' => ActivityReportResource::collection($paginator->items())->resolve($request),
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

    public function show(Request $request, string $reportId, ActivityReportQueryService $service): JsonResponse
    {
        return $this->response($service->report($this->context($request), $reportId), $request);
    }

    public function backfill(
        CreateActivityReportBackfillRequest $request,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->createBackfill($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function update(
        UpdateActivityReportRequest $request,
        string $reportId,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->update(
                $this->context($request),
                $this->actor($request),
                $reportId,
                $this->expectedVersion($request),
                $request->validated(),
            ),
            $request,
        );
    }

    public function submit(
        EmptyActivityReportMutationRequest $request,
        string $reportId,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->submit($this->context($request), $this->actor($request), $reportId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function requestRevision(
        RequestActivityReportRevisionRequest $request,
        string $reportId,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->requestRevision(
                $this->context($request),
                $this->actor($request),
                $reportId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function reopen(
        EmptyActivityReportMutationRequest $request,
        string $reportId,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->reopen($this->context($request), $this->actor($request), $reportId, $this->expectedVersion($request)),
            $request,
        );
    }

    public function verify(
        EmptyActivityReportMutationRequest $request,
        string $reportId,
        ActivityReportMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->verify($this->context($request), $this->actor($request), $reportId, $this->expectedVersion($request)),
            $request,
        );
    }

    private function response(ActivityReport $report, Request $request, int $status = 200): JsonResponse
    {
        return (new ActivityReportResource($report))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$report->version.'"');
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
        return (int) $request->attributes->get(RequireActivityReportVersionPrecondition::ATTRIBUTE);
    }
}
