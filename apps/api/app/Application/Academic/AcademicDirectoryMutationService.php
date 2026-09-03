<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterException;
use App\Models\AcademicClass;
use App\Models\AcademicUnit;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcademicDirectoryMutationService
{
    public function __construct(private readonly AcademicMasterEventRecorder $eventRecorder) {}

    /** @param array<string, mixed> $data */
    public function createAcademicUnit(CurrentMembershipContext $context, User $actor, array $data): AcademicUnit
    {
        return DB::transaction(function () use ($context, $actor, $data): AcademicUnit {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $this->assertCodeAvailable(AcademicUnit::class, $schoolId, $data['code']);
            $this->assertAcademicUnitHierarchy($schoolId, $data['parentId'] ?? null);

            $unit = AcademicUnit::query()->create([
                'school_id' => $schoolId,
                'code' => $data['code'],
                'name' => $data['name'],
                'type' => $data['type'],
                'parent_id' => $data['parentId'] ?? null,
                'status' => $data['status'] ?? 'active',
                'version' => 1,
            ]);

            $this->recordCreated($context, $actor, $unit, 'academic_unit', $this->academicUnitState($unit));

            return $unit;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateAcademicUnit(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): AcademicUnit
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): AcademicUnit {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $unit = AcademicUnit::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($unit === null) {
                throw AcademicMasterException::notFound('Academic Unit');
            }
            $this->assertVersion($unit, $expectedVersion, 'Academic Unit');

            $before = $this->academicUnitState($unit);
            $after = $this->overlay($before, $data, ['name', 'type', 'parentId', 'status']);
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $unit;
            }

            if (array_key_exists('parentId', $changedAfter)) {
                $this->assertAcademicUnitHierarchy($schoolId, $after['parentId'], $unit->id);
            }

            $versionBefore = $unit->version;
            $unit->fill([
                'name' => $after['name'],
                'type' => $after['type'],
                'parent_id' => $after['parentId'],
                'status' => $after['status'],
            ]);
            $unit->version++;
            $unit->save();
            $this->recordUpdated($context, $actor, $unit, 'academic_unit', $before, $after, $changedBefore, $changedAfter, $versionBefore);

            return $unit->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createTeacher(CurrentMembershipContext $context, User $actor, array $data): Teacher
    {
        return DB::transaction(function () use ($context, $actor, $data): Teacher {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $this->assertCodeAvailable(Teacher::class, $schoolId, $data['code']);
            $this->assertPersonnelNumberAvailable($schoolId, $data['personnelNumber'] ?? null);
            $this->assertAcademicUnitReference($schoolId, $data['academicUnitId'] ?? null, 'academicUnitId');
            $this->assertMembershipReference($schoolId, $data['membershipId'] ?? null);
            $this->assertMembershipAvailable($schoolId, $data['membershipId'] ?? null);

            $teacher = Teacher::query()->create([
                'school_id' => $schoolId,
                'code' => $data['code'],
                'personnel_number' => $data['personnelNumber'] ?? null,
                'name' => $data['name'],
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'academic_unit_id' => $data['academicUnitId'] ?? null,
                'membership_id' => $data['membershipId'] ?? null,
                'status' => $data['status'] ?? 'active',
                'version' => 1,
            ]);

            $this->recordCreated($context, $actor, $teacher, 'teacher', $this->teacherState($teacher));

            return $teacher;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateTeacher(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): Teacher
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): Teacher {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $teacher = Teacher::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($teacher === null) {
                throw AcademicMasterException::notFound('Teacher');
            }
            $this->assertVersion($teacher, $expectedVersion, 'Teacher');

            $before = $this->teacherState($teacher);
            $after = $this->overlay($before, $data, ['personnelNumber', 'name', 'email', 'phone', 'academicUnitId', 'membershipId', 'status']);
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $teacher;
            }

            if (array_key_exists('personnelNumber', $changedAfter)) {
                $this->assertPersonnelNumberAvailable($schoolId, $after['personnelNumber'], $teacher->id);
            }
            if (array_key_exists('academicUnitId', $changedAfter)) {
                $this->assertAcademicUnitReference($schoolId, $after['academicUnitId'], 'academicUnitId');
            }
            if (array_key_exists('membershipId', $changedAfter)) {
                $this->assertMembershipReference($schoolId, $after['membershipId']);
                $this->assertMembershipAvailable($schoolId, $after['membershipId'], $teacher->id);
            }

            $versionBefore = $teacher->version;
            $teacher->fill([
                'personnel_number' => $after['personnelNumber'],
                'name' => $after['name'],
                'email' => $after['email'],
                'phone' => $after['phone'],
                'academic_unit_id' => $after['academicUnitId'],
                'membership_id' => $after['membershipId'],
                'status' => $after['status'],
            ]);
            $teacher->version++;
            $teacher->save();
            $this->recordUpdated($context, $actor, $teacher, 'teacher', $before, $after, $changedBefore, $changedAfter, $versionBefore);

            return $teacher->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createAcademicClass(CurrentMembershipContext $context, User $actor, array $data): AcademicClass
    {
        return DB::transaction(function () use ($context, $actor, $data): AcademicClass {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $this->assertCodeAvailable(AcademicClass::class, $schoolId, $data['code']);
            $this->assertAcademicUnitReference($schoolId, $data['academicUnitId'] ?? null, 'academicUnitId');
            $teacher = $this->assertTeacherReference($schoolId, $data['homeroomTeacherId'] ?? null, 'homeroomTeacherId');
            $status = $data['status'] ?? 'active';
            if ($status === 'active' && $teacher !== null) {
                $this->assertTeacherActive($teacher);
            }

            $class = AcademicClass::query()->create([
                'school_id' => $schoolId,
                'code' => $data['code'],
                'name' => $data['name'],
                'grade_level' => $data['gradeLevel'],
                'academic_unit_id' => $data['academicUnitId'] ?? null,
                'homeroom_teacher_id' => $data['homeroomTeacherId'] ?? null,
                'student_count' => $data['studentCount'] ?? 0,
                'status' => $status,
                'version' => 1,
            ]);

            $this->recordCreated($context, $actor, $class, 'academic_class', $this->academicClassState($class));

            return $class;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateAcademicClass(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): AcademicClass
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): AcademicClass {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $class = AcademicClass::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($class === null) {
                throw AcademicMasterException::notFound('Academic Class');
            }
            $this->assertVersion($class, $expectedVersion, 'Academic Class');

            $before = $this->academicClassState($class);
            $after = $this->overlay($before, $data, ['name', 'gradeLevel', 'academicUnitId', 'homeroomTeacherId', 'studentCount', 'status']);
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $class;
            }

            if (array_key_exists('academicUnitId', $changedAfter)) {
                $this->assertAcademicUnitReference($schoolId, $after['academicUnitId'], 'academicUnitId');
            }

            $homeroomChanged = array_key_exists('homeroomTeacherId', $changedAfter);
            $reactivating = $before['status'] !== 'active' && $after['status'] === 'active';
            if ($homeroomChanged || $reactivating) {
                $teacher = $this->assertTeacherReference($schoolId, $after['homeroomTeacherId'], 'homeroomTeacherId');
                if ($after['status'] === 'active' && $teacher !== null) {
                    $this->assertTeacherActive($teacher);
                }
            }

            $versionBefore = $class->version;
            $class->fill([
                'name' => $after['name'],
                'grade_level' => $after['gradeLevel'],
                'academic_unit_id' => $after['academicUnitId'],
                'homeroom_teacher_id' => $after['homeroomTeacherId'],
                'student_count' => $after['studentCount'],
                'status' => $after['status'],
            ]);
            $class->version++;
            $class->save();
            $this->recordUpdated($context, $actor, $class, 'academic_class', $before, $after, $changedBefore, $changedAfter, $versionBefore);

            return $class->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createSubject(CurrentMembershipContext $context, User $actor, array $data): Subject
    {
        return DB::transaction(function () use ($context, $actor, $data): Subject {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $this->assertCodeAvailable(Subject::class, $schoolId, $data['code']);
            $this->assertAcademicUnitReference($schoolId, $data['academicUnitId'] ?? null, 'academicUnitId');

            $subject = Subject::query()->create([
                'school_id' => $schoolId,
                'code' => $data['code'],
                'name' => $data['name'],
                'group_name' => $data['groupName'] ?? null,
                'academic_unit_id' => $data['academicUnitId'] ?? null,
                'status' => $data['status'] ?? 'active',
                'version' => 1,
            ]);

            $this->recordCreated($context, $actor, $subject, 'subject', $this->subjectState($subject));

            return $subject;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateSubject(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): Subject
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): Subject {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $subject = Subject::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($subject === null) {
                throw AcademicMasterException::notFound('Subject');
            }
            $this->assertVersion($subject, $expectedVersion, 'Subject');

            $before = $this->subjectState($subject);
            $after = $this->overlay($before, $data, ['name', 'groupName', 'academicUnitId', 'status']);
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $subject;
            }

            if (array_key_exists('academicUnitId', $changedAfter)) {
                $this->assertAcademicUnitReference($schoolId, $after['academicUnitId'], 'academicUnitId');
            }

            $versionBefore = $subject->version;
            $subject->fill([
                'name' => $after['name'],
                'group_name' => $after['groupName'],
                'academic_unit_id' => $after['academicUnitId'],
                'status' => $after['status'],
            ]);
            $subject->version++;
            $subject->save();
            $this->recordUpdated($context, $actor, $subject, 'subject', $before, $after, $changedBefore, $changedAfter, $versionBefore);

            return $subject->refresh();
        });
    }

    private function lockSchool(string $schoolId): void
    {
        School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();
    }

    private function assertCodeAvailable(string $modelClass, string $schoolId, string $code): void
    {
        if ($modelClass::query()->where('school_id', $schoolId)->where('code', $code)->exists()) {
            throw ValidationException::withMessages(['code' => ['The code has already been taken.']]);
        }
    }

    private function assertVersion(Model $model, int $expectedVersion, string $label): void
    {
        if ((int) $model->getAttribute('version') !== $expectedVersion) {
            throw AcademicMasterException::versionConflict($label);
        }
    }

    private function assertAcademicUnitHierarchy(string $schoolId, ?string $parentId, ?string $unitId = null): void
    {
        $parentDepth = 0;
        $cursor = $parentId;
        $visited = [];
        while ($cursor !== null) {
            if ($cursor === $unitId || isset($visited[$cursor])) {
                throw ValidationException::withMessages(['parentId' => ['Academic Unit hierarchy cannot contain a cycle.']]);
            }
            $visited[$cursor] = true;
            $parent = AcademicUnit::query()->where('school_id', $schoolId)->whereKey($cursor)->first();
            if ($parent === null) {
                throw ValidationException::withMessages(['parentId' => ['The selected Academic Unit parent is invalid.']]);
            }
            $parentDepth++;
            $cursor = $parent->parent_id;
        }

        $subtreeDepth = $unitId === null ? 1 : $this->academicUnitSubtreeDepth($schoolId, $unitId);
        if ($parentDepth + $subtreeDepth > 4) {
            throw ValidationException::withMessages(['parentId' => ['Academic Unit hierarchy depth cannot exceed 4 levels.']]);
        }
    }

    private function academicUnitSubtreeDepth(string $schoolId, string $unitId): int
    {
        $frontier = [$unitId];
        $visited = [];
        $depth = 0;
        while ($frontier !== []) {
            $depth++;
            $next = [];
            foreach ($frontier as $id) {
                if (isset($visited[$id])) {
                    throw AcademicMasterException::conflict('Academic Unit hierarchy contains a cycle.');
                }
                $visited[$id] = true;
                foreach (AcademicUnit::query()->where('school_id', $schoolId)->where('parent_id', $id)->pluck('id')->all() as $childId) {
                    $next[] = $childId;
                }
            }
            $frontier = $next;
        }

        return $depth;
    }

    private function assertAcademicUnitReference(string $schoolId, ?string $id, string $field): ?AcademicUnit
    {
        if ($id === null) {
            return null;
        }

        $unit = AcademicUnit::query()->where('school_id', $schoolId)->whereKey($id)->first();
        if ($unit === null) {
            throw ValidationException::withMessages([$field => ['The selected Academic Unit is invalid.']]);
        }

        return $unit;
    }

    private function assertMembershipReference(string $schoolId, ?string $id): ?SchoolMembership
    {
        if ($id === null) {
            return null;
        }

        $membership = SchoolMembership::query()->where('school_id', $schoolId)->whereKey($id)->first();
        if ($membership === null) {
            throw ValidationException::withMessages(['membershipId' => ['The selected School Membership is invalid.']]);
        }

        return $membership;
    }

    private function assertMembershipAvailable(string $schoolId, ?string $membershipId, ?string $exceptTeacherId = null): void
    {
        if ($membershipId === null) {
            return;
        }
        $query = Teacher::query()->where('school_id', $schoolId)->where('membership_id', $membershipId);
        if ($exceptTeacherId !== null) {
            $query->where('id', '!=', $exceptTeacherId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['membershipId' => ['The School Membership is already linked to another Teacher.']]);
        }
    }

    private function assertPersonnelNumberAvailable(string $schoolId, ?string $personnelNumber, ?string $exceptTeacherId = null): void
    {
        if ($personnelNumber === null) {
            return;
        }
        $query = Teacher::query()->where('school_id', $schoolId)->where('personnel_number', $personnelNumber);
        if ($exceptTeacherId !== null) {
            $query->where('id', '!=', $exceptTeacherId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['personnelNumber' => ['The personnel number has already been taken.']]);
        }
    }

    private function assertTeacherReference(string $schoolId, ?string $id, string $field): ?Teacher
    {
        if ($id === null) {
            return null;
        }

        $teacher = Teacher::query()->where('school_id', $schoolId)->whereKey($id)->first();
        if ($teacher === null) {
            throw ValidationException::withMessages([$field => ['The selected Teacher is invalid.']]);
        }

        return $teacher;
    }

    private function assertTeacherActive(Teacher $teacher): void
    {
        if ($teacher->status !== 'active') {
            throw AcademicMasterException::conflict('An active Academic Class can only receive a newly assigned active homeroom Teacher.');
        }
    }

    /** @param array<string,mixed> $state @param array<string,mixed> $data @param list<string> $fields @return array<string,mixed> */
    private function overlay(array $state, array $data, array $fields): array
    {
        foreach ($fields as $field) {
            if (array_key_exists($field, $data)) {
                $state[$field] = $data[$field];
            }
        }

        return $state;
    }

    /** @param array<string,mixed> $before @param array<string,mixed> $after @return array{0:array<string,mixed>,1:array<string,mixed>} */
    private function changes(array $before, array $after): array
    {
        $changedBefore = [];
        $changedAfter = [];
        foreach ($before as $field => $value) {
            if ($value === $after[$field]) {
                continue;
            }
            $changedBefore[$field] = $value;
            $changedAfter[$field] = $after[$field];
        }

        return [$changedBefore, $changedAfter];
    }

    /** @param array<string,mixed> $state */
    private function recordCreated(CurrentMembershipContext $context, User $actor, Model $entity, string $entityType, array $state): void
    {
        $this->eventRecorder->record($context, $actor, $entity, $entityType, 'academic_master.created', ['after' => $state], 0, 1);
    }

    /** @param array<string,mixed> $before @param array<string,mixed> $after @param array<string,mixed> $changedBefore @param array<string,mixed> $changedAfter */
    private function recordUpdated(CurrentMembershipContext $context, User $actor, Model $entity, string $entityType, array $before, array $after, array $changedBefore, array $changedAfter, int $versionBefore): void
    {
        $this->eventRecorder->record(
            $context,
            $actor,
            $entity,
            $entityType,
            $this->eventType($before['status'], $after['status']),
            ['before' => $changedBefore, 'after' => $changedAfter],
            $versionBefore,
            (int) $entity->getAttribute('version'),
        );
    }

    private function eventType(string $beforeStatus, string $afterStatus): string
    {
        if ($beforeStatus !== $afterStatus) {
            return $afterStatus === 'inactive' ? 'academic_master.deactivated' : 'academic_master.reactivated';
        }

        return 'academic_master.updated';
    }

    /** @return array{code:string,name:string,type:string,parentId:?string,status:string} */
    private function academicUnitState(AcademicUnit $unit): array
    {
        return ['code' => $unit->code, 'name' => $unit->name, 'type' => $unit->type, 'parentId' => $unit->parent_id, 'status' => $unit->status];
    }

    /** @return array{code:string,personnelNumber:?string,name:string,email:?string,phone:?string,academicUnitId:?string,membershipId:?string,status:string} */
    private function teacherState(Teacher $teacher): array
    {
        return [
            'code' => $teacher->code,
            'personnelNumber' => $teacher->personnel_number,
            'name' => $teacher->name,
            'email' => $teacher->email,
            'phone' => $teacher->phone,
            'academicUnitId' => $teacher->academic_unit_id,
            'membershipId' => $teacher->membership_id,
            'status' => $teacher->status,
        ];
    }

    /** @return array{code:string,name:string,gradeLevel:int,academicUnitId:?string,homeroomTeacherId:?string,studentCount:int,status:string} */
    private function academicClassState(AcademicClass $class): array
    {
        return [
            'code' => $class->code,
            'name' => $class->name,
            'gradeLevel' => $class->grade_level,
            'academicUnitId' => $class->academic_unit_id,
            'homeroomTeacherId' => $class->homeroom_teacher_id,
            'studentCount' => $class->student_count,
            'status' => $class->status,
        ];
    }

    /** @return array{code:string,name:string,groupName:?string,academicUnitId:?string,status:string} */
    private function subjectState(Subject $subject): array
    {
        return [
            'code' => $subject->code,
            'name' => $subject->name,
            'groupName' => $subject->group_name,
            'academicUnitId' => $subject->academic_unit_id,
            'status' => $subject->status,
        ];
    }
}
