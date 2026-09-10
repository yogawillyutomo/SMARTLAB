<?php

namespace Database\Seeders;

use App\Application\ActivityReport\ActivityReportMutationService;
use App\Application\Calendar\OperationalCalendarMutationService;
use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Reservation\LaboratoryReservationMutationService;
use App\Application\Schedule\PublishedTimetableMutationService;
use App\Application\Session\LaboratorySessionMutationService;
use App\Models\AcademicClass;
use App\Models\AcademicYear;
use App\Models\ActivityReport;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\LaboratorySession;
use App\Models\LessonPeriod;
use App\Models\LessonPeriodSet;
use App\Models\OperationalCalendarEvent;
use App\Models\ScheduleOccurrence;
use App\Models\SchoolMembership;
use App\Models\Semester;
use App\Models\Subject;
use App\Models\Teacher;
use App\Models\TimetablePublication;
use App\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

class UatGlobalLabContextSeeder extends Seeder
{
    private const DATE = '2026-09-10';

    private const SOURCE_PUBLICATION_ID = 'UAT-GLC-20260910';

    public function __construct(
        private readonly IncidentCreationService $incidentCreation,
        private readonly PublishedTimetableMutationService $timetableMutation,
        private readonly LaboratoryReservationMutationService $reservationMutation,
        private readonly LaboratorySessionMutationService $sessionMutation,
        private readonly ActivityReportMutationService $reportMutation,
        private readonly OperationalCalendarMutationService $calendarMutation,
    ) {
    }

    public function run(): void
    {
        if (! app()->environment(['local', 'testing'])) {
            throw new RuntimeException(
                'UatGlobalLabContextSeeder hanya boleh dijalankan pada environment local/testing.',
            );
        }

        $adminMemberships = SchoolMembership::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($query) => $query
                ->where('email', UatAdminSeeder::EMAIL)
                ->where('status', 'active'))
            ->whereHas('roles', fn ($query) => $query->where('key', 'super-admin'))
            ->with(['user', 'school', 'roles.permissions'])
            ->get();

        if ($adminMemberships->count() !== 1) {
            throw new RuntimeException(
                'UatGlobalLabContextSeeder memerlukan tepat satu membership aktif UAT admin yang sudah memiliki role super-admin.',
            );
        }

        $membership = $adminMemberships->sole();
        $school = $membership->school;
        $actor = $membership->user;
        if ($school === null || $actor === null || $school->status !== 'active') {
            throw new RuntimeException('School dan actor UAT admin harus aktif.');
        }

        $context = new CurrentMembershipContext(
            $membership,
            $membership->effectivePermissions()->pluck('key')->values(),
        );

        $labs = $this->laboratories((string) $school->id);
        $academic = $this->academicReferences((string) $school->id);

        $publication = $this->timetable($context, $actor, $labs, $academic);

        $this->incidents($context, $labs);
        $this->calendar($context, $actor, $labs);
        $this->reservations($context, $actor, $labs);
        $this->sessions($context, $actor, $publication, $labs);
        $this->reports($context, $actor, $labs);

