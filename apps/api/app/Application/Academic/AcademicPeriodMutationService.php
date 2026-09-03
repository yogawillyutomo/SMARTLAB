<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterException;
use App\Models\AcademicYear;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\School;
use App\Models\Semester;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AcademicPeriodMutationService
{
    public function __construct(
        private readonly AcademicMasterEventRecorder $eventRecorder,
    ) {}

    /** @param array<string, mixed> $data */
    public function createAcademicYear(CurrentMembershipContext $context, User $actor, array $data): AcademicYear
    {
        return DB::transaction(function () use ($context, $actor, $data): AcademicYear {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $this->assertCodeAvailable(AcademicYear::class, $schoolId, $data['code']);
            $status = $data['status'] ?? 'active';
            $this->assertDateRange($data['startsOn'], $data['endsOn'], 'Academic Year');
            if ($status === 'active') {
                $this->assertAcademicYearDoesNotOverlap($schoolId, $data['startsOn'], $data['endsOn']);
            }

            $year = AcademicYear::query()->create([
                'school_id' => $schoolId,
                'code' => $data['code'],
                'name' => $data['name'],
                'starts_on' => $data['startsOn'],
                'ends_on' => $data['endsOn'],
                'status' => $status,
                'version' => 1,
            ]);

            $this->eventRecorder->record(
                $context,
                $actor,
                $year,
                'academic_year',
                'academic_master.created',
                ['after' => $this->academicYearState($year)],
                0,
                1,
            );

            return $year;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateAcademicYear(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): AcademicYear
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): AcademicYear {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $year = AcademicYear::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($year === null) {
                throw AcademicMasterException::notFound('Academic Year');
            }
            if ($year->version !== $expectedVersion) {
                throw AcademicMasterException::versionConflict('Academic Year');
            }

            $before = $this->academicYearState($year);
            $after = $before;
            foreach (['name', 'startsOn', 'endsOn', 'status'] as $field) {
                if (array_key_exists($field, $data)) {
                    $after[$field] = $data[$field];
                }
            }
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $year;
            }

            $this->assertDateRange($after['startsOn'], $after['endsOn'], 'Academic Year');
            $this->assertAcademicYearContainsExistingSemesters($year->id, $after['startsOn'], $after['endsOn']);
            if ($after['status'] === 'active') {
                $this->assertAcademicYearDoesNotOverlap($schoolId, $after['startsOn'], $after['endsOn'], $year->id);
            }

            $versionBefore = $year->version;
            $year->fill([
                'name' => $after['name'],
                'starts_on' => $after['startsOn'],
                'ends_on' => $after['endsOn'],
                'status' => $after['status'],
            ]);
            $year->version++;
            $year->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $year,
                'academic_year',
                $this->eventType($before['status'], $after['status']),
                ['before' => $changedBefore, 'after' => $changedAfter],
                $versionBefore,
                $year->version,
            );

            return $year->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createSemester(CurrentMembershipContext $context, User $actor, array $data): Semester
    {
        return DB::transaction(function () use ($context, $actor, $data): Semester {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $year = AcademicYear::query()->where('school_id', $schoolId)->whereKey($data['academicYearId'])->lockForUpdate()->first();
            if ($year === null) {
                throw ValidationException::withMessages(['academicYearId' => ['The selected Academic Year is invalid.']]);
            }
            if (Semester::query()->where('academic_year_id', $year->id)->where('code', $data['code'])->exists()) {
                throw ValidationException::withMessages(['code' => ['The Semester code has already been taken in this Academic Year.']]);
            }

            $status = $data['status'] ?? 'active';
            $this->assertSemesterRange($year, $data['startsOn'], $data['endsOn']);
            if ($status === 'active') {
                $this->assertParentActive($year);
                $this->assertSemesterDoesNotOverlap($year->id, $data['startsOn'], $data['endsOn']);
            }

            $semester = Semester::query()->create([
                'school_id' => $schoolId,
                'academic_year_id' => $year->id,
                'code' => $data['code'],
                'name' => $data['name'],
                'starts_on' => $data['startsOn'],
                'ends_on' => $data['endsOn'],
                'status' => $status,
                'version' => 1,
            ]);

            $this->eventRecorder->record(
                $context,
                $actor,
                $semester,
                'semester',
                'academic_master.created',
                ['after' => $this->semesterState($semester)],
                0,
                1,
            );

            return $semester;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateSemester(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): Semester
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): Semester {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $semester = Semester::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($semester === null) {
                throw AcademicMasterException::notFound('Semester');
            }
            if ($semester->version !== $expectedVersion) {
                throw AcademicMasterException::versionConflict('Semester');
            }
            $year = AcademicYear::query()->where('school_id', $schoolId)->whereKey($semester->academic_year_id)->lockForUpdate()->firstOrFail();

            $before = $this->semesterState($semester);
            $after = $before;
            foreach (['name', 'startsOn', 'endsOn', 'status'] as $field) {
                if (array_key_exists($field, $data)) {
                    $after[$field] = $data[$field];
                }
            }
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $semester;
            }

            $this->assertSemesterRange($year, $after['startsOn'], $after['endsOn']);
            if ($after['status'] === 'active') {
                $this->assertParentActive($year);
                $this->assertSemesterDoesNotOverlap($year->id, $after['startsOn'], $after['endsOn'], $semester->id);
            }

            $versionBefore = $semester->version;
            $semester->fill([
                'name' => $after['name'],
                'starts_on' => $after['startsOn'],
                'ends_on' => $after['endsOn'],
                'status' => $after['status'],
            ]);
            $semester->version++;
            $semester->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $semester,
                'semester',
                $this->eventType($before['status'], $after['status']),
                ['before' => $changedBefore, 'after' => $changedAfter],
                $versionBefore,
                $semester->version,
            );

            return $semester->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createLessonPeriodSet(CurrentMembershipContext $context, User $actor, array $data): LessonPeriodSet
    {
        return DB::transaction(function () use ($context, $actor, $data): LessonPeriodSet {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $year = AcademicYear::query()->where('school_id', $schoolId)->whereKey($data['academicYearId'])->lockForUpdate()->first();
            if ($year === null) {
                throw ValidationException::withMessages(['academicYearId' => ['The selected Academic Year is invalid.']]);
            }
            if (LessonPeriodSet::query()->where('academic_year_id', $year->id)->where('code', $data['code'])->exists()) {
                throw ValidationException::withMessages(['code' => ['The Lesson Period Set code has already been taken in this Academic Year.']]);
            }

            $set = LessonPeriodSet::query()->create([
                'school_id' => $schoolId,
                'academic_year_id' => $year->id,
                'code' => $data['code'],
                'name' => $data['name'],
                'status' => $data['status'] ?? 'active',
                'version' => 1,
            ]);

            $this->eventRecorder->record(
                $context,
                $actor,
                $set,
                'lesson_period_set',
                'academic_master.created',
                ['after' => $this->lessonPeriodSetState($set)],
                0,
                1,
            );

            return $set;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateLessonPeriodSet(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): LessonPeriodSet
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): LessonPeriodSet {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $set = LessonPeriodSet::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($set === null) {
                throw AcademicMasterException::notFound('Lesson Period Set');
            }
            if ($set->version !== $expectedVersion) {
                throw AcademicMasterException::versionConflict('Lesson Period Set');
            }

            $before = $this->lessonPeriodSetState($set);
            $after = $before;
            foreach (['name', 'status'] as $field) {
                if (array_key_exists($field, $data)) {
                    $after[$field] = $data[$field];
                }
            }
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $set;
            }

            $versionBefore = $set->version;
            $set->fill([
                'name' => $after['name'],
                'status' => $after['status'],
            ]);
            $set->version++;
            $set->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $set,
                'lesson_period_set',
                $this->eventType($before['status'], $after['status']),
                ['before' => $changedBefore, 'after' => $changedAfter],
                $versionBefore,
                $set->version,
            );

            return $set->refresh();
        });
    }

    /** @param array<string, mixed> $data */
    public function createLessonPeriod(CurrentMembershipContext $context, User $actor, array $data): LessonPeriod
    {
        return DB::transaction(function () use ($context, $actor, $data): LessonPeriod {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $set = LessonPeriodSet::query()->where('school_id', $schoolId)->whereKey($data['lessonPeriodSetId'])->lockForUpdate()->first();
            if ($set === null) {
                throw ValidationException::withMessages(['lessonPeriodSetId' => ['The selected Lesson Period Set is invalid.']]);
            }
            if (LessonPeriod::query()->where('lesson_period_set_id', $set->id)->where('code', $data['code'])->exists()) {
                throw ValidationException::withMessages(['code' => ['The Lesson Period code has already been taken in this Lesson Period Set.']]);
            }
            $this->assertLessonPeriodSequenceAvailable($set->id, $data['sequence']);
            $this->assertTimeRange($data['startsAt'], $data['endsAt']);
            $this->assertLessonPeriodDoesNotOverlap($set->id, $data['startsAt'], $data['endsAt']);

            $period = LessonPeriod::query()->create([
                'school_id' => $schoolId,
                'lesson_period_set_id' => $set->id,
                'code' => $data['code'],
                'sequence' => $data['sequence'],
                'starts_at' => $data['startsAt'],
                'ends_at' => $data['endsAt'],
                'kind' => $data['kind'],
                'status' => $data['status'] ?? 'active',
                'version' => 1,
            ]);

            $this->eventRecorder->record(
                $context,
                $actor,
                $period,
                'lesson_period',
                'academic_master.created',
                ['after' => $this->lessonPeriodState($period)],
                0,
                1,
            );

            return $period;
        });
    }

    /** @param array<string, mixed> $data */
    public function updateLessonPeriod(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion, array $data): LessonPeriod
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): LessonPeriod {
            $schoolId = $context->membership->school_id;
            $this->lockSchool($schoolId);
            $period = LessonPeriod::query()->where('school_id', $schoolId)->whereKey($id)->lockForUpdate()->first();
            if ($period === null) {
                throw AcademicMasterException::notFound('Lesson Period');
            }
            if ($period->version !== $expectedVersion) {
                throw AcademicMasterException::versionConflict('Lesson Period');
            }
            LessonPeriodSet::query()->where('school_id', $schoolId)->whereKey($period->lesson_period_set_id)->lockForUpdate()->firstOrFail();

            $before = $this->lessonPeriodState($period);
            $after = $before;
            foreach (['sequence', 'startsAt', 'endsAt', 'kind', 'status'] as $field) {
                if (array_key_exists($field, $data)) {
                    $after[$field] = $data[$field];
                }
            }
            [$changedBefore, $changedAfter] = $this->changes($before, $after);
            if ($changedBefore === []) {
                return $period;
            }

            $this->assertLessonPeriodSequenceAvailable($period->lesson_period_set_id, $after['sequence'], $period->id);
            $this->assertTimeRange($after['startsAt'], $after['endsAt']);
            $this->assertLessonPeriodDoesNotOverlap($period->lesson_period_set_id, $after['startsAt'], $after['endsAt'], $period->id);

            $versionBefore = $period->version;
            $period->fill([
                'sequence' => $after['sequence'],
                'starts_at' => $after['startsAt'],
                'ends_at' => $after['endsAt'],
                'kind' => $after['kind'],
                'status' => $after['status'],
            ]);
            $period->version++;
            $period->save();

            $this->eventRecorder->record(
                $context,
                $actor,
                $period,
                'lesson_period',
                $this->eventType($before['status'], $after['status']),
                ['before' => $changedBefore, 'after' => $changedAfter],
                $versionBefore,
                $period->version,
            );

            return $period->refresh();
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

    private function assertDateRange(string $startsOn, string $endsOn, string $label): void
    {
        if ($startsOn > $endsOn) {
            throw ValidationException::withMessages(['endsOn' => ["The {$label} end date must be on or after its start date."]]);
        }
    }

    private function assertAcademicYearDoesNotOverlap(string $schoolId, string $startsOn, string $endsOn, ?string $exceptId = null): void
    {
        $query = AcademicYear::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->where('starts_on', '<=', $endsOn)
            ->where('ends_on', '>=', $startsOn);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw AcademicMasterException::conflict('The active Academic Year date range overlaps another active Academic Year.');
        }
    }

    private function assertAcademicYearContainsExistingSemesters(string $academicYearId, string $startsOn, string $endsOn): void
    {
        $invalidChildExists = Semester::query()
            ->where('academic_year_id', $academicYearId)
            ->where(function ($query) use ($startsOn, $endsOn): void {
                $query->where('starts_on', '<', $startsOn)
                    ->orWhere('ends_on', '>', $endsOn);
            })
            ->exists();

        if ($invalidChildExists) {
            throw AcademicMasterException::conflict('The Academic Year date range must continue to contain every existing Semester.');
        }
    }

    private function assertSemesterRange(AcademicYear $year, string $startsOn, string $endsOn): void
    {
        $this->assertDateRange($startsOn, $endsOn, 'Semester');
        if ($startsOn < $year->starts_on->format('Y-m-d') || $endsOn > $year->ends_on->format('Y-m-d')) {
            throw ValidationException::withMessages(['startsOn' => ['Semester dates must be contained by the selected Academic Year.']]);
        }
    }

    private function assertParentActive(AcademicYear $year): void
    {
        if ($year->status !== 'active') {
            throw AcademicMasterException::conflict('An active Semester requires an active Academic Year.');
        }
    }

    private function assertSemesterDoesNotOverlap(string $academicYearId, string $startsOn, string $endsOn, ?string $exceptId = null): void
    {
        $query = Semester::query()
            ->where('academic_year_id', $academicYearId)
            ->where('status', 'active')
            ->where('starts_on', '<=', $endsOn)
            ->where('ends_on', '>=', $startsOn);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw AcademicMasterException::conflict('The active Semester date range overlaps another active Semester.');
        }
    }

    private function assertLessonPeriodSequenceAvailable(string $lessonPeriodSetId, int $sequence, ?string $exceptId = null): void
    {
        $query = LessonPeriod::query()
            ->where('lesson_period_set_id', $lessonPeriodSetId)
            ->where('sequence', $sequence);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw ValidationException::withMessages(['sequence' => ['The Lesson Period sequence has already been taken in this Lesson Period Set.']]);
        }
    }

    private function assertTimeRange(string $startsAt, string $endsAt): void
    {
        if ($startsAt >= $endsAt) {
            throw ValidationException::withMessages(['endsAt' => ['The Lesson Period end time must be after its start time.']]);
        }
    }

    private function assertLessonPeriodDoesNotOverlap(string $lessonPeriodSetId, string $startsAt, string $endsAt, ?string $exceptId = null): void
    {
        $query = LessonPeriod::query()
            ->where('lesson_period_set_id', $lessonPeriodSetId)
            ->where('starts_at', '<', $endsAt)
            ->where('ends_at', '>', $startsAt);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw AcademicMasterException::conflict('Lesson Period time ranges in the same Lesson Period Set may touch but may not overlap.');
        }
    }

    /** @return array{code:string,name:string,startsOn:string,endsOn:string,status:string} */
    private function academicYearState(AcademicYear $year): array
    {
        return [
            'code' => $year->code,
            'name' => $year->name,
            'startsOn' => $year->starts_on->format('Y-m-d'),
            'endsOn' => $year->ends_on->format('Y-m-d'),
            'status' => $year->status,
        ];
    }

    /** @return array{code:string,name:string,startsOn:string,endsOn:string,status:string} */
    private function semesterState(Semester $semester): array
    {
        return [
            'code' => $semester->code,
            'name' => $semester->name,
            'startsOn' => $semester->starts_on->format('Y-m-d'),
            'endsOn' => $semester->ends_on->format('Y-m-d'),
            'status' => $semester->status,
        ];
    }

    /** @return array{code:string,name:string,status:string} */
    private function lessonPeriodSetState(LessonPeriodSet $set): array
    {
        return [
            'code' => $set->code,
            'name' => $set->name,
            'status' => $set->status,
        ];
    }

    /** @return array{code:string,sequence:int,startsAt:string,endsAt:string,kind:string,status:string} */
    private function lessonPeriodState(LessonPeriod $period): array
    {
        return [
            'code' => $period->code,
            'sequence' => $period->sequence,
            'startsAt' => (string) $period->starts_at,
            'endsAt' => (string) $period->ends_at,
            'kind' => $period->kind,
            'status' => $period->status,
        ];
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

    private function eventType(string $beforeStatus, string $afterStatus): string
    {
        if ($beforeStatus !== $afterStatus) {
            return $afterStatus === 'inactive'
                ? 'academic_master.deactivated'
                : 'academic_master.reactivated';
        }

        return 'academic_master.updated';
    }
}
