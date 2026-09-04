import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  AcademicMasterContractError,
  createAcademicMasterGateway,
  parseAcademicClass,
  parseAcademicUnit,
  parseAcademicYear,
  parseLessonPeriod,
  parseLessonPeriodSet,
  parseSemester,
  parseSubject,
  parseTeacher,
} from '@/services/academicMasterApi';

const base = {
  id: '01ACADEMIC0000000000000001',
  schoolId: '01SCHOOL000000000000000001',
  code: 'PPLG',
  status: 'active' as const,
  version: 3,
  createdAt: '2026-09-04T01:00:00.000Z',
  updatedAt: '2026-09-04T02:00:00.000Z',
};

const academicUnit = {
  ...base,
  name: 'Pengembangan Perangkat Lunak dan Gim',
  type: 'program' as const,
  parentId: null,
};

const teacher = {
  ...base,
  code: 'GURU-001',
  personnelNumber: '19880001',
  name: 'Guru SmartLab',
  email: 'guru@example.test',
  phone: '08123456789',
  academicUnitId: academicUnit.id,
  membershipId: null,
};

const academicClass = {
  ...base,
  code: 'XI-PPLG-1',
  name: 'XI PPLG 1',
  gradeLevel: 11,
  academicUnitId: academicUnit.id,
  homeroomTeacherId: teacher.id,
  studentCount: 36,
};

const subject = {
  ...base,
  code: 'PWEB',
  name: 'Pemrograman Web',
  groupName: 'Kejuruan',
  academicUnitId: academicUnit.id,
};

const academicYear = {
  ...base,
  code: '2026/2027',
  name: 'Tahun Ajaran 2026/2027',
  startsOn: '2026-07-01',
  endsOn: '2027-06-30',
};

const semester = {
  ...base,
  code: 'GASAL',
  academicYearId: academicYear.id,
  name: 'Semester Gasal',
  startsOn: '2026-07-01',
  endsOn: '2026-12-31',
};

const lessonPeriodSet = {
  ...base,
  code: 'NORMAL',
  academicYearId: academicYear.id,
  name: 'Jam Normal',
};

const lessonPeriod = {
  ...base,
  code: 'JP01',
  lessonPeriodSetId: lessonPeriodSet.id,
  sequence: 1,
  startsAt: '07:00:00',
  endsAt: '07:45:00',
  kind: 'instruction' as const,
};

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: [academicYear], meta: { page: 1, perPage: 25, total: 1, lastPage: 1 } })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: academicYear })) as ApiClient['post'],
    put: vi.fn(async () => undefined) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: academicYear })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Academic Master response parsing', () => {
  it('parses exact canonical projections for all eight resource families', () => {
    expect(parseAcademicUnit(academicUnit)).toEqual(academicUnit);
    expect(parseTeacher(teacher)).toEqual(teacher);
    expect(parseAcademicClass(academicClass)).toEqual(academicClass);
    expect(parseSubject(subject)).toEqual(subject);
    expect(parseAcademicYear(academicYear)).toEqual(academicYear);
    expect(parseSemester(semester)).toEqual(semester);
    expect(parseLessonPeriodSet(lessonPeriodSet)).toEqual(lessonPeriodSet);
    expect(parseLessonPeriod(lessonPeriod)).toEqual(lessonPeriod);
  });

  it.each([
    { parser: parseAcademicUnit, value: { ...academicUnit, schoolName: 'forbidden' } },
    { parser: parseAcademicUnit, value: { ...academicUnit, type: 'division' } },
    { parser: parseTeacher, value: { ...teacher, status: 'deleted' } },
    { parser: parseAcademicClass, value: { ...academicClass, studentCount: -1 } },
    { parser: parseAcademicClass, value: { ...academicClass, gradeLevel: 0 } },
    { parser: parseAcademicYear, value: { ...academicYear, startsOn: '01-07-2026' } },
    { parser: parseLessonPeriod, value: { ...lessonPeriod, startsAt: '07:00' } },
    { parser: parseLessonPeriod, value: { ...lessonPeriod, kind: 'assembly' } },
  ])('rejects malformed or over-broad server projections', ({ parser, value }) => {
    expect(() => parser(value)).toThrow(AcademicMasterContractError);
  });
});