        $this->command?->info('SMARTLAB Global Laboratory Context UAT fixtures ready.');
        $this->command?->info('No Asset/Device/Inventory authority or custody state was mutated.');
        $this->command?->info('Reservations and Sessions are terminal/cancelled; Calendar fixtures are informational only.');
    }

    /** @return array{rpl1:Laboratory,rpl2:Laboratory} */
    private function laboratories(string $schoolId): array
    {
        $labs = Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereIn('code', ['UAT-RPL1', 'UAT-RPL2'])
            ->get()
            ->keyBy('code');

        foreach (['UAT-RPL1', 'UAT-RPL2'] as $code) {
            $lab = $labs->get($code);
            if ($lab === null || $lab->status !== 'active') {
                throw new RuntimeException("{$code} harus sudah tersedia dan active. Seeder tidak membuat/mengaktifkan Laboratory.");
            }
        }

        return [
            'rpl1' => $labs->get('UAT-RPL1'),
            'rpl2' => $labs->get('UAT-RPL2'),
        ];
    }

    /** @return array{year:AcademicYear,semester:Semester,set:LessonPeriodSet,jp1:LessonPeriod,jp2:LessonPeriod,jp3:LessonPeriod,jp4:LessonPeriod,teacher:Teacher,class1:AcademicClass,class2:AcademicClass,subject:Subject} */
    private function academicReferences(string $schoolId): array
    {
        $year = AcademicYear::query()
            ->where('school_id', $schoolId)
            ->where('status', 'active')
            ->whereDate('starts_on', '<=', self::DATE)
            ->whereDate('ends_on', '>=', self::DATE)
            ->orderBy('starts_on')
            ->first();

        if ($year === null) {
            $year = AcademicYear::query()->create([
                'school_id' => $schoolId,
                'code' => 'UAT-GLC-2026-2027',
                'name' => 'UAT Global Context 2026/2027',
                'starts_on' => '2026-07-01',
                'ends_on' => '2027-06-30',
                'status' => 'active',
                'version' => 1,
            ]);
        }

        $semester = Semester::query()
            ->where('school_id', $schoolId)
            ->where('academic_year_id', $year->id)
            ->where('status', 'active')
            ->whereDate('starts_on', '<=', self::DATE)
            ->whereDate('ends_on', '>=', self::DATE)
            ->orderBy('starts_on')
            ->first();

        if ($semester === null) {
            $semester = Semester::query()->create([
                'school_id' => $schoolId,
                'academic_year_id' => $year->id,
                'code' => 'UAT-GLC-GANJIL',
                'name' => 'UAT Global Context Ganjil',
                'starts_on' => '2026-07-01',
                'ends_on' => '2026-12-31',
                'status' => 'active',
                'version' => 1,
            ]);
        }

        $set = LessonPeriodSet::query()->firstOrCreate(
            ['academic_year_id' => $year->id, 'code' => 'UAT-GLC'],
            [
                'school_id' => $schoolId,
                'name' => 'UAT Global Context Periods',
                'status' => 'active',
                'version' => 1,
            ],
        );
        $this->assertActive($set->status, 'LessonPeriodSet UAT-GLC');

        $jp1 = $this->period($schoolId, $set, 'GLC1', 1, '07:00:00', '07:45:00');
        $jp2 = $this->period($schoolId, $set, 'GLC2', 2, '07:45:00', '08:30:00');
        $jp3 = $this->period($schoolId, $set, 'GLC3', 3, '09:30:00', '10:15:00');
        $jp4 = $this->period($schoolId, $set, 'GLC4', 4, '10:15:00', '11:00:00');

        $teacher = Teacher::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'UAT-GLC-GURU'],
            ['name' => 'Guru UAT Global Context', 'status' => 'active', 'version' => 1],
        );
        $class1 = AcademicClass::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'UAT-GLC-XI-PPLG-1'],
            ['name' => 'XI PPLG 1 UAT GLC', 'grade_level' => 11, 'student_count' => 32, 'status' => 'active', 'version' => 1],
        );
        $class2 = AcademicClass::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'UAT-GLC-XI-PPLG-2'],
            ['name' => 'XI PPLG 2 UAT GLC', 'grade_level' => 11, 'student_count' => 31, 'status' => 'active', 'version' => 1],
        );
        $subject = Subject::query()->firstOrCreate(
            ['school_id' => $schoolId, 'code' => 'UAT-GLC-WEB'],
            ['name' => 'Pemrograman Web UAT GLC', 'status' => 'active', 'version' => 1],
        );

        foreach ([
            'Teacher UAT-GLC-GURU' => $teacher->status,
            'AcademicClass UAT-GLC-XI-PPLG-1' => $class1->status,
            'AcademicClass UAT-GLC-XI-PPLG-2' => $class2->status,
            'Subject UAT-GLC-WEB' => $subject->status,
        ] as $label => $status) {
            $this->assertActive($status, $label);
        }

        return compact('year', 'semester', 'set', 'jp1', 'jp2', 'jp3', 'jp4', 'teacher', 'class1', 'class2', 'subject');
    }

    private function period(
        string $schoolId,
        LessonPeriodSet $set,
        string $code,
        int $sequence,
        string $startsAt,
        string $endsAt,
    ): LessonPeriod {
        $period = LessonPeriod::query()->firstOrCreate(
            ['lesson_period_set_id' => $set->id, 'code' => $code],
            [
                'school_id' => $schoolId,
                'sequence' => $sequence,
                'starts_at' => $startsAt,
                'ends_at' => $endsAt,
                'kind' => 'instruction',
                'status' => 'active',
                'version' => 1,
            ],
        );

        if ($period->status !== 'active'
            || (int) $period->sequence !== $sequence
            || substr((string) $period->starts_at, 0, 8) !== $startsAt
            || substr((string) $period->ends_at, 0, 8) !== $endsAt) {
            throw new RuntimeException("LessonPeriod {$code} berbeda dari fixture yang diharapkan.");
        }

        return $period;
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs @param array<string,mixed> $academic */
    private function timetable(CurrentMembershipContext $context, User $actor, array $labs, array $academic): TimetablePublication
    {
        $schoolId = (string) $context->membership->school_id;
        $payload = [
            'schemaVersion' => '1.0',
            'sourceSystem' => 'tessela',
            'sourcePublicationId' => self::SOURCE_PUBLICATION_ID,
            'sourceVersion' => 1,
            'academicReferenceSource' => 'smartlab',
            'schoolSourceId' => $schoolId,
            'academicYearSourceId' => (string) $academic['year']->id,
            'semesterSourceId' => (string) $academic['semester']->id,
            'publishedAt' => '2026-09-10T00:00:00Z',
            'effectiveFrom' => '2026-09-07',
            'effectiveTo' => '2026-09-13',
            'entries' => [
                [
                    'sourceScheduleId' => 'UAT-GLC-RPL1-20260910',
                    'teacherSourceId' => (string) $academic['teacher']->id,
                    'academicClassSourceId' => (string) $academic['class1']->id,
                    'subjectSourceId' => (string) $academic['subject']->id,
                    'lessonPeriodSetSourceId' => (string) $academic['set']->id,
                    'startLessonPeriodSourceId' => (string) $academic['jp1']->id,
                    'endLessonPeriodSourceId' => (string) $academic['jp2']->id,
                    'plannedLaboratoryId' => (string) $labs['rpl1']->id,
                    'activityType' => 'practical',
                    'recurrenceKind' => 'weekly',
                    'weekday' => 4,
                    'entryEffectiveFrom' => self::DATE,
                    'entryEffectiveTo' => self::DATE,
                    'sourceSnapshots' => [
                        'teacherCode' => 'UAT-GLC-GURU',
                        'teacherName' => 'Guru UAT Global Context',
                        'classCode' => 'UAT-GLC-XI-PPLG-1',
                        'className' => 'XI PPLG 1 UAT GLC',
                        'subjectCode' => 'UAT-GLC-WEB',
                        'subjectName' => 'Pemrograman Web UAT GLC',
                        'laboratoryCode' => 'UAT-RPL1',
                    ],
                ],
                [
                    'sourceScheduleId' => 'UAT-GLC-RPL2-20260910',
                    'teacherSourceId' => (string) $academic['teacher']->id,
                    'academicClassSourceId' => (string) $academic['class2']->id,
                    'subjectSourceId' => (string) $academic['subject']->id,
                    'lessonPeriodSetSourceId' => (string) $academic['set']->id,
                    'startLessonPeriodSourceId' => (string) $academic['jp3']->id,
                    'endLessonPeriodSourceId' => (string) $academic['jp4']->id,
                    'plannedLaboratoryId' => (string) $labs['rpl2']->id,
                    'activityType' => 'practical',
                    'recurrenceKind' => 'weekly',
                    'weekday' => 4,
                    'entryEffectiveFrom' => self::DATE,
                    'entryEffectiveTo' => self::DATE,
                    'sourceSnapshots' => [
                        'teacherCode' => 'UAT-GLC-GURU',
                        'teacherName' => 'Guru UAT Global Context',
                        'classCode' => 'UAT-GLC-XI-PPLG-2',
                        'className' => 'XI PPLG 2 UAT GLC',
                        'subjectCode' => 'UAT-GLC-WEB',
                        'subjectName' => 'Pemrograman Web UAT GLC',
                        'laboratoryCode' => 'UAT-RPL2',
                    ],
                ],
            ],
        ];

        $otherFamily = TimetablePublication::query()
            ->where('school_id', $schoolId)
            ->where('source_semester_id', $academic['semester']->id)
            ->where('source_publication_id', '<>', self::SOURCE_PUBLICATION_ID)
            ->first();
        if ($otherFamily !== null) {
            throw new RuntimeException(
                'Seeder tidak akan menimpa/supersede family TESSELA lain pada Semester UAT yang sama.',
            );
        }

        $publication = TimetablePublication::query()
            ->where('school_id', $schoolId)
            ->where('source_system', 'tessela')
            ->where('source_publication_id', self::SOURCE_PUBLICATION_ID)
            ->where('source_version', 1)
            ->first();

        if ($publication === null) {
            $activeOther = TimetablePublication::query()
                ->where('school_id', $schoolId)
                ->where('status', 'active')
                ->whereDate('effective_from', '<=', self::DATE)
                ->whereDate('effective_to', '>=', self::DATE)
                ->first();
            if ($activeOther !== null) {
                throw new RuntimeException(
                    'Seeder tidak akan mengganti publication TESSELA aktif lain yang mencakup tanggal UAT.',
                );
            }

            $publication = $this->timetableMutation->ingest($context, $actor, $payload)['publication'];
        } elseif ($publication->source_payload !== $payload) {
            throw new RuntimeException('Publication UAT Global Context sudah ada dengan payload berbeda.');
        }

        if ($publication->status === 'validated') {
            $publication = $this->timetableMutation->activate($context, $actor, (string) $publication->id);
        } elseif ($publication->status !== 'active') {
            throw new RuntimeException("Publication UAT Global Context berstatus {$publication->status}; seeder berhenti fail-closed.");
        }

        return $publication->refresh();
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs */
    private function incidents(CurrentMembershipContext $context, array $labs): void
    {
        foreach ([
            ['11111111-1111-4111-8111-111111111111', $labs['rpl1'], 'UAT GLC Incident RPL1'],
            ['22222222-2222-4222-8222-222222222222', $labs['rpl2'], 'UAT GLC Incident RPL2'],
        ] as [$submissionId, $lab, $title]) {
            $this->incidentCreation->create($context, $submissionId, [
                'laboratoryId' => (string) $lab->id,
                'deviceId' => null,
                'category' => 'hardware',
                'priority' => 'normal',
                'title' => $title,
                'description' => 'Incident non-blocking untuk UAT Global Laboratory Context.',
                'impact' => 'Hanya data representatif UAT.',
                'blocksLaboratoryOperation' => false,
                'stepsTaken' => 'Tidak ada tindakan operasional.',
                'occurredAt' => '2026-09-10T00:00:00.000000Z',
            ]);
        }
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs */
    private function calendar(CurrentMembershipContext $context, User $actor, array $labs): void
    {
        $fixtures = [
            ['UAT GLC School Event', 'school', null],
            ['UAT GLC RPL1 Event', 'laboratory', (string) $labs['rpl1']->id],
            ['UAT GLC RPL2 Event', 'laboratory', (string) $labs['rpl2']->id],
        ];

        foreach ($fixtures as [$title, $scope, $laboratoryId]) {
            $existing = OperationalCalendarEvent::query()
                ->where('school_id', $context->membership->school_id)
                ->where('title', $title)
                ->first();

            if ($existing !== null) {
                if ($existing->status !== 'active'
                    || $existing->scope !== $scope
                    || (string) ($existing->laboratory_id ?? '') !== (string) ($laboratoryId ?? '')
                    || $existing->availability_effect !== 'informational'
                    || $existing->starts_on->format('Y-m-d') !== self::DATE
                    || $existing->ends_on->format('Y-m-d') !== self::DATE) {
                    throw new RuntimeException("Calendar fixture {$title} sudah ada dengan state berbeda.");
                }
                continue;
            }

            $this->calendarMutation->create($context, $actor, [
                'scope' => $scope,
                'laboratoryId' => $laboratoryId,
                'category' => 'other',
                'availabilityEffect' => 'informational',
                'title' => $title,
                'description' => 'UAT Global Laboratory Context; informational only.',
                'startsOn' => self::DATE,
                'endsOn' => self::DATE,
                'allDay' => true,
                'startsAt' => null,
                'endsAt' => null,
            ]);
        }
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs */
    private function reservations(CurrentMembershipContext $context, User $actor, array $labs): void
    {
        $fixtures = [
            [$labs['rpl1'], 'UAT GLC Reservation RPL1', '12:30', '13:15'],
            [$labs['rpl2'], 'UAT GLC Reservation RPL2', '13:15', '14:00'],
        ];

        foreach ($fixtures as [$lab, $activity, $startsAt, $endsAt]) {
            $reservation = LaboratoryReservation::query()
                ->where('school_id', $context->membership->school_id)
                ->where('laboratory_id', $lab->id)
                ->whereDate('reservation_date', self::DATE)
                ->where('activity', $activity)
                ->first();

            if ($reservation === null) {
                $reservation = $this->reservationMutation->create($context, $actor, [
                    'laboratoryId' => (string) $lab->id,
                    'date' => self::DATE,
                    'startsAt' => $startsAt,
                    'endsAt' => $endsAt,
                    'activity' => $activity,
                    'participants' => 5,
                    'deviceNeeds' => null,
                    'notes' => 'UAT Global Laboratory Context terminal fixture.',
                    'picName' => $actor->name,
                ]);
            }

            if (in_array($reservation->status, ['submitted', 'approved'], true)) {
                $reservation = $this->reservationMutation->cancel(
                    $context,
                    $actor,
                    (string) $reservation->id,
                    (int) $reservation->version,
                    'UAT Global Laboratory Context fixture dibuat terminal agar tidak memblokir availability.',
                );
            }

            if ($reservation->status !== 'cancelled') {
                throw new RuntimeException("Reservation fixture {$activity} harus berakhir cancelled.");
            }
        }
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs */
    private function sessions(
        CurrentMembershipContext $context,
        User $actor,
        TimetablePublication $publication,
        array $labs,
    ): void {
        foreach ($labs as $key => $lab) {
            $occurrence = ScheduleOccurrence::query()
                ->where('school_id', $context->membership->school_id)
                ->where('publication_id', $publication->id)
                ->where('planned_laboratory_id', $lab->id)
                ->whereDate('occurs_on', self::DATE)
                ->sole();

            $session = LaboratorySession::query()
                ->where('school_id', $context->membership->school_id)
                ->where('schedule_occurrence_id', $occurrence->id)
                ->first();

            if ($session === null) {
                $session = $this->sessionMutation->prepare($context, $actor, [
                    'sourceType' => 'schedule_occurrence',
                    'sourceId' => (string) $occurrence->id,
                    'openingCondition' => 'UAT Global Laboratory Context.',
                    'operationalNotes' => 'Fixture non-operasional; akan langsung dibatalkan.',
                ]);
            }

            if ($session->status === 'prepared') {
                $session = $this->sessionMutation->cancel(
                    $context,
                    $actor,
                    (string) $session->id,
                    (int) $session->version,
                    'UAT Global Laboratory Context fixture dibuat terminal.',
                );
            }

            if ($session->status !== 'cancelled') {
                throw new RuntimeException("Session fixture {$key} harus berakhir cancelled.");
            }
        }
    }

    /** @param array{rpl1:Laboratory,rpl2:Laboratory} $labs */
    private function reports(CurrentMembershipContext $context, User $actor, array $labs): void
    {
        foreach ([
            [$labs['rpl1'], 'UAT Global Laboratory Context report RPL1'],
            [$labs['rpl2'], 'UAT Global Laboratory Context report RPL2'],
        ] as [$lab, $reason]) {
            $existing = ActivityReport::query()
                ->where('school_id', $context->membership->school_id)
                ->where('laboratory_id', $lab->id)
                ->whereDate('occurred_on', self::DATE)
                ->where('manual_backfill_reason', $reason)
                ->first();

            if ($existing !== null) {
                if ($existing->origin !== 'manual_backfill') {
                    throw new RuntimeException("Activity Report fixture {$reason} memiliki origin berbeda.");
                }
                continue;
            }

            $this->reportMutation->createBackfill($context, $actor, [
                'reportType' => 'general',
                'laboratoryId' => (string) $lab->id,
                'occurredOn' => self::DATE,
                'manualBackfillReason' => $reason,
                'responsibleName' => 'Admin UAT SmartLab',
                'activityDescription' => 'Data representatif untuk verifikasi filter Global Laboratory Context.',
                'plannedParticipantCount' => 5,
                'presentCount' => 5,
                'absentCount' => 0,
                'attendanceNotes' => 'Fixture UAT.',
                'externalAttendanceSystem' => null,
                'externalAttendanceReferenceId' => null,
            ]);
        }
    }

    private function assertActive(string $status, string $label): void
    {
        if ($status !== 'active') {
            throw new RuntimeException("{$label} harus active; seeder tidak mengaktifkan ulang reference yang sudah inactive.");
        }
    }
}
