<?php

namespace App\Application\ActivityReport;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\ActivityReport\ActivityReportDomainException;
use App\Models\ActivityReport;
use App\Models\Laboratory;
use App\Models\LaboratorySession;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ActivityReportMutationService
{
    private const COMMON_KEYS = ['objective', 'material', 'resources', 'issues', 'followUp', 'outcomeReflection'];

    private const TYPE_KEYS = [
        'practicum' => ['topic', 'steps', 'softwareTools', 'learningOutcome'],
        'exam' => ['classification', 'proctor', 'readiness', 'continuityNotes', 'accommodationEvidence'],
        'workshop' => ['organizer', 'facilitator', 'agenda', 'resources', 'output'],
        'general' => ['activityOwner', 'classification', 'resourceUse', 'result'],
    ];

    private const SUBMIT_REQUIRED = [
        'practicum' => ['topic', 'learningOutcome'],
        'exam' => ['classification', 'readiness'],
        'workshop' => ['agenda', 'output'],
        'general' => ['activityOwner', 'result'],
    ];

    public function __construct(private readonly ActivityReportEventRecorder $recorder)
    {
    }

    public function createSessionDraft(
        CurrentMembershipContext $context,
        User $actor,
        LaboratorySession $session,
    ): ActivityReport {
        if ($session->status !== 'ended') {
            throw new \LogicException('Activity Report draft may only be created for an ended Laboratory Session.');
        }

        $existing = ActivityReport::query()
            ->where('school_id', $context->membership->school_id)
            ->where('session_id', $session->id)
            ->lockForUpdate()
            ->first();

        if ($existing !== null) {
            return $this->reload($existing);
        }

        $id = (string) Str::ulid();
        $report = new ActivityReport([
            'school_id' => $context->membership->school_id,
            'report_number' => $this->number($session->source_date->format('Y-m-d'), $id),
            'origin' => 'session',
            'session_id' => $session->id,
            'owner_membership_id' => $session->source_owner_membership_id,
            'manual_backfill_reason' => null,
            'report_type' => $this->defaultReportType((string) $session->activity_kind),
            'status' => 'draft',
            'laboratory_id' => $session->laboratory_id,
            'occurred_on' => $session->source_date->format('Y-m-d'),
            'source_snapshot' => [
                'type' => $session->source_type,
                'id' => $session->sourceId(),
                'versionEvidence' => $session->source_version_evidence,
                'fingerprint' => $session->source_fingerprint,
                'publicationId' => $session->source_publication_id,
                'evidence' => $session->source_evidence,
                'ownerMembershipId' => $session->source_owner_membership_id,
                'date' => $session->source_date->format('Y-m-d'),
                'startsAt' => substr((string) $session->source_starts_at, 0, 8),
                'endsAt' => substr((string) $session->source_ends_at, 0, 8),
            ],
            'session_snapshot' => [
                'id' => (string) $session->id,
                'sessionNumber' => (string) $session->session_number,
                'activityKind' => (string) $session->activity_kind,
                'openingCondition' => $session->opening_condition,
                'closingCondition' => $session->closing_condition,
                'endOutcome' => $session->end_outcome,
                'actualStartedAt' => $session->actual_started_at?->toISOString(),
                'actualEndedAt' => $session->actual_ended_at?->toISOString(),
            ],
            'responsible_teacher_id' => $session->responsible_teacher_id,
            'responsible_name_snapshot' => $session->responsible_name_snapshot,
            'academic_class_id' => $session->academic_class_id,
            'subject_id' => $session->subject_id,
            'planned_participant_count' => $session->planned_participant_count,
            'present_count' => null,
            'absent_count' => null,
            'attendance_notes' => null,
            'external_attendance_system' => null,
            'external_attendance_reference_id' => null,
            'common_content' => $this->emptyCommonContent(),
            'type_specific_content' => [],
            'revision_reason' => null,
            'submitted_at' => null,
            'submitted_by_user_id' => null,
            'submitted_by_membership_id' => null,
            'verified_at' => null,
            'verified_by_user_id' => null,
            'verified_by_membership_id' => null,
            'created_by_user_id' => $actor->id,
            'created_by_membership_id' => $context->membership->id,
            'version' => 1,
        ]);
        $report->id = $id;
        $report->save();

        $this->recorder->record(
            $context,
            $actor,
            $report,
            'activity_report.created',
            [
                'origin' => 'session',
                'sessionId' => (string) $session->id,
                'sessionNumber' => (string) $session->session_number,
                'reportType' => (string) $report->report_type,
            ],
            0,
            1,
        );

        return $this->reload($report);
    }

    /** @param array<string,mixed> $data */
    public function createBackfill(CurrentMembershipContext $context, User $actor, array $data): ActivityReport
    {
        return DB::transaction(function () use ($context, $actor, $data): ActivityReport {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['laboratoryId'])
                ->lockForUpdate()
                ->first();

            if ($laboratory === null) {
                throw ValidationException::withMessages([
                    'laboratoryId' => ['The selected Laboratory is invalid.'],
                ]);
            }

            $reportType = (string) $data['reportType'];
            $common = $data['commonContent'] ?? $this->emptyCommonContent();
            $specific = $data['typeSpecificContent'] ?? [];
            $this->validateContent($reportType, $common, $specific, false);
            $this->validateAttendance($data);

            $id = (string) Str::ulid();
            $report = new ActivityReport([
                'school_id' => $schoolId,
                'report_number' => $this->number((string) $data['occurredOn'], $id),
                'origin' => 'manual_backfill',
                'session_id' => null,
                'owner_membership_id' => $context->membership->id,
                'manual_backfill_reason' => trim((string) $data['manualBackfillReason']),
                'report_type' => $reportType,
                'status' => 'draft',
                'laboratory_id' => $laboratory->id,
                'occurred_on' => (string) $data['occurredOn'],
                'source_snapshot' => [
                    'type' => 'manual_backfill',
                    'reason' => trim((string) $data['manualBackfillReason']),
                    'activityDescription' => trim((string) $data['activityDescription']),
                ],
                'session_snapshot' => null,
                'responsible_teacher_id' => null,
                'responsible_name_snapshot' => trim((string) $data['responsibleName']),
                'academic_class_id' => null,
                'subject_id' => null,
                'planned_participant_count' => $data['plannedParticipantCount'] ?? null,
                'present_count' => $data['presentCount'] ?? null,
                'absent_count' => $data['absentCount'] ?? null,
                'attendance_notes' => $this->nullableTrim($data['attendanceNotes'] ?? null),
                'external_attendance_system' => $this->nullableTrim($data['externalAttendanceSystem'] ?? null),
                'external_attendance_reference_id' => $this->nullableTrim($data['externalAttendanceReferenceId'] ?? null),
                'common_content' => $common,
                'type_specific_content' => $specific,
                'revision_reason' => null,
                'submitted_at' => null,
                'submitted_by_user_id' => null,
                'submitted_by_membership_id' => null,
                'verified_at' => null,
                'verified_by_user_id' => null,
                'verified_by_membership_id' => null,
                'created_by_user_id' => $actor->id,
                'created_by_membership_id' => $context->membership->id,
                'version' => 1,
            ]);
            $report->id = $id;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.manual_backfill_created',
                [
                    'origin' => 'manual_backfill',
                    'occurredOn' => (string) $data['occurredOn'],
                    'laboratoryId' => (string) $laboratory->id,
                    'reportType' => $reportType,
                    'reason' => $report->manual_backfill_reason,
                ],
                0,
                1,
            );

            return $this->reload($report);
        });
    }

    /** @param array<string,mixed> $data */
    public function update(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        array $data,
    ): ActivityReport {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $data): ActivityReport {
            $report = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $report);
            $this->assertVersion($report, $expectedVersion);

            if ($report->status !== 'draft') {
                throw ActivityReportDomainException::stateConflict('Only draft Activity Reports may be edited.');
            }

            $reportType = (string) ($data['reportType'] ?? $report->report_type);
            $common = $data['commonContent'] ?? $report->common_content ?? [];
            $specific = $data['typeSpecificContent'] ?? $report->type_specific_content ?? [];
            $attendance = [
                'presentCount' => array_key_exists('presentCount', $data) ? $data['presentCount'] : $report->present_count,
                'absentCount' => array_key_exists('absentCount', $data) ? $data['absentCount'] : $report->absent_count,
            ];

            $this->validateContent($reportType, $common, $specific, false);
            $this->validateAttendance($attendance);

            $before = $report->version;
            $changed = [];

            foreach ([
                'reportType' => 'report_type',
                'presentCount' => 'present_count',
                'absentCount' => 'absent_count',
                'attendanceNotes' => 'attendance_notes',
                'externalAttendanceSystem' => 'external_attendance_system',
                'externalAttendanceReferenceId' => 'external_attendance_reference_id',
                'commonContent' => 'common_content',
                'typeSpecificContent' => 'type_specific_content',
            ] as $input => $column) {
                if (! array_key_exists($input, $data)) {
                    continue;
                }

                $value = $data[$input];
                if (in_array($input, ['attendanceNotes', 'externalAttendanceSystem', 'externalAttendanceReferenceId'], true)) {
                    $value = $this->nullableTrim($value);
                }

                $report->{$column} = $value;
                $changed[] = $input;
            }

            $report->version++;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.updated',
                ['changedFields' => $changed],
                $before,
                $report->version,
            );

            return $this->reload($report);
        });
    }

    public function submit(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion): ActivityReport
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): ActivityReport {
            $report = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $report);
            $this->assertVersion($report, $expectedVersion);

            if ($report->status !== 'draft') {
                throw ActivityReportDomainException::stateConflict('Only draft Activity Reports may be submitted.');
            }

            $this->validateContent(
                (string) $report->report_type,
                $report->common_content ?? [],
                $report->type_specific_content ?? [],
                true,
            );
            $this->validateAttendance([
                'presentCount' => $report->present_count,
                'absentCount' => $report->absent_count,
            ]);

            $before = $report->version;
            $report->status = 'submitted';
            $report->revision_reason = null;
            $report->submitted_at = now();
            $report->submitted_by_user_id = $actor->id;
            $report->submitted_by_membership_id = $context->membership->id;
            $report->version++;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.submitted',
                ['reportType' => (string) $report->report_type],
                $before,
                $report->version,
            );

            return $this->reload($report);
        });
    }

    public function requestRevision(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): ActivityReport {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): ActivityReport {
            $report = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $report);
            $this->assertVersion($report, $expectedVersion);

            if ($report->status !== 'submitted') {
                throw ActivityReportDomainException::stateConflict('Only submitted Activity Reports may be returned for revision.');
            }

            $before = $report->version;
            $report->status = 'revision_required';
            $report->revision_reason = trim($reason);
            $report->version++;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.revision_requested',
                ['reason' => $report->revision_reason],
                $before,
                $report->version,
            );

            return $this->reload($report);
        });
    }

    public function reopen(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion): ActivityReport
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): ActivityReport {
            $report = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $report);
            $this->assertVersion($report, $expectedVersion);

            if ($report->status !== 'revision_required') {
                throw ActivityReportDomainException::stateConflict('Only Activity Reports requiring revision may be reopened.');
            }

            $previousReason = $report->revision_reason;
            $before = $report->version;
            $report->status = 'draft';
            $report->revision_reason = null;
            $report->submitted_at = null;
            $report->submitted_by_user_id = null;
            $report->submitted_by_membership_id = null;
            $report->version++;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.reopened',
                ['previousRevisionReason' => $previousReason],
                $before,
                $report->version,
            );

            return $this->reload($report);
        });
    }

    public function verify(CurrentMembershipContext $context, User $actor, string $id, int $expectedVersion): ActivityReport
    {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): ActivityReport {
            $report = $this->lockForMutation($context, $id);
            $this->assertAccess($context, $report);
            $this->assertVersion($report, $expectedVersion);

            if ($report->status !== 'submitted') {
                throw ActivityReportDomainException::stateConflict('Only submitted Activity Reports may be verified.');
            }

            $before = $report->version;
            $report->status = 'verified';
            $report->revision_reason = null;
            $report->verified_at = now();
            $report->verified_by_user_id = $actor->id;
            $report->verified_by_membership_id = $context->membership->id;
            $report->version++;
            $report->save();

            $this->recorder->record(
                $context,
                $actor,
                $report,
                'activity_report.verified',
                [],
                $before,
                $report->version,
            );

            return $this->reload($report);
        });
    }

    private function lockForMutation(CurrentMembershipContext $context, string $id): ActivityReport
    {
        $schoolId = (string) $context->membership->school_id;
        School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

        $report = ActivityReport::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->lockForUpdate()
            ->first();

        if ($report === null) {
            throw ActivityReportDomainException::notFound();
        }

        return $report;
    }

    private function assertAccess(CurrentMembershipContext $context, ActivityReport $report): void
    {
        if ($context->permissions->contains('activity-reports.view-all')) {
            return;
        }

        if ($report->owner_membership_id !== $context->membership->id) {
            throw ActivityReportDomainException::notFound();
        }
    }

    private function assertVersion(ActivityReport $report, int $expectedVersion): void
    {
        if ($report->version !== $expectedVersion) {
            throw ActivityReportDomainException::versionConflict();
        }
    }

    /** @param array<string,mixed> $common @param array<string,mixed> $specific */
    private function validateContent(string $reportType, array $common, array $specific, bool $forSubmit): void
    {
        $errors = [];

        if (! array_key_exists($reportType, self::TYPE_KEYS)) {
            $errors['reportType'][] = 'The selected report type is invalid.';
        }

        foreach (array_keys($common) as $key) {
            if (! in_array($key, self::COMMON_KEYS, true)) {
                $errors['commonContent.'.$key][] = 'This common report field is not supported.';
            }
        }

        $allowedSpecific = self::TYPE_KEYS[$reportType] ?? [];
        foreach (array_keys($specific) as $key) {
            if (! in_array($key, $allowedSpecific, true)) {
                $errors['typeSpecificContent.'.$key][] = 'This field is not valid for the selected report type.';
            }
        }

        if ($forSubmit) {
            foreach (['objective', 'outcomeReflection'] as $key) {
                if (! $this->filledString($common[$key] ?? null)) {
                    $errors['commonContent.'.$key][] = 'This field is required before submission.';
                }
            }
            foreach (self::SUBMIT_REQUIRED[$reportType] ?? [] as $key) {
                if (! $this->filledString($specific[$key] ?? null)) {
                    $errors['typeSpecificContent.'.$key][] = 'This field is required before submission.';
                }
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /** @param array<string,mixed> $data */
    private function validateAttendance(array $data): void
    {
        $present = $data['presentCount'] ?? null;
        $absent = $data['absentCount'] ?? null;

        if (($present === null) !== ($absent === null)) {
            throw ValidationException::withMessages([
                'presentCount' => ['Present and absent aggregate counts must be supplied together.'],
                'absentCount' => ['Present and absent aggregate counts must be supplied together.'],
            ]);
        }
    }

    private function defaultReportType(string $activityKind): string
    {
        return match ($activityKind) {
            'practical' => 'practicum',
            'exam' => 'exam',
            default => 'general',
        };
    }

    /** @return array<string,null> */
    private function emptyCommonContent(): array
    {
        return [
            'objective' => null,
            'material' => null,
            'resources' => null,
            'issues' => null,
            'followUp' => null,
            'outcomeReflection' => null,
        ];
    }

    private function number(string $date, string $id): string
    {
        return 'RPT-'.str_replace('-', '', $date).'-'.substr($id, -8);
    }

    private function filledString(mixed $value): bool
    {
        return is_string($value) && trim($value) !== '';
    }

    private function nullableTrim(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }

    private function reload(ActivityReport $report): ActivityReport
    {
        return $report->refresh()->load([
            'laboratory:id,school_id,code,name,capacity,status',
            'session:id,school_id,session_number,status,source_type,source_date,actual_started_at,actual_ended_at,version',
            'responsibleTeacher:id,school_id,code,name,membership_id',
            'academicClass:id,school_id,code,name,student_count',
            'subject:id,school_id,code,name',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ]);
    }
}
