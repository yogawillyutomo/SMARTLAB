<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Academic\AcademicPeriodMutationService;
use App\Application\Academic\AcademicPeriodQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireAcademicMasterVersionPrecondition;
use App\Http\Requests\CreateAcademicYearRequest;
use App\Http\Requests\CreateSemesterRequest;
use App\Http\Requests\ListAcademicYearsRequest;
use App\Http\Requests\ListSemestersRequest;
use App\Http\Requests\UpdateAcademicYearRequest;
use App\Http\Requests\UpdateSemesterRequest;
use App\Http\Resources\AcademicYearResource;
use App\Http\Resources\SemesterResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AcademicPeriodMasterController extends Controller
{
    public function academicYears(ListAcademicYearsRequest $request, AcademicPeriodQueryService $service): JsonResponse
    {
        $paginator = $service->academicYears($this->context($request), $request->validated());

        return response()->json([
            'data' => AcademicYearResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeAcademicYear(CreateAcademicYearRequest $request, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->academicYearResponse(
            $service->createAcademicYear($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function showAcademicYear(Request $request, string $academicYearId, AcademicPeriodQueryService $service): JsonResponse
    {
        return $this->academicYearResponse($service->academicYear($this->context($request), $academicYearId), $request);
    }

    public function updateAcademicYear(UpdateAcademicYearRequest $request, string $academicYearId, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->academicYearResponse(
            $service->updateAcademicYear(
                $this->context($request),
                $this->actor($request),
                $academicYearId,
                (int) $request->attributes->get(RequireAcademicMasterVersionPrecondition::ATTRIBUTE),
                $request->validated(),
            ),
            $request,
        );
    }

    public function semesters(ListSemestersRequest $request, AcademicPeriodQueryService $service): JsonResponse
    {
        $paginator = $service->semesters($this->context($request), $request->validated());

        return response()->json([
            'data' => SemesterResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeSemester(CreateSemesterRequest $request, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->semesterResponse(
            $service->createSemester($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function showSemester(Request $request, string $semesterId, AcademicPeriodQueryService $service): JsonResponse
    {
        return $this->semesterResponse($service->semester($this->context($request), $semesterId), $request);
    }

    public function updateSemester(UpdateSemesterRequest $request, string $semesterId, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->semesterResponse(
            $service->updateSemester(
                $this->context($request),
                $this->actor($request),
                $semesterId,
                (int) $request->attributes->get(RequireAcademicMasterVersionPrecondition::ATTRIBUTE),
                $request->validated(),
            ),
            $request,
        );
    }

    private function academicYearResponse($year, Request $request, int $status = 200): JsonResponse
    {
        return (new AcademicYearResource($year))->response($request)->setStatusCode($status)->header('ETag', '"'.$year->version.'"');
    }

    private function semesterResponse($semester, Request $request, int $status = 200): JsonResponse
    {
        return (new SemesterResource($semester))->response($request)->setStatusCode($status)->header('ETag', '"'.$semester->version.'"');
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

    private function meta($paginator): array
    {
        return [
            'page' => $paginator->currentPage(),
            'perPage' => $paginator->perPage(),
            'total' => $paginator->total(),
            'lastPage' => $paginator->lastPage(),
        ];
    }
}
