<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Schedule\PublishedTimetableMutationService;
use App\Application\Schedule\PublishedTimetableQueryService;
use App\Application\Schedule\TimetablePublicationImpactService;
use App\Http\Controllers\Controller;
use App\Http\Requests\CreateTimetablePublicationRequest;
use App\Http\Requests\ListTimetablePublicationsRequest;
use App\Http\Resources\TimetablePublicationResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TimetablePublicationController extends Controller
{
    public function index(
        ListTimetablePublicationsRequest $request,
        PublishedTimetableQueryService $service,
    ): JsonResponse {
        $paginator = $service->publications($this->context($request), $request->validated());

        return response()->json([
            'data' => TimetablePublicationResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(
        CreateTimetablePublicationRequest $request,
        PublishedTimetableMutationService $service,
    ): JsonResponse {
        $result = $service->ingest(
            $this->context($request),
            $this->actor($request),
            $request->validated(),
        );

        $status = $result['replayed'] ? 200 : 201;
        $response = (new TimetablePublicationResource($result['publication']))
            ->response($request)
            ->setStatusCode($status);

        $response->headers->set('X-Timetable-Replayed', $result['replayed'] ? 'true' : 'false');

        return $response;
    }

    public function show(
        Request $request,
        string $publicationId,
        PublishedTimetableQueryService $service,
    ): JsonResponse {
        return (new TimetablePublicationResource(
            $service->publication($this->context($request), $publicationId),
        ))->response($request);
    }

    public function impact(
        Request $request,
        string $publicationId,
        TimetablePublicationImpactService $service,
    ): JsonResponse {
        return response()->json([
            'data' => $service->preview($this->context($request), $publicationId),
        ]);
    }

    public function activate(
        Request $request,
        string $publicationId,
        PublishedTimetableMutationService $service,
    ): JsonResponse {
        return (new TimetablePublicationResource(
            $service->activate($this->context($request), $this->actor($request), $publicationId),
        ))->response($request);
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
}
