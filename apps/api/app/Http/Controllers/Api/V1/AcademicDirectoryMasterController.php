<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Academic\AcademicDirectoryMutationService;
use App\Application\Academic\AcademicDirectoryQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireAcademicMasterVersionPrecondition;
use App\Http\Requests\CreateAcademicClassRequest;
use App\Http\Requests\CreateAcademicUnitRequest;
use App\Http\Requests\CreateSubjectRequest;
use App\Http\Requests\CreateTeacherRequest;
use App\Http\Requests\ListAcademicClassesRequest;
use App\Http\Requests\ListAcademicUnitsRequest;
use App\Http\Requests\ListSubjectsRequest;
use App\Http\Requests\ListTeachersRequest;
use App\Http\Requests\UpdateAcademicClassRequest;
use App\Http\Requests\UpdateAcademicUnitRequest;
use App\Http\Requests\UpdateSubjectRequest;
use App\Http\Requests\UpdateTeacherRequest;
use App\Http\Resources\AcademicClassResource;
use App\Http\Resources\AcademicUnitResource;
use App\Http\Resources\SubjectResource;
use App\Http\Resources\TeacherResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AcademicDirectoryMasterController extends Controller
{
    public function academicUnits(ListAcademicUnitsRequest $request, AcademicDirectoryQueryService $service): JsonResponse
    {
        $paginator = $service->academicUnits($this->context($request), $request->validated());

        return response()->json([
            'data' => AcademicUnitResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeAcademicUnit(CreateAcademicUnitRequest $request, AcademicDirectoryMutationService $service): JsonResponse
    {
        $unit = $service->createAcademicUnit($this->context($request), $this->actor($request), $request->validated());

        return $this->singleResponse(new AcademicUnitResource($unit), $request, $unit->version, 201);
    }

    public function showAcademicUnit(Request $request, string $academicUnitId, AcademicDirectoryQueryService $service): JsonResponse
    {
        $unit = $service->academicUnit($this->context($request), $academicUnitId);

        return $this->singleResponse(new AcademicUnitResource($unit), $request, $unit->version);
    }

    public function updateAcademicUnit(UpdateAcademicUnitRequest $request, string $academicUnitId, AcademicDirectoryMutationService $service): JsonResponse
    {
        $unit = $service->updateAcademicUnit(
            $this->context($request),
            $this->actor($request),
            $academicUnitId,
            $this->expectedVersion($request),
            $request->validated(),
        );

        return $this->singleResponse(new AcademicUnitResource($unit), $request, $unit->version);
    }

    public function teachers(ListTeachersRequest $request, AcademicDirectoryQueryService $service): JsonResponse
    {
        $paginator = $service->teachers($this->context($request), $request->validated());

        return response()->json([
            'data' => TeacherResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeTeacher(CreateTeacherRequest $request, AcademicDirectoryMutationService $service): JsonResponse
    {
        $teacher = $service->createTeacher($this->context($request), $this->actor($request), $request->validated());

        return $this->singleResponse(new TeacherResource($teacher), $request, $teacher->version, 201);
    }

    public function showTeacher(Request $request, string $teacherId, AcademicDirectoryQueryService $service): JsonResponse
    {
        $teacher = $service->teacher($this->context($request), $teacherId);

        return $this->singleResponse(new TeacherResource($teacher), $request, $teacher->version);
    }

    public function updateTeacher(UpdateTeacherRequest $request, string $teacherId, AcademicDirectoryMutationService $service): JsonResponse
    {
        $teacher = $service->updateTeacher(
            $this->context($request),
            $this->actor($request),
            $teacherId,
            $this->expectedVersion($request),
            $request->validated(),
        );

        return $this->singleResponse(new TeacherResource($teacher), $request, $teacher->version);
    }

    public function academicClasses(ListAcademicClassesRequest $request, AcademicDirectoryQueryService $service): JsonResponse
    {
        $paginator = $service->academicClasses($this->context($request), $request->validated());

        return response()->json([
            'data' => AcademicClassResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeAcademicClass(CreateAcademicClassRequest $request, AcademicDirectoryMutationService $service): JsonResponse
    {
        $class = $service->createAcademicClass($this->context($request), $this->actor($request), $request->validated());

        return $this->singleResponse(new AcademicClassResource($class), $request, $class->version, 201);
    }

    public function showAcademicClass(Request $request, string $academicClassId, AcademicDirectoryQueryService $service): JsonResponse
    {
        $class = $service->academicClass($this->context($request), $academicClassId);

        return $this->singleResponse(new AcademicClassResource($class), $request, $class->version);
    }

    public function updateAcademicClass(UpdateAcademicClassRequest $request, string $academicClassId, AcademicDirectoryMutationService $service): JsonResponse
    {
        $class = $service->updateAcademicClass(
            $this->context($request),
            $this->actor($request),
            $academicClassId,
            $this->expectedVersion($request),
            $request->validated(),
        );

        return $this->singleResponse(new AcademicClassResource($class), $request, $class->version);
    }

    public function subjects(ListSubjectsRequest $request, AcademicDirectoryQueryService $service): JsonResponse
    {
        $paginator = $service->subjects($this->context($request), $request->validated());

        return response()->json([
            'data' => SubjectResource::collection($paginator->items())->resolve($request),
            'meta' => $this->meta($paginator),
        ]);
    }

    public function storeSubject(CreateSubjectRequest $request, AcademicDirectoryMutationService $service): JsonResponse
    {
        $subject = $service->createSubject($this->context($request), $this->actor($request), $request->validated());

        return $this->singleResponse(new SubjectResource($subject), $request, $subject->version, 201);
    }

    public function showSubject(Request $request, string $subjectId, AcademicDirectoryQueryService $service): JsonResponse
    {
        $subject = $service->subject($this->context($request), $subjectId);

        return $this->singleResponse(new SubjectResource($subject), $request, $subject->version);
    }

    public function updateSubject(UpdateSubjectRequest $request, string $subjectId, AcademicDirectoryMutationService $service): JsonResponse
    {
        $subject = $service->updateSubject(
            $this->context($request),
            $this->actor($request),
            $subjectId,
            $this->expectedVersion($request),
            $request->validated(),
        );

        return $this->singleResponse(new SubjectResource($subject), $request, $subject->version);
    }

    private function singleResponse(JsonResource $resource, Request $request, int $version, int $status = 200): JsonResponse
    {
        return $resource->response($request)
            ->setStatusCode($status)
            ->header('ETag', '"'.$version.'"');
    }

    private function expectedVersion(Request $request): int
    {
        return (int) $request->attributes->get(RequireAcademicMasterVersionPrecondition::ATTRIBUTE);
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
