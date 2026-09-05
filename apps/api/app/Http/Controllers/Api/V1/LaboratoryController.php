<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Session\LaboratorySessionSourceGuard;
use App\Http\Controllers\Controller;
use App\Http\Requests\CreateLaboratoryRequest;
use App\Http\Requests\UpdateLaboratoryRequest;
use App\Http\Resources\LaboratoryResource;
use App\Models\Laboratory;
use App\Models\School;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class LaboratoryController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $laboratories = Laboratory::query()
            ->where('school_id', $this->schoolId($request))
            ->orderBy('code')
            ->orderBy('id')
            ->get();

        return LaboratoryResource::collection($laboratories);
    }

    public function store(CreateLaboratoryRequest $request): JsonResponse
    {
        $laboratory = Laboratory::query()->create([
            ...$request->safe()->only(['code', 'name', 'location', 'capacity', 'status']),
            'school_id' => $this->schoolId($request),
            'status' => $request->validated('status', 'active'),
        ]);

        return (new LaboratoryResource($laboratory))
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, string $laboratoryId): LaboratoryResource|JsonResponse
    {
        $laboratory = $this->findForCurrentSchool($request, $laboratoryId);

        if ($laboratory === null) {
            return $this->notFound();
        }

        return new LaboratoryResource($laboratory);
    }

    public function update(
        UpdateLaboratoryRequest $request,
        string $laboratoryId,
        LaboratorySessionSourceGuard $sessionGuard,
    ): LaboratoryResource|JsonResponse {
        $laboratory = DB::transaction(function () use ($request, $laboratoryId, $sessionGuard): ?Laboratory {
            $schoolId = $this->schoolId($request);
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($laboratoryId)
                ->lockForUpdate()
                ->first();

            if ($laboratory === null) {
                return null;
            }

            if ($laboratory->status === 'active' && $request->validated('status') === 'inactive') {
                $sessionGuard->assertLaboratoryMayBecomeInactive($schoolId, (string) $laboratory->id);
            }

            $laboratory->update($request->safe()->only(['code', 'name', 'location', 'capacity', 'status']));

            return $laboratory->refresh();
        });

        if ($laboratory === null) {
            return $this->notFound();
        }

        return new LaboratoryResource($laboratory);
    }

    private function findForCurrentSchool(Request $request, string $laboratoryId): ?Laboratory
    {
        return Laboratory::query()
            ->where('school_id', $this->schoolId($request))
            ->whereKey($laboratoryId)
            ->first();
    }

    private function schoolId(Request $request): string
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context->membership->school_id;
    }

    private function notFound(): JsonResponse
    {
        return response()->json([
            'message' => 'Laboratory not found.',
            'code' => 'LABORATORY_NOT_FOUND',
        ], 404);
    }
}
