<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Reservation\LaboratoryReservationMutationService;
use App\Application\Reservation\LaboratoryReservationQueryService;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireReservationVersionPrecondition;
use App\Http\Requests\ApproveLaboratoryReservationRequest;
use App\Http\Requests\CancelLaboratoryReservationRequest;
use App\Http\Requests\CreateLaboratoryReservationRequest;
use App\Http\Requests\ListLaboratoryReservationsRequest;
use App\Http\Requests\RejectLaboratoryReservationRequest;
use App\Http\Resources\LaboratoryReservationResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LaboratoryReservationController extends Controller
{
    public function index(
        ListLaboratoryReservationsRequest $request,
        LaboratoryReservationQueryService $service,
    ): JsonResponse {
        $paginator = $service->reservations($this->context($request), $request->validated());

        return response()->json([
            'data' => LaboratoryReservationResource::collection($paginator->items())->resolve($request),
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
        CreateLaboratoryReservationRequest $request,
        LaboratoryReservationMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(
        Request $request,
        string $reservationId,
        LaboratoryReservationQueryService $service,
    ): JsonResponse {
        return $this->response($service->reservation($this->context($request), $reservationId), $request);
    }

    public function approve(
        ApproveLaboratoryReservationRequest $request,
        string $reservationId,
        LaboratoryReservationMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->approve(
                $this->context($request),
                $this->actor($request),
                $reservationId,
                $this->expectedVersion($request),
            ),
            $request,
        );
    }

    public function reject(
        RejectLaboratoryReservationRequest $request,
        string $reservationId,
        LaboratoryReservationMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->reject(
                $this->context($request),
                $this->actor($request),
                $reservationId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    public function cancel(
        CancelLaboratoryReservationRequest $request,
        string $reservationId,
        LaboratoryReservationMutationService $service,
    ): JsonResponse {
        return $this->response(
            $service->cancel(
                $this->context($request),
                $this->actor($request),
                $reservationId,
                $this->expectedVersion($request),
                (string) $request->validated('reason'),
            ),
            $request,
        );
    }

    private function response($reservation, Request $request, int $status = 200): JsonResponse
    {
        return (new LaboratoryReservationResource($reservation))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$reservation->version.'"');
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
        return (int) $request->attributes->get(RequireReservationVersionPrecondition::ATTRIBUTE);
    }
}
