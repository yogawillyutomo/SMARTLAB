<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterException;
use App\Models\AcademicYear;
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
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            throw AcademicMasterException::conflict('The active Academic Year date range overlaps another active Academic Year.');
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
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            throw AcademicMasterException::conflict('The active Semester date range overlaps another active Semester.');
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
