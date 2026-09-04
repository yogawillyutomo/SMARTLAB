<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterException;
use App\Models\AcademicClass;
use App\Models\AcademicUnit;
use App\Models\Subject;
use App\Models\Teacher;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class AcademicDirectoryQueryService
{
    /** @param array<string, mixed> $filters @return LengthAwarePaginator<AcademicUnit> */
    public function academicUnits(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = AcademicUnit::query()->where('school_id', $context->membership->school_id);
        if (array_key_exists('parentId', $filters)) {
            $filters['parentId'] === null
                ? $query->whereNull('parent_id')
                : $query->where('parent_id', $filters['parentId']);
        }
        if (isset($filters['type'])) {
            $query->where('type', $filters['type']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, ['code', 'name'], $filters['search']);
        }

        return $this->paginate($query->orderBy('code')->orderBy('id'), $filters);
    }

    public function academicUnit(CurrentMembershipContext $context, string $id): AcademicUnit
    {
        return AcademicUnit::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Academic Unit');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<Teacher> */
    public function teachers(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = Teacher::query()->where('school_id', $context->membership->school_id);
        $this->applyNullableIdFilter($query, $filters, 'academicUnitId', 'academic_unit_id');
        $this->applyNullableIdFilter($query, $filters, 'membershipId', 'membership_id');
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, ['code', 'personnel_number', 'name', 'email'], $filters['search']);
        }

        return $this->paginate($query->orderBy('code')->orderBy('id'), $filters);
    }

    public function teacher(CurrentMembershipContext $context, string $id): Teacher
    {
        return Teacher::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Teacher');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<AcademicClass> */
    public function academicClasses(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = AcademicClass::query()->where('school_id', $context->membership->school_id);
        $this->applyNullableIdFilter($query, $filters, 'academicUnitId', 'academic_unit_id');
        $this->applyNullableIdFilter($query, $filters, 'homeroomTeacherId', 'homeroom_teacher_id');
        if (isset($filters['gradeLevel'])) {
            $query->where('grade_level', $filters['gradeLevel']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, ['code', 'name'], $filters['search']);
        }

        return $this->paginate($query->orderBy('grade_level')->orderBy('code')->orderBy('id'), $filters);
    }

    public function academicClass(CurrentMembershipContext $context, string $id): AcademicClass
    {
        return AcademicClass::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Academic Class');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<Subject> */
    public function subjects(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = Subject::query()->where('school_id', $context->membership->school_id);
        $this->applyNullableIdFilter($query, $filters, 'academicUnitId', 'academic_unit_id');
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, ['code', 'name', 'group_name'], $filters['search']);
        }

        return $this->paginate($query->orderBy('code')->orderBy('id'), $filters);
    }

    public function subject(CurrentMembershipContext $context, string $id): Subject
    {
        return Subject::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Subject');
    }

    /** @param array<string, mixed> $filters */
    private function applyNullableIdFilter(Builder $query, array $filters, string $apiField, string $column): void
    {
        if (! array_key_exists($apiField, $filters)) {
            return;
        }

        $filters[$apiField] === null
            ? $query->whereNull($column)
            : $query->where($column, $filters[$apiField]);
    }

    /** @param list<string> $columns */
    private function applySearch(Builder $query, array $columns, string $search): void
    {
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';
        $query->where(function (Builder $query) use ($columns, $pattern): void {
            $grammar = $query->getQuery()->getGrammar();
            foreach ($columns as $index => $column) {
                $query->whereRaw(
                    'LOWER('.$grammar->wrap($column).") LIKE ? ESCAPE '\\'",
                    [$pattern],
                    $index === 0 ? 'and' : 'or',
                );
            }
        });
    }

    /** @param array<string, mixed> $filters */
    private function paginate(Builder $query, array $filters): LengthAwarePaginator
    {
        return $query->paginate(
            perPage: $filters['perPage'] ?? 25,
            columns: ['*'],
            pageName: 'page',
            page: $filters['page'] ?? 1,
        );
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
