<?php

namespace App\Application\Academic;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Academic\AcademicMasterException;
use App\Models\AcademicYear;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\Semester;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;

class AcademicPeriodQueryService
{
    /** @param array<string, mixed> $filters @return LengthAwarePaginator<AcademicYear> */
    public function academicYears(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = AcademicYear::query()->where('school_id', $context->membership->school_id);
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, $filters['search']);
        }

        return $query->orderBy('code')->orderBy('id')->paginate(
            perPage: $filters['perPage'] ?? 25,
            columns: ['*'],
            pageName: 'page',
            page: $filters['page'] ?? 1,
        );
    }

    public function academicYear(CurrentMembershipContext $context, string $id): AcademicYear
    {
        return AcademicYear::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Academic Year');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<Semester> */
    public function semesters(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = Semester::query()->where('school_id', $context->membership->school_id);
        if (isset($filters['academicYearId'])) {
            $query->where('academic_year_id', $filters['academicYearId']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, $filters['search']);
        }

        return $query->orderBy('starts_on')->orderBy('code')->orderBy('id')->paginate(
            perPage: $filters['perPage'] ?? 25,
            columns: ['*'],
            pageName: 'page',
            page: $filters['page'] ?? 1,
        );
    }

    public function semester(CurrentMembershipContext $context, string $id): Semester
    {
        return Semester::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Semester');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<LessonPeriodSet> */
    public function lessonPeriodSets(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = LessonPeriodSet::query()->where('school_id', $context->membership->school_id);
        if (isset($filters['academicYearId'])) {
            $query->where('academic_year_id', $filters['academicYearId']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applySearch($query, $filters['search']);
        }

        return $query->orderBy('academic_year_id')->orderBy('code')->orderBy('id')->paginate(
            perPage: $filters['perPage'] ?? 25,
            columns: ['*'],
            pageName: 'page',
            page: $filters['page'] ?? 1,
        );
    }

    public function lessonPeriodSet(CurrentMembershipContext $context, string $id): LessonPeriodSet
    {
        return LessonPeriodSet::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Lesson Period Set');
    }

    /** @param array<string, mixed> $filters @return LengthAwarePaginator<LessonPeriod> */
    public function lessonPeriods(CurrentMembershipContext $context, array $filters): LengthAwarePaginator
    {
        $query = LessonPeriod::query()->where('school_id', $context->membership->school_id);
        if (isset($filters['lessonPeriodSetId'])) {
            $query->where('lesson_period_set_id', $filters['lessonPeriodSetId']);
        }
        if (isset($filters['kind'])) {
            $query->where('kind', $filters['kind']);
        }
        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['search'])) {
            $this->applyCodeSearch($query, $filters['search']);
        }

        return $query->orderBy('lesson_period_set_id')->orderBy('sequence')->orderBy('id')->paginate(
            perPage: $filters['perPage'] ?? 25,
            columns: ['*'],
            pageName: 'page',
            page: $filters['page'] ?? 1,
        );
    }

    public function lessonPeriod(CurrentMembershipContext $context, string $id): LessonPeriod
    {
        return LessonPeriod::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($id)
            ->first() ?? throw AcademicMasterException::notFound('Lesson Period');
    }

    private function applySearch(Builder $query, string $search): void
    {
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';
        $query->where(function (Builder $query) use ($pattern): void {
            $grammar = $query->getQuery()->getGrammar();
            foreach (['code', 'name'] as $index => $column) {
                $boolean = $index === 0 ? 'and' : 'or';
                $query->whereRaw('LOWER('.$grammar->wrap($column).") LIKE ? ESCAPE '\\'", [$pattern], $boolean);
            }
        });
    }

    private function applyCodeSearch(Builder $query, string $search): void
    {
        $pattern = '%'.$this->escapeLikePattern(mb_strtolower($search)).'%';
        $grammar = $query->getQuery()->getGrammar();
        $query->whereRaw('LOWER('.$grammar->wrap('code').") LIKE ? ESCAPE '\\'", [$pattern]);
    }

    private function escapeLikePattern(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
