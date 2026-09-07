<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Maintenance\MaintenanceCampaignService;
use App\Domain\Maintenance\MaintenanceDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireMaintenanceCampaignVersionPrecondition;
use App\Http\Requests\CreateMaintenanceCampaignRequest;
use App\Http\Requests\EmptyMaintenanceActionRequest;
use App\Http\Requests\ListMaintenanceCampaignsRequest;
use App\Http\Requests\ScheduleMaintenanceCampaignRequest;
use App\Http\Resources\MaintenanceCampaignEventResource;
use App\Http\Resources\MaintenanceCampaignResource;
use App\Http\Resources\MaintenanceExecutionResource;
use App\Models\MaintenanceCampaign;
use App\Models\MaintenanceCampaignEvent;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MaintenanceCampaignController extends Controller
{
    public function index(ListMaintenanceCampaignsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $query = MaintenanceCampaign::query()
            ->with(['items' => fn ($q) => $q->orderBy('asset_code_snapshot')])
            ->where('school_id', $this->context($request)->membership->school_id);

        if (isset($validated['status'])) {
            $query->where('status', $validated['status']);
        }
        if (isset($validated['laboratoryId'])) {
            $query->where('laboratory_id', $validated['laboratoryId']);
        }
        if (isset($validated['search'])) {
            $pattern = '%'.$this->escapeLikePattern(mb_strtolower($validated['search'])).'%';
            $grammar = $query->getQuery()->getGrammar();
            $query->where(function (Builder $q) use ($pattern, $grammar): void {
                foreach (['campaign_code', 'laboratory_code_snapshot', 'laboratory_name_snapshot', 'name', 'description'] as $index => $column) {
                    $q->whereRaw(
                        'LOWER(COALESCE('.$grammar->wrap($column).", '')) LIKE ? ESCAPE '\\'",
                        [$pattern],
                        $index === 0 ? 'and' : 'or',
                    );
                }
            });
        }

        $paginator = $query->orderByDesc('created_at')->orderByDesc('id')
            ->paginate((int) ($validated['perPage'] ?? 25), ['*'], 'page', (int) ($validated['page'] ?? 1));

        return response()->json([
            'data' => MaintenanceCampaignResource::collection($paginator->items())->resolve($request),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(CreateMaintenanceCampaignRequest $request, MaintenanceCampaignService $service): JsonResponse
    {
        return $this->campaignResponse(
            $service->create($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function show(Request $request, string $campaignId): JsonResponse
    {
        $campaign = MaintenanceCampaign::query()
            ->with(['items' => fn ($q) => $q->orderBy('asset_code_snapshot')])
            ->where('school_id', $this->context($request)->membership->school_id)
            ->whereKey($campaignId)
            ->first();

        if ($campaign === null) {
            throw MaintenanceDomainException::campaignNotFound();
        }

        return $this->campaignResponse($campaign, $request);
    }

    public function history(Request $request, string $campaignId): JsonResponse
    {
        $schoolId = $this->context($request)->membership->school_id;
        $exists = MaintenanceCampaign::query()
            ->where('school_id', $schoolId)
            ->whereKey($campaignId)
            ->exists();

        if (! $exists) {
            throw MaintenanceDomainException::campaignNotFound();
        }

        $events = MaintenanceCampaignEvent::query()
            ->where('school_id', $schoolId)
            ->where('maintenance_campaign_id', $campaignId)
            ->orderBy('created_at')
            ->orderBy('id')
            ->get();

        return response()->json([
            'data' => MaintenanceCampaignEventResource::collection($events)->resolve($request),
        ]);
    }

    public function activate(
        EmptyMaintenanceActionRequest $request,
        string $campaignId,
        MaintenanceCampaignService $service,
    ): JsonResponse {
        return $this->campaignResponse(
            $service->activate(
                $this->context($request),
                $this->actor($request),
                $campaignId,
                $this->campaignVersion($request),
            ),
            $request,
        );
    }

    public function deactivate(
        EmptyMaintenanceActionRequest $request,
        string $campaignId,
        MaintenanceCampaignService $service,
    ): JsonResponse {
        return $this->campaignResponse(
            $service->deactivate(
                $this->context($request),
                $this->actor($request),
                $campaignId,
                $this->campaignVersion($request),
            ),
            $request,
        );
    }

    public function scheduleBatch(
        ScheduleMaintenanceCampaignRequest $request,
        string $campaignId,
        MaintenanceCampaignService $service,
    ): JsonResponse {
        $result = $service->scheduleBatch(
            $this->context($request),
            $this->actor($request),
            $campaignId,
            $this->campaignVersion($request),
            $request->validated(),
        );

        return response()->json([
            'data' => (new MaintenanceCampaignResource($result['campaign']))->resolve($request),
            'executions' => MaintenanceExecutionResource::collection($result['executions'])->resolve($request),
            'meta' => ['executionCount' => count($result['executions'])],
        ], 201)->header('ETag', '"'.$result['campaign']->version.'"');
    }

    private function campaignResponse(MaintenanceCampaign $campaign, Request $request, int $status = 200): JsonResponse
    {
        return (new MaintenanceCampaignResource($campaign))
            ->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$campaign->version.'"');
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

    private function campaignVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireMaintenanceCampaignVersionPrecondition::ATTRIBUTE);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
