<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Academic\AcademicPeriodMutationService;
use App\Application\Academic\AcademicPeriodQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireAcademicMasterVersionPrecondition;
use App\Http\Requests\CreateAcademicYearRequest;
use App\Http\Requests\CreateLessonPeriodRequest;
use App\Http\Requests\CreateLessonPeriodSetRequest;
use App\Http\Requests\CreateSemesterRequest;
use App\Http\Requests\ListAcademicYearsRequest;
use App\Http\Requests\ListLessonPeriodsRequest;
use App\Http\Requests\ListLessonPeriodSetsRequest;
use App\Http\Requests\ListSemestersRequest;
use App\Http\Requests\UpdateAcademicYearRequest;
use App\Http\Requests\UpdateLessonPeriodRequest;
use App\Http\Requests\UpdateLessonPeriodSetRequest;
use App\Http\Requests\UpdateSemesterRequest;
use App\Http\Resources\AcademicYearResource;
use App\Http\Resources\LessonPeriodResource;
use App\Http\Resources\LessonPeriodSetResource;
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

    public function lessonPeriodSets(ListLessonPeriodSetsRequest $request, AcademicPeriodQueryService $service): JsonResponse
    {
        $paginator = $service->lessonPeriodSets($this->context($request), $request->validated());

        return response()->json([
            'data' => LessonPeriodSetResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeLessonPeriodSet(CreateLessonPeriodSetRequest $request, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->lessonPeriodSetResponse(
            $service->createLessonPeriodSet($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function showLessonPeriodSet(Request $request, string $lessonPeriodSetId, AcademicPeriodQueryService $service): JsonResponse
    {
        return $this->lessonPeriodSetResponse($service->lessonPeriodSet($this->context($request), $lessonPeriodSetId), $request);
    }

    public function updateLessonPeriodSet(UpdateLessonPeriodSetRequest $request, string $lessonPeriodSetId, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->lessonPeriodSetResponse(
            $service->updateLessonPeriodSet(
                $this->context($request),
                $this->actor($request),
                $lessonPeriodSetId,
                (int) $request->attributes->get(RequireAcademicMasterVersionPrecondition::ATTRIBUTE),
                $request->validated(),
            ),
            $request,
        );
    }

    public function lessonPeriods(ListLessonPeriodsRequest $request, AcademicPeriodQueryService $service): JsonResponse
    {
        $paginator = $service->lessonPeriods($this->context($request), $request->validated());

        return response()->json([
            'data' => LessonPeriodResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeLessonPeriod(CreateLessonPeriodRequest $request, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->lessonPeriodResponse(
            $service->createLessonPeriod($this->context($request), $this->actor($request), $request->validated()),
            $request,
            201,
        );
    }

    public function showLessonPeriod(Request $request, string $lessonPeriodId, AcademicPeriodQueryService $service): JsonResponse
    {
        return $this->lessonPeriodResponse($service->lessonPeriod($this->context($request), $lessonPeriodId), $request);
    }

    public function updateLessonPeriod(UpdateLessonPeriodRequest $request, string $lessonPeriodId, AcademicPeriodMutationService $service): JsonResponse
    {
        return $this->lessonPeriodResponse(
            $service->updateLessonPeriod(
                $this->context($request),
                $this->actor($request),
                $lessonPeriodId,
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

    private function lessonPeriodSetResponse($set, Request $request, int $status = 200): JsonResponse
    {
        return (new LessonPeriodSetResource($set))->response($request)->setStatusCode($status)->header('ETag', '"'.$set->version.'"');
    }

    private function lessonPeriodResponse($period, Request $request, int $status = 200): JsonResponse
    {
        return (new LessonPeriodResource($period))->response($request)->setStatusCode($status)->header('ETag', '"'.$period->version.'"');
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
