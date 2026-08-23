<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Layout\LayoutMutationService;
use App\Application\Layout\LayoutQueryService;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireLayoutVersionPrecondition;
use App\Http\Requests\CreateLayoutRequest;
use App\Http\Requests\ListLayoutsRequest;
use App\Http\Requests\ListUnplacedDevicesRequest;
use App\Http\Requests\ReplaceLayoutRequest;
use App\Http\Resources\LayoutResource;
use App\Http\Resources\LayoutSummaryResource;
use App\Http\Resources\UnplacedDeviceCandidateResource;
use App\Models\Layout;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class LayoutController extends Controller
{
    public function index(
        ListLayoutsRequest $request,
        string $laboratoryId,
        LayoutQueryService $queries,
    ): JsonResponse {
        $paginator = $queries->list($this->context($request), $laboratoryId, $request->validated());

        return response()->json([
            'data' => LayoutSummaryResource::collection($paginator->items())->resolve($request),
            'meta' => $this->paginationMeta($paginator),
        ]);
    }

    public function store(
        CreateLayoutRequest $request,
        string $laboratoryId,
        LayoutMutationService $mutations,
    ): JsonResponse {
        $layout = $mutations->create($this->context($request), $laboratoryId, $request->validated());

        return $this->layoutResponse($layout, $request, 201);
    }

    public function show(Request $request, string $layoutId, LayoutQueryService $queries): JsonResponse
    {
        return $this->layoutResponse($queries->find($this->context($request), $layoutId), $request);
    }

    public function update(
        ReplaceLayoutRequest $request,
        string $layoutId,
        LayoutMutationService $mutations,
    ): JsonResponse {
        $layout = $mutations->replace(
            $this->context($request),
            $layoutId,
            $this->expectedVersion($request),
            $request->validated(),
        );

        return $this->layoutResponse($layout, $request);
    }

    public function activate(Request $request, string $layoutId, LayoutMutationService $mutations): JsonResponse
    {
        if ($request->all() !== []) {
            throw ValidationException::withMessages(['request' => ['The activation request body must be empty.']]);
        }

        $layout = $mutations->activate(
            $this->context($request),
            $layoutId,
            $this->expectedVersion($request),
        );

        return $this->layoutResponse($layout, $request);
    }

    public function destroy(Request $request, string $layoutId, LayoutMutationService $mutations): JsonResponse
    {
        if ($request->all() !== []) {
            throw ValidationException::withMessages(['request' => ['The delete request body must be empty.']]);
        }

        $mutations->delete($this->context($request), $layoutId, $this->expectedVersion($request));

        return response()->json(null, 204);
    }

    public function unplacedDevices(
        ListUnplacedDevicesRequest $request,
        string $layoutId,
        LayoutQueryService $queries,
    ): JsonResponse {
        $paginator = $queries->unplacedDevices($this->context($request), $layoutId, $request->validated());

        return response()->json([
            'data' => UnplacedDeviceCandidateResource::collection($paginator->items())->resolve($request),
            'meta' => $this->paginationMeta($paginator),
        ]);
    }

    private function layoutResponse(Layout $layout, Request $request, int $status = 200): JsonResponse
    {
        return (new LayoutResource($layout))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$layout->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireLayoutVersionPrecondition::ATTRIBUTE);
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
