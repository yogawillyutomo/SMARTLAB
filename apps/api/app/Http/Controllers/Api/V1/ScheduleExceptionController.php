<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\ScheduleException\ScheduleExceptionMutationService;
use App\Application\ScheduleException\ScheduleExceptionQueryService;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireScheduleExceptionVersionPrecondition;
use App\Http\Requests\CancelScheduleExceptionRequest;
use App\Http\Requests\CreateScheduleExceptionRequest;
use App\Http\Requests\ListScheduleExceptionsRequest;
use App\Http\Resources\ScheduleExceptionResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScheduleExceptionController extends Controller
{
    public function index(
        ListScheduleExceptionsRequest $request,
        ScheduleExceptionQueryService $service,
    ): JsonResponse {
        $paginator = $service->exceptions($this->context($request), $request->validated());

        return response()->json([
            'data' => ScheduleExceptionResource::collection($paginator->items())->resolve($request),
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

    public function store(
        CreateScheduleExceptionRequest $request,
        ScheduleExceptionMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(
        Request $request,
        string $scheduleExceptionId,
        ScheduleExceptionQueryService $service,
    ): JsonResponse {
        return $this->response(
            $service->exception($this->context($request), $scheduleExceptionId),
            $request,
        );
    }

    public function cancel(
        CancelScheduleExceptionRequest $request,
        string $scheduleExceptionId,
        ScheduleExceptionMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->cancel(
                $this->context($request),
                $this->actor($request),
                $scheduleExceptionId,
                (int) $request->attributes->get(RequireScheduleExceptionVersionPrecondition::ATTRIBUTE),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function response($exception, Request $request, int $status = 200): JsonResponse
    {
        return (new ScheduleExceptionResource($exception))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$exception->version.'"');
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
