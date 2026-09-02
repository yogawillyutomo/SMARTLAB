<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Incident\IncidentTransitionService;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class IncidentTransitionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_transition_requires_authentication_and_view_permission_before_precondition_or_body_validation(): void
    {
        $unknown = strtolower((string) Str::ulid());

        $this->postJson('/api/v1/incidents/'.$unknown.'/transitions', ['forged' => true], ['If-Match' => 'W/"1"'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $this->authenticateWithPermissions(['incidents.approve']);
        $this->postJson('/api/v1/incidents/'.$unknown.'/transitions', ['forged' => true], ['If-Match' => 'W/"1"'])
            ->assertForbidden()
            ->assertExactJson([
                'message' => 'You do not have permission to perform this action.',
                'code' => 'FORBIDDEN',
            ]);
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_transition_requires_exact_incident_if_match(mixed $header): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $headers = $header === null ? [] : ['If-Match' => $header];

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Incident sudah ditinjau.',
        ], $headers)
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');
    }

    public static function invalidIfMatchProvider(): array
    {
        return [
            'missing' => [null],
            'weak' => ['W/"1"'],
            'wildcard' => ['*'],
            'unquoted' => ['1'],
            'multiple' => ['"1", "2"'],
        ];
    }

    public function test_structural_transition_validation_precedes_visibility(): void
    {
        $this->authenticateWithPermissions(['incidents.view']);
        $unknown = strtolower((string) Str::ulid());

        foreach ([
            [],
            ['toStatus' => 'not-a-status'],
            ['toStatus' => 'triaged', 'forged' => true],
            ['toStatus' => 'triaged', 'blocksLaboratoryOperation' => 'yes'],
        ] as $payload) {
            $this->postJson('/api/v1/incidents/'.$unknown.'/transitions', $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->postJson(
            '/api/v1/incidents/'.$unknown.'/transitions?force=true',
            ['toStatus' => 'triaged'],
            ['If-Match' => '"1"'],
        )->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_assignment_target_reaches_edge_resolver_and_is_rejected_as_invalid_transition(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.assign']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'assigned',
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_INVALID_TRANSITION');
    }

    public function test_non_visible_incident_returns_404_before_edge_or_permission_oracle(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view']);
        $hidden = $this->createIncidentFor($this->reporter($school), $school);

        $this->postJson('/api/v1/incidents/'.$hidden->id.'/transitions', [
            'toStatus' => 'closed',
        ], ['If-Match' => '"1"'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
    }

    public function test_stale_version_wins_before_invalid_edge_missing_permission_and_assignee_eligibility(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $assignee = $this->candidate($school, 'Teknisi Lama', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: true);
        $assignee->delete();
        DB::table('incidents')->where('id', $incident->id)->update(['version' => 2]);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Coba buka ulang dengan data stale',
        ], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
    }

    public function test_missing_exact_edge_permission_precedes_edge_specific_required_data(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $incident = $this->createIncidentFor([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'triaged',
        ], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_edge_specific_missing_or_irrelevant_data_is_422_after_permission_resolution(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'triaged',
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Incident sudah ditinjau.',
            'reason' => 'Field ini milik edge lain',
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_reported_to_triaged_finalizes_optional_operational_fields_and_records_exact_event(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => ' TRIAGED ',
            'triageSummary' => '  Sudah diverifikasi oleh kepala lab.  ',
            'priority' => ' HIGH ',
            'impact' => '  Menghambat dua workstation.  ',
            'blocksLaboratoryOperation' => true,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'triaged')
            ->assertJsonPath('data.priority', 'high')
            ->assertJsonPath('data.impact', 'Menghambat dua workstation.')
            ->assertJsonPath('data.blocksLaboratoryOperation', true)
            ->assertJsonPath('data.triageSummary', 'Sudah diverifikasi oleh kepala lab.')
            ->assertJsonPath('data.version', 2);

        $event = $this->event($incident, IncidentEventType::Triaged);
        $this->assertSame(1, $event->incident_version_before);
        $this->assertSame(2, $event->incident_version_after);
        $this->assertSame([
            'triageSummary' => 'Sudah diverifikasi oleh kepala lab.',
            'priority' => 'high',
            'impact' => 'Menghambat dua workstation.',
            'blocksLaboratoryOperation' => true,
        ], $event->payload);
        $this->assertDatabaseCount('incident_events', 2);
    }

    public function test_reported_to_rejected_records_reason_and_terminal_state(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'rejected',
            'reason' => '  Laporan tidak dapat diverifikasi.  ',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.rejectionReason', 'Laporan tidak dapat diverifikasi.')
            ->assertJsonPath('data.version', 2);

        $this->assertSame(
            ['rejectionReason' => 'Laporan tidak dapat diverifikasi.'],
            $this->event($incident, IncidentEventType::Rejected)->payload,
        );
    }

    public function test_triaged_to_resolved_supports_simple_resolution_without_assignment(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Masalah sederhana selesai saat triage.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.assignee', null)
            ->assertJsonPath('data.resolutionSummary', 'Masalah sederhana selesai saat triage.')
            ->assertJsonPath('data.version', 2);

        $this->assertSame(
            ['resolutionSummary' => 'Masalah sederhana selesai saat triage.'],
            $this->event($incident, IncidentEventType::Resolved)->payload,
        );
    }

    public function test_assigned_to_in_progress_requires_eligible_current_assignee_and_records_started_event(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);
        $this->setAssignedState($incident, $membership);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'in_progress',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertNotNull($incident->started_at);
        $this->assertSame([
            'previousStatus' => 'assigned',
            'newStatus' => 'in_progress',
        ], $this->event($incident, IncidentEventType::Started)->payload);
    }

    #[DataProvider('progressResolveProvider')]
    public function test_assignee_can_resolve_assigned_or_in_progress_and_assignment_timing_is_preserved(
        string $status,
        bool $started,
    ): void {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);
        $this->setAssignedState($incident, $membership, $started);
        $before = $incident->fresh();
        $assignedAt = $before->assigned_at?->toISOString();
        $startedAt = $before->started_at?->toISOString();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Perbaikan selesai dan layanan kembali normal.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertSame('resolved', $incident->status->value);
        $this->assertSame($membership->id, $incident->assignee_membership_id);
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertSame($startedAt, $incident->started_at?->toISOString());
        $this->assertSame(
            ['resolutionSummary' => 'Perbaikan selesai dan layanan kembali normal.'],
            $this->event($incident, IncidentEventType::Resolved)->payload,
        );
    }

    public static function progressResolveProvider(): array
    {
        return [
            'assigned' => ['assigned', false],
            'in_progress' => ['in_progress', true],
        ];
    }

    public function test_progress_transition_rejects_non_assignee_without_assign_override(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.update']);
        $assignee = $this->candidate($school, 'Teknisi Pemilik', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);
        $this->setAssignedState($incident, $assignee);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Tidak boleh diselesaikan oleh aktor ini.',
        ], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->assertSame('assigned', $incident->fresh()->status->value);
        $this->assertSame(1, $incident->fresh()->version);
    }

    public function test_progress_transition_allows_update_actor_with_assign_override(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions([
            'incidents.view', 'incidents.update', 'incidents.assign',
        ]);
        $assignee = $this->candidate($school, 'Teknisi Pemilik', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setTriagedState($incident);
        $this->setAssignedState($incident, $assignee);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Admin teknis menyelesaikan dengan override.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'resolved');
    }

    public function test_resolved_to_verified_and_verified_to_closed_use_approve_permission(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'verified',
            'verificationNote' => 'Hasil perbaikan sudah diverifikasi.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'verified');
        $this->assertSame(
            ['verificationNote' => 'Hasil perbaikan sudah diverifikasi.'],
            $this->event($incident, IncidentEventType::Verified)->payload,
        );

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'closed',
        ], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.version', 3);
        $this->assertSame([
            'previousStatus' => 'verified',
            'newStatus' => 'closed',
        ], $this->event($incident, IncidentEventType::Closed)->payload);
    }

    public function test_resolved_without_assignee_snapshots_reopens_only_to_triaged_and_records_cleared_evidence(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident);
        $before = $incident->fresh();
        $resolvedAt = $before->resolved_at?->utc()->format('Y-m-d\TH:i:s.u\Z');

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'triaged',
            'reason' => 'Perlu ditinjau ulang setelah informasi baru.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'triaged')
            ->assertJsonPath('data.resolutionSummary', null)
            ->assertJsonPath('data.resolvedAt', null)
            ->assertJsonPath('data.version', 2);

        $this->assertSame([
            'previousStatus' => 'resolved',
            'newStatus' => 'triaged',
            'reason' => 'Perlu ditinjau ulang setelah informasi baru.',
            'assigneePresent' => false,
            'clearedFields' => ['resolutionSummary', 'resolvedAt'],
            'clearedValues' => [
                'resolutionSummary' => 'Incident telah diselesaikan.',
                'resolvedAt' => $resolvedAt,
            ],
            'startedAtInitialized' => false,
            'startedAt' => null,
        ], $this->event($incident, IncidentEventType::Reopened)->payload);
    }

    public function test_snapshot_present_resolved_reopens_to_in_progress_and_initializes_first_start_when_needed(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $this->candidate($school, 'Teknisi Aktif', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: false);
        $before = $incident->fresh();
        $assignedAt = $before->assigned_at?->toISOString();
        $resolvedAt = $before->resolved_at?->utc()->format('Y-m-d\TH:i:s.u\Z');

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Gejala muncul kembali setelah resolusi.',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.assignee.membershipId', $assignee->id)
            ->assertJsonPath('data.resolutionSummary', null)
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertNotNull($incident->started_at);
        $event = $this->event($incident, IncidentEventType::Reopened);
        $this->assertTrue($event->payload['startedAtInitialized']);
        $this->assertSame($incident->started_at?->utc()->format('Y-m-d\TH:i:s.u\Z'), $event->payload['startedAt']);
        $this->assertSame([
            'resolutionSummary' => 'Incident telah diselesaikan.',
            'resolvedAt' => $resolvedAt,
        ], $event->payload['clearedValues']);
    }

    public function test_snapshot_present_reopen_preserves_existing_first_start(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $this->candidate($school, 'Teknisi Aktif', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: true);
        $startedAt = $incident->fresh()->started_at?->toISOString();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Masalah kembali dan perlu dilanjutkan.',
        ], ['If-Match' => '"1"'])->assertOk();

        $incident->refresh();
        $this->assertSame($startedAt, $incident->started_at?->toISOString());
        $event = $this->event($incident, IncidentEventType::Reopened);
        $this->assertFalse($event->payload['startedAtInitialized']);
        $this->assertNull($event->payload['startedAt']);
    }

    #[DataProvider('reopenPathMismatchProvider')]
    public function test_reopen_target_must_match_snapshot_presence(bool $withAssignee, string $target): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $withAssignee ? $this->candidate($school, 'Teknisi', ['incidents.update']) : null;
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: $withAssignee);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => $target,
            'reason' => 'Target reopen tidak sesuai jalur canonical.',
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_INVALID_TRANSITION');

        $this->assertSame('resolved', $incident->fresh()->status->value);
        $this->assertSame(1, $incident->fresh()->version);
    }

    public static function reopenPathMismatchProvider(): array
    {
        return [
            'snapshots cannot triage' => [true, 'triaged'],
            'no snapshots cannot progress' => [false, 'in_progress'],
        ];
    }

    #[DataProvider('ineligibleReopenAssigneeProvider')]
    public function test_snapshot_present_reopen_requires_live_progress_eligible_assignee(string $defect): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $this->candidate($school, 'Teknisi Recovery', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: true);

        match ($defect) {
            'deleted' => $assignee->delete(),
            'membership-inactive' => DB::table('school_memberships')->where('id', $assignee->id)->update(['status' => 'inactive']),
            'user-inactive' => DB::table('users')->where('id', $assignee->user_id)->update(['status' => 'inactive']),
            'lost-update' => $assignee->roles()->detach(),
        };

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Reopen harus menunggu recovery assignee.',
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_ASSIGNEE_INELIGIBLE');

        $incident->refresh();
        $this->assertSame('resolved', $incident->status->value);
        $this->assertNotNull($incident->resolution_summary);
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public static function ineligibleReopenAssigneeProvider(): array
    {
        return [
            'deleted membership' => ['deleted'],
            'inactive membership' => ['membership-inactive'],
            'inactive user' => ['user-inactive'],
            'lost incidents.update' => ['lost-update'],
        ];
    }

    public function test_assignee_eligibility_change_between_routing_read_and_lock_fails_closed(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $this->candidate($school, 'Teknisi Race', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: true);
        $membership->setRelation('user', $user);
        $inject = true;

        Event::listen('eloquent.retrieved: '.SchoolMembership::class, function (SchoolMembership $retrieved) use (&$inject, $assignee): void {
            if (! $inject || $retrieved->id !== $assignee->id) {
                return;
            }
            $inject = false;
            DB::table('school_memberships')->where('id', $assignee->id)->update(['status' => 'inactive']);
        });

        try {
            app(IncidentTransitionService::class)->transition(
                new CurrentMembershipContext($membership, collect(['incidents.view', 'incidents.approve'])),
                $incident->id,
                1,
                ['toStatus' => 'in_progress', 'reason' => 'Race eligibility harus fail closed.'],
            );
            $this->fail('Expected changed assignee eligibility to fail closed.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_ASSIGNEE_INELIGIBLE', $exception->errorCode);
        } finally {
            Event::forget('eloquent.retrieved: '.SchoolMembership::class);
        }

        $this->assertSame('resolved', $incident->fresh()->status->value);
        $this->assertSame(1, $incident->fresh()->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_transition_into_in_progress_locks_assignee_user_then_membership_before_incident(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $assignee = $this->candidate($school, 'Teknisi Lock', ['incidents.update']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setResolvedState($incident, $assignee, started: true);
        $membership->setRelation('user', $user);
        DB::flushQueryLog();
        DB::enableQueryLog();

        app(IncidentTransitionService::class)->transition(
            new CurrentMembershipContext($membership, collect(['incidents.view', 'incidents.approve'])),
            $incident->id,
            1,
            ['toStatus' => 'in_progress', 'reason' => 'Validasi urutan lock canonical.'],
        );

        $selects = collect(DB::getQueryLog())
            ->pluck('query')
            ->filter(fn (string $sql): bool => str_starts_with(strtolower($sql), 'select'))
            ->values();
        $incidentIndexes = $selects->keys()->filter(fn (int $index): bool => str_contains($selects[$index], 'from "incidents"'))->values();
        $membershipIndexes = $selects->keys()->filter(fn (int $index): bool => str_contains($selects[$index], 'from "school_memberships"'))->values();
        $userIndex = $selects->search(fn (string $sql): bool => str_contains($sql, 'from "users"'));

        $this->assertCount(2, $incidentIndexes);
        $this->assertGreaterThanOrEqual(2, $membershipIndexes->count());
        $this->assertIsInt($userIndex);
        $this->assertGreaterThan($membershipIndexes->first(), $userIndex);
        $this->assertLessThan($membershipIndexes->last(), $userIndex);
        $this->assertLessThan($incidentIndexes->last(), $membershipIndexes->last());
    }

    public function test_event_failure_rolls_back_transition_root_version_and_evidence(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.approve']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $membership->setRelation('user', $user);
        Event::listen('eloquent.creating: '.IncidentEvent::class, static function (): never {
            throw new RuntimeException('forced transition event failure');
        });

        try {
            app(IncidentTransitionService::class)->transition(
                new CurrentMembershipContext($membership, collect(['incidents.view', 'incidents.approve'])),
                $incident->id,
                1,
                ['toStatus' => 'triaged', 'triageSummary' => 'Incident sudah ditinjau.'],
            );
            $this->fail('Expected the event write to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('forced transition event failure', $exception->getMessage());
        } finally {
            Event::forget('eloquent.creating: '.IncidentEvent::class);
        }

        $incident->refresh();
        $this->assertSame('reported', $incident->status->value);
        $this->assertNull($incident->triage_summary);
        $this->assertNull($incident->triaged_at);
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    #[DataProvider('invalidTerminalOrSameStatusProvider')]
    public function test_terminal_same_status_and_unsupported_edges_return_invalid_transition(string $from, string $to): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions([
            'incidents.view', 'incidents.approve', 'incidents.update', 'incidents.assign',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setStatus($incident, $from, $membership);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/transitions', [
            'toStatus' => $to,
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_INVALID_TRANSITION');
        $this->assertSame(1, $incident->fresh()->version);
    }

    public static function invalidTerminalOrSameStatusProvider(): array
    {
        return [
            'reported same status' => ['reported', 'reported'],
            'closed terminal' => ['closed', 'reported'],
            'rejected terminal' => ['rejected', 'triaged'],
            'verified backwards' => ['verified', 'resolved'],
        ];
    }

    public function test_transition_route_uses_only_base_view_and_version_precondition_as_static_authorization(): void
    {
        $transition = collect(Route::getRoutes()->getRoutes())
            ->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}/transitions');
        $middleware = array_values($transition->gatherMiddleware());
        $view = array_search('permission:incidents.view', $middleware, true);
        $precondition = array_search('App\\Http\\Middleware\\RequireIncidentVersionPrecondition', $middleware, true);

        $this->assertIsInt($view);
        $this->assertIsInt($precondition);
        $this->assertLessThan($precondition, $view);
        $this->assertNotContains('permission:incidents.approve', $middleware);
        $this->assertNotContains('permission:incidents.update', $middleware);
        $this->assertNotContains('permission:incidents.assign', $middleware);
    }

    /** @return array{User, School, SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($membership, $permissions);
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @param list<string> $permissions */
    private function grantPermissions(SchoolMembership $membership, array $permissions): void
    {
        if ($permissions === []) {
            return;
        }
        $role = Role::factory()->create();
        $permissionIds = collect($permissions)->map(fn (string $key): string => Permission::query()->firstOrCreate(
            ['key' => $key],
            ['name' => $key],
        )->id);
        $membership->roles()->attach($role->id);
        $role->permissions()->attach($permissionIds);
    }

    private function candidate(
        School $school,
        string $name,
        array $permissions,
        string $membershipStatus = 'active',
        string $userStatus = 'active',
    ): SchoolMembership {
        $user = User::factory()->create(['name' => $name, 'status' => $userStatus]);
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => $membershipStatus,
        ]);
        $this->grantPermissions($membership, $permissions);

        return $membership;
    }

    /** @return array{User, SchoolMembership} */
    private function reporter(School $school): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);

        return [$user, $membership];
    }

    /** @param array{User, SchoolMembership} $reporter */
    private function createIncidentFor(array $reporter, School $school): Incident
    {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);

        return app(IncidentCreationService::class)->create(
            new CurrentMembershipContext($membership, collect()),
            strtolower((string) Str::uuid()),
            [
                'laboratoryId' => $laboratory->id,
                'deviceId' => null,
                'category' => 'hardware',
                'priority' => 'normal',
                'title' => 'Desktop gagal menyala',
                'description' => 'Desktop berhenti sebelum sistem operasi dimuat.',
                'impact' => null,
                'blocksLaboratoryOperation' => false,
                'stepsTaken' => null,
                'occurredAt' => now()->subMinute()->utc()->format('Y-m-d\TH:i:s.u\Z'),
            ],
        )->incident;
    }

    private function setTriagedState(Incident $incident): void
    {
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'triaged',
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => now()->subMinutes(4),
        ]);
    }

    private function setAssignedState(Incident $incident, SchoolMembership $assignee, bool $inProgress = false): void
    {
        $user = $assignee->user()->firstOrFail();
        $assignedAt = now()->subMinutes(3);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => $inProgress ? 'in_progress' : 'assigned',
            'assignee_membership_id' => $assignee->id,
            'assignee_user_id_snapshot' => $user->id,
            'assignee_name_snapshot' => $user->name,
            'assigned_at' => $assignedAt,
            'started_at' => $inProgress ? now()->subMinutes(2) : null,
        ]);
    }

    private function setResolvedState(
        Incident $incident,
        ?SchoolMembership $assignee = null,
        bool $started = false,
    ): void {
        $this->setTriagedState($incident);
        if ($assignee !== null) {
            $this->setAssignedState($incident, $assignee, $started);
        }
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'resolved',
            'resolution_summary' => 'Incident telah diselesaikan.',
            'resolved_at' => now()->subMinute(),
        ]);
    }

    private function setVerifiedState(Incident $incident, ?SchoolMembership $assignee = null): void
    {
        $this->setResolvedState($incident, $assignee, started: $assignee !== null);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'verified',
            'verification_note' => 'Hasil sudah diverifikasi.',
            'verified_at' => now()->subSeconds(30),
        ]);
    }

    private function setStatus(Incident $incident, string $status, SchoolMembership $actorMembership): void
    {
        match ($status) {
            'reported' => null,
            'triaged' => $this->setTriagedState($incident),
            'assigned' => (function () use ($incident, $actorMembership): void {
                $this->setTriagedState($incident);
                $this->setAssignedState($incident, $actorMembership);
            })(),
            'in_progress' => (function () use ($incident, $actorMembership): void {
                $this->setTriagedState($incident);
                $this->setAssignedState($incident, $actorMembership, true);
            })(),
            'resolved' => $this->setResolvedState($incident),
            'verified' => $this->setVerifiedState($incident),
            'closed' => (function () use ($incident): void {
                $this->setVerifiedState($incident);
                DB::table('incidents')->where('id', $incident->id)->update([
                    'status' => 'closed',
                    'closed_at' => now(),
                ]);
            })(),
            'rejected' => DB::table('incidents')->where('id', $incident->id)->update([
                'status' => 'rejected',
                'rejection_reason' => 'Laporan tidak dapat diverifikasi.',
                'rejected_at' => now(),
            ]),
        };
    }

    private function event(Incident $incident, IncidentEventType $type): IncidentEvent
    {
        return IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', $type->value)
            ->sole();
    }
}
