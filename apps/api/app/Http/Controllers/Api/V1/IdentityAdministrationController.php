<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Identity\IdentityAdministrationMutationService;
use App\Application\Identity\IdentityAdministrationQueryService;
use App\Http\Controllers\Controller;
use App\Http\Requests\CreateIdentityMembershipRequest;
use App\Http\Requests\ListIdentityMembershipsRequest;
use App\Http\Requests\UpdateIdentityMembershipRequest;
use App\Http\Resources\IdentityMembershipResource;
use App\Http\Resources\IdentityRoleResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IdentityAdministrationController extends Controller
{
    public function index(
        ListIdentityMembershipsRequest $request,
        IdentityAdministrationQueryService $queryService,
    ): JsonResponse {
        $paginator = $queryService->memberships($this->context($request), $request->validated());

        return response()->json([
            'data' => collect($paginator->items())
                ->map(fn ($membership) => (new IdentityMembershipResource($membership))->resolve($request))
                ->values()
                ->all(),
            'meta' => [
                'page' => $paginator->currentPage(),
                'perPage' => $paginator->perPage(),
                'total' => $paginator->total(),
                'lastPage' => $paginator->lastPage(),
            ],
        ]);
    }

    public function store(
        CreateIdentityMembershipRequest $request,
        IdentityAdministrationMutationService $mutationService,
    ): JsonResponse {
        $membership = $mutationService->create(
            $this->context($request),
            $this->actor($request),
            $request->validated(),
        );

        return (new IdentityMembershipResource($membership))
            ->response()
            ->setStatusCode(201);
    }

    public function show(
        Request $request,
        string $membershipId,
        IdentityAdministrationQueryService $queryService,
    ): IdentityMembershipResource {
        return new IdentityMembershipResource(
            $queryService->membership($this->context($request), $membershipId),
        );
    }

    public function update(
        UpdateIdentityMembershipRequest $request,
        string $membershipId,
        IdentityAdministrationMutationService $mutationService,
    ): IdentityMembershipResource {
        return new IdentityMembershipResource(
            $mutationService->update(
                $this->context($request),
                $this->actor($request),
                $membershipId,
                $request->validated(),
            ),
        );
    }

    public function roles(
        Request $request,
        IdentityAdministrationQueryService $queryService,
    ): JsonResponse {
        return response()->json([
            'data' => $queryService->roles($this->context($request))
                ->map(fn ($role) => (new IdentityRoleResource($role))->resolve($request))
                ->values()
                ->all(),
        ]);
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