describe('Academic Master gateway boundary', () => {
  it('uses canonical endpoints, trims search, encodes identifiers, and sends a strong If-Match', async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith('/master-data/academic-years?')) {
        return { data: [academicYear], meta: { page: 2, perPage: 25, total: 30, lastPage: 2 } };
      }
      return { data: academicYear };
    });
    const post = vi.fn(async () => ({ data: academicYear }));
    const patch = vi.fn(async () => ({ data: { ...academicYear, name: 'TA 2026/2027', version: 4 } }));
    const gateway = createAcademicMasterGateway(clientWith({
      get: get as ApiClient['get'],
      post: post as ApiClient['post'],
      patch: patch as ApiClient['patch'],
    }));

    await gateway.academicYears.list({ search: ' 2026 ', status: 'active', page: 2, perPage: 25 });
    await gateway.academicYears.show('year/id with spaces');
    await gateway.academicYears.create({
      code: '2026/2027',
      name: 'Tahun Ajaran 2026/2027',
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
      status: 'active',
    });
    await gateway.academicYears.update('year/id with spaces', 3, { name: 'TA 2026/2027' });

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/master-data/academic-years?search=2026&status=active&page=2&perPage=25',
      '/master-data/academic-years/year%2Fid%20with%20spaces',
    ]);
    expect(post).toHaveBeenCalledWith('/master-data/academic-years', {
      code: '2026/2027',
      name: 'Tahun Ajaran 2026/2027',
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
      status: 'active',
    });
    expect(patch).toHaveBeenCalledWith(
      '/master-data/academic-years/year%2Fid%20with%20spaces',
      { name: 'TA 2026/2027' },
      { ifMatch: '"3"' },
    );
  });

  it('binds all resource families to their canonical server namespaces', async () => {
    const responseByPath: Record<string, unknown> = {
      '/master-data/academic-units': academicUnit,
      '/master-data/teachers': teacher,
      '/master-data/classes': academicClass,
      '/master-data/subjects': subject,
      '/master-data/academic-years': academicYear,
      '/master-data/semesters': semester,
      '/master-data/lesson-period-sets': lessonPeriodSet,
      '/master-data/lesson-periods': lessonPeriod,
    };
    const get = vi.fn(async (path: string) => ({ data: responseByPath[path] }));
    const gateway = createAcademicMasterGateway(clientWith({ get: get as ApiClient['get'] }));

    await gateway.academicUnits.show(academicUnit.id);
    await gateway.teachers.show(teacher.id);
    await gateway.classes.show(academicClass.id);
    await gateway.subjects.show(subject.id);
    await gateway.academicYears.show(academicYear.id);
    await gateway.semesters.show(semester.id);
    await gateway.lessonPeriodSets.show(lessonPeriodSet.id);
    await gateway.lessonPeriods.show(lessonPeriod.id);

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      `/master-data/academic-units/${academicUnit.id}`,
      `/master-data/teachers/${teacher.id}`,
      `/master-data/classes/${academicClass.id}`,
      `/master-data/subjects/${subject.id}`,
      `/master-data/academic-years/${academicYear.id}`,
      `/master-data/semesters/${semester.id}`,
      `/master-data/lesson-period-sets/${lessonPeriodSet.id}`,
      `/master-data/lesson-periods/${lessonPeriod.id}`,
    ]);
  });

  it('rejects empty identifiers, empty updates, and invalid versions before network mutation', async () => {
    const patch = vi.fn(async () => ({ data: academicYear }));
    const gateway = createAcademicMasterGateway(clientWith({ patch: patch as ApiClient['patch'] }));

    await expect(gateway.academicYears.show('   ')).rejects.toThrow(AcademicMasterContractError);
    await expect(gateway.academicYears.update(academicYear.id, 3, {})).rejects.toThrow(AcademicMasterContractError);
    await expect(gateway.academicYears.update(academicYear.id, 0, { name: 'TA' })).rejects.toThrow(AcademicMasterContractError);
    await expect(gateway.academicYears.update(academicYear.id, 1.5, { name: 'TA' })).rejects.toThrow(AcademicMasterContractError);
    expect(patch).not.toHaveBeenCalled();
  });

  it('does not expose a hard-delete operation for any Academic Master resource', () => {
    const gateway = createAcademicMasterGateway(clientWith());
    for (const resource of Object.values(gateway)) {
      expect('delete' in resource).toBe(false);
      expect('destroy' in resource).toBe(false);
    }
  });
});
