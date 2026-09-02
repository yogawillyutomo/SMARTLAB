<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentAssignmentService;
use App\Application\Incident\IncidentCreationService;
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

class IncidentAssignmentApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_assignee_candidates_require_assign_permission_only_and_return_minimal_eligible_projection(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.assign']);
        $eligibleA = $this->candidate($school, 'zeta teknisi', ['incidents.update']);
        $eligibleB = $this->candidate($school, 'Alpha Teknisi', ['incidents.update']);
        $this->candidate($school, 'Inactive Membership', ['incidents.update'], membershipStatus: 'inactive');
        $this->candidate($school, 'Inactive User', ['incidents.update'], userStatus: 'inactive');
        $this->candidate($school, 'No Update', []);
        $otherSchool = School::factory()->create();
        $this->candidate($otherSchool, 'Cross School', ['incidents.update']);

        $response = $this->getJson('/api/v1/incidents/assignee-candidates')
            ->assertOk()
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('meta.perPage', 25)
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.lastPage', 1);

        $this->assertSame([$eligibleB->id, $eligibleA->id], array_column($response->json('data'), 'membershipId'));
        $this->assertSame(['membershipId', 'user'], array_keys($response->json('data.0')));
        $this->assertSame(['id', 'name'], array_keys($response->json('data.0.user')));
        $serialized = json_encode($response->json(), JSON_THROW_ON_ERROR);
        foreach (['email', 'phone', 'nip', 'nis', 'roles', 'permissions', 'status'] as $forbidden) {
            $this->assertStringNotContainsString('"'.$forbidden.'"', $serialized);
        }
    }

    public function test_assignee_candidate_search_is_trimmed_literal_name_only_and_paginated(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.assign']);
        $match = $this->candidate($school, 'Teknisi 100% Aman', ['incidents.update']);
        $bang = $this->candidate($school, 'Teknisi Wow! Aman', ['incidents.update']);
        $this->candidate($school, 'Teknisi Lain', ['incidents.update']);

        $this->getJson('/api/v1/incidents/assignee-candidates?'.http_build_query(['search' => '  100%  ']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.membershipId', $match->id);
        $this->getJson('/api/v1/incidents/assignee-candidates?'.http_build_query(['search' => '100_']))
            ->assertOk()
            ->assertJsonPath('data', []);
        $this->getJson('/api/v1/incidents/assignee-candidates?'.http_build_query(['search' => 'Wow!']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.membershipId', $bang->id);
        $this->getJson('/api/v1/incidents/assignee-candidates?search=x')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->getJson('/api/v1/incidents/assignee-candidates?unknown=1')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_candidate_endpoint_rejects_guest_and_missing_assign_permission(): void
    {
        $this->getJson('/api/v1/incidents/assignee-candidates')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $this->authenticateWithPermissions(['incidents.view']);
        $this->getJson('/api/v1/incidents/assignee-candidates')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    #[DataProvider('missingAssignmentPermissionProvider')]
    public function test_assignment_permission_failures_precede_precondition_and_body_validation(array $permissions): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($permissions);
        $incident = $this->triagedIncident([$user, $membership], $school);

        $this->postJson(
            '/api/v1/incidents/'.$incident->id.'/assignments',
            ['forged' => true],
            ['If-Match' => 'W/"1"'],
        )->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
    }

    public static function missingAssignmentPermissionProvider(): array
    {
        return [
            'view' => [['incidents.assign']],
            'assign' => [['incidents.view']],
        ];
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_assignment_requires_exact_incident_if_match(mixed $header): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);
        $headers = $header === null ? [] : ['If-Match' => $header];

        $this->postJson(
            '/api/v1/incidents/'.$incident->id.'/assignments',
            ['assigneeMembershipId' => $candidate->id],
            $headers,
        )->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');
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

    public function test_structural_assignment_validation_precedes_incident_visibility(): void
    {
        $this->authenticateWithPermissions($this->assignmentPermissions());
        $unknown = strtolower((string) Str::ulid());

        foreach ([
            [],
            ['assigneeMembershipId' => 'not-ulid'],
            ['assigneeMembershipId' => strtolower((string) Str::ulid()), 'status' => 'assigned'],
        ] as $payload) {
            $this->postJson('/api/v1/incidents/'.$unknown.'/assignments', $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }
        $this->postJson(
            '/api/v1/incidents/'.$unknown.'/assignments?force=true',
            ['assigneeMembershipId' => strtolower((string) Str::ulid())],
            ['If-Match' => '"1"'],
        )->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_assignment_visibility_matches_incident_row_policy_before_candidate_disclosure(): void
    {
        [, $school] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $hidden = $this->triagedIncident($this->reporter($school), $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);

        $this->postJson(
            '/api/v1/incidents/'.$hidden->id.'/assignments',
            ['assigneeMembershipId' => $candidate->id],
            ['If-Match' => '"1"'],
        )->assertNotFound()->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
    }

    public function test_initial_assignment_sets_status_snapshots_time_version_and_exact_event_atomically(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi Utama', ['incidents.update']);
        $candidateUser = $candidate->user()->firstOrFail();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => strtoupper($candidate->id),
            'reason' => '  Penugasan awal  ',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.assignee.membershipId', $candidate->id)
            ->assertJsonPath('data.assignee.userId', $candidateUser->id)
            ->assertJsonPath('data.assignee.name', 'Teknisi Utama');

        $incident->refresh();
        $this->assertSame('assigned', $incident->status->value);
        $this->assertSame($candidate->id, $incident->assignee_membership_id);
        $this->assertSame($candidateUser->id, $incident->assignee_user_id_snapshot);
        $this->assertSame('Teknisi Utama', $incident->assignee_name_snapshot);
        $this->assertNotNull($incident->assigned_at);
        $this->assertSame(2, $incident->version);

        $event = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Assigned->value)->sole();
        $this->assertSame(1, $event->incident_version_before);
        $this->assertSame(2, $event->incident_version_after);
        $this->assertSame([
            'assignee' => [
                'membershipId' => $candidate->id,
                'userId' => $candidateUser->id,
                'name' => 'Teknisi Utama',
            ],
            'reason' => 'Penugasan awal',
        ], $event->payload);
    }

    public function test_same_assignee_is_current_version_no_op_even_with_reason_and_stale_no_op_is_412(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
        ], ['If-Match' => '"1"'])->assertOk()->assertHeader('ETag', '"2"');
        $incident->refresh();
        $updatedAt = $incident->updated_at?->toISOString();
        $assignedAt = $incident->assigned_at?->toISOString();
        $eventCount = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
            'reason' => 'ignored on same assignee',
        ], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertSame($updatedAt, $incident->updated_at?->toISOString());
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertSame($eventCount, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
        ], ['If-Match' => '"1"'])->assertStatus(412)->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
    }

    public function test_reassignment_requires_reason_preserves_status_and_assignment_time_and_records_both_snapshots(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $first = $this->candidate($school, 'Teknisi Pertama', ['incidents.update']);
        $second = $this->candidate($school, 'Teknisi Kedua', ['incidents.update']);
        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $first->id,
        ], ['If-Match' => '"1"'])->assertOk();
        $assignedAt = $incident->fresh()->assigned_at?->toISOString();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $second->id,
            'reason' => 'abc',
        ], ['If-Match' => '"2"'])->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $second->id,
            'reason' => '  Pergantian penanggung jawab  ',
        ], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.assignee.membershipId', $second->id)
            ->assertJsonPath('data.version', 3);

        $incident->refresh();
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $event = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Reassigned->value)->sole();
        $this->assertSame($first->id, $event->payload['previousAssignee']['membershipId']);
        $this->assertSame($second->id, $event->payload['newAssignee']['membershipId']);
        $this->assertSame('Pergantian penanggung jawab', $event->payload['reason']);
    }

    public function test_reassignment_while_in_progress_preserves_in_progress_and_first_start_time(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $first = $this->candidate($school, 'Teknisi Pertama', ['incidents.update']);
        $second = $this->candidate($school, 'Teknisi Kedua', ['incidents.update']);
        $incident = $this->triagedIncident([$user, $membership], $school);
        $this->setAssignedState($incident, $first, inProgress: true);
        $startedAt = $incident->fresh()->started_at?->toISOString();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $second->id,
            'reason' => 'Shift teknisi diganti',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertSame($startedAt, $incident->started_at?->toISOString());
    }

    public function test_resolved_reassignment_preserves_resolution_assignment_and_start_evidence(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $first = $this->candidate($school, 'Teknisi Pertama', ['incidents.update']);
        $second = $this->candidate($school, 'Teknisi Kedua', ['incidents.update']);
        $incident = $this->triagedIncident([$user, $membership], $school);
        $this->setAssignedState($incident, $first, inProgress: true);
        $this->setResolvedState($incident);

        $before = $incident->fresh();
        $assignedAt = $before->assigned_at?->toISOString();
        $startedAt = $before->started_at?->toISOString();
        $resolvedAt = $before->resolved_at?->toISOString();
        $resolutionSummary = $before->resolution_summary;

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $second->id,
            'reason' => 'Recovery penanggung jawab setelah resolusi',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.assignee.membershipId', $second->id)
            ->assertJsonPath('data.version', 2);

        $incident->refresh();
        $this->assertSame('resolved', $incident->status->value);
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertSame($startedAt, $incident->started_at?->toISOString());
        $this->assertSame($resolvedAt, $incident->resolved_at?->toISOString());
        $this->assertSame($resolutionSummary, $incident->resolution_summary);

        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Reassigned->value)
            ->sole();
        $this->assertSame($first->id, $event->payload['previousAssignee']['membershipId']);
        $this->assertSame($second->id, $event->payload['newAssignee']['membershipId']);
        $this->assertSame('Recovery penanggung jawab setelah resolusi', $event->payload['reason']);
    }

    public function test_resolved_without_current_assignee_snapshots_rejects_assignment(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $this->setResolvedState($incident);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
            'reason' => 'Tidak boleh menjadi initial assignment',
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_STATUS_CONFLICT');

        $incident->refresh();
        $this->assertSame('resolved', $incident->status->value);
        $this->assertNull($incident->assignee_membership_id);
        $this->assertNull($incident->assignee_user_id_snapshot);
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_same_live_assignee_is_version_protected_no_op_while_resolved(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);
        $incident = $this->triagedIncident([$user, $membership], $school);
        $this->setAssignedState($incident, $candidate, inProgress: true);
        $this->setResolvedState($incident);

        $before = $incident->fresh();
        $updatedAt = $before->updated_at?->toISOString();
        $eventCount = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count();

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
            'reason' => 'Reason ignored for same live assignee',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.version', 1);

        $incident->refresh();
        $this->assertSame($updatedAt, $incident->updated_at?->toISOString());
        $this->assertSame(
            $eventCount,
            IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count(),
        );

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
        ], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
    }

    #[DataProvider('degradedAssignmentRecoveryProvider')]
    public function test_deleted_live_assignee_can_be_recovered_before_resolution(
        string $status,
        bool $inProgress,
    ): void {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $first = $this->candidate($school, 'Teknisi Lama', ['incidents.update']);
        $replacement = $this->candidate($school, 'Teknisi Pengganti', ['incidents.update']);
        $incident = $this->triagedIncident([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $first->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"');

        $assignedBeforeDelete = $incident->fresh();
        $assignedAt = $assignedBeforeDelete->assigned_at?->toISOString();

        if ($inProgress) {
            $startedAt = now()->subMinute();
            DB::table('incidents')->where('id', $incident->id)->update([
                'status' => 'in_progress',
                'started_at' => $startedAt,
            ]);
        }

        $beforeDelete = $incident->fresh();
        $startedAt = $beforeDelete->started_at?->toISOString();
        $oldMembershipId = $first->id;
        $oldUserId = $first->user_id;

        $first->delete();

        $incident->refresh();
        $this->assertSame($status, $incident->status->value);
        $this->assertNull($incident->assignee_membership_id);
        $this->assertSame($oldUserId, $incident->assignee_user_id_snapshot);
        $this->assertSame('Teknisi Lama', $incident->assignee_name_snapshot);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $replacement->id,
            'reason' => 'Pulihkan penanggung jawab yang sudah terhapus',
        ], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', $status)
            ->assertJsonPath('data.assignee.membershipId', $replacement->id)
            ->assertJsonPath('data.version', 3);

        $incident->refresh();
        $this->assertSame($status, $incident->status->value);
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertSame($startedAt, $incident->started_at?->toISOString());

        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Reassigned->value)
            ->sole();

        $this->assertSame(2, $event->incident_version_before);
        $this->assertSame(3, $event->incident_version_after);
        $this->assertSame($oldMembershipId, $event->payload['previousAssignee']['membershipId']);
        $this->assertSame($oldUserId, $event->payload['previousAssignee']['userId']);
        $this->assertSame('Teknisi Lama', $event->payload['previousAssignee']['name']);
        $this->assertSame($replacement->id, $event->payload['newAssignee']['membershipId']);
        $this->assertDatabaseCount('incident_events', 3);
    }

    public static function degradedAssignmentRecoveryProvider(): array
    {
        return [
            'assigned' => ['assigned', false],
            'in_progress' => ['in_progress', true],
        ];
    }

    public function test_deleted_live_assignee_recovery_uses_latest_immutable_assignment_membership_id(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $first = $this->candidate($school, 'Teknisi Pertama', ['incidents.update']);
        $second = $this->candidate($school, 'Teknisi Kedua', ['incidents.update']);
        $replacement = $this->candidate($school, 'Teknisi Pengganti', ['incidents.update']);
        $incident = $this->triagedIncident([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $first->id,
        ], ['If-Match' => '"1"'])->assertOk()->assertHeader('ETag', '"2"');

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $second->id,
            'reason' => 'Pergantian sebelum incident resolved',
        ], ['If-Match' => '"2"'])->assertOk()->assertHeader('ETag', '"3"');

        $this->setResolvedState($incident);
        $resolvedBeforeDelete = $incident->fresh();
        $assignedAt = $resolvedBeforeDelete->assigned_at?->toISOString();
        $resolvedAt = $resolvedBeforeDelete->resolved_at?->toISOString();
        $resolutionSummary = $resolvedBeforeDelete->resolution_summary;
        $secondId = $second->id;
        $secondUserId = $second->user_id;

        $second->delete();

        $incident->refresh();
        $this->assertNull($incident->assignee_membership_id);
        $this->assertSame($secondUserId, $incident->assignee_user_id_snapshot);
        $this->assertSame('Teknisi Kedua', $incident->assignee_name_snapshot);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $replacement->id,
            'reason' => 'Pulihkan live assignee yang sudah terhapus',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.assignee.membershipId', $replacement->id)
            ->assertJsonPath('data.version', 4);

        $incident->refresh();
        $this->assertSame($assignedAt, $incident->assigned_at?->toISOString());
        $this->assertSame($resolvedAt, $incident->resolved_at?->toISOString());
        $this->assertSame($resolutionSummary, $incident->resolution_summary);

        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Reassigned->value)
            ->orderByDesc('incident_version_after')
            ->firstOrFail();
        $this->assertSame(3, $event->incident_version_before);
        $this->assertSame(4, $event->incident_version_after);
        $this->assertSame($secondId, $event->payload['previousAssignee']['membershipId']);
        $this->assertSame($secondUserId, $event->payload['previousAssignee']['userId']);
        $this->assertSame('Teknisi Kedua', $event->payload['previousAssignee']['name']);
        $this->assertSame($replacement->id, $event->payload['newAssignee']['membershipId']);
        $this->assertDatabaseCount('incident_events', 4);
    }

    public function test_unknown_and_cross_school_candidates_are_safe_not_found_and_known_ineligible_candidates_are_409(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $otherSchool = School::factory()->create();
        $crossSchool = $this->candidate($otherSchool, 'Cross School', ['incidents.update']);
        $inactiveMembership = $this->candidate($school, 'Inactive Membership', ['incidents.update'], membershipStatus: 'inactive');
        $inactiveUser = $this->candidate($school, 'Inactive User', ['incidents.update'], userStatus: 'inactive');
        $noPermission = $this->candidate($school, 'No Permission', []);

        foreach ([strtolower((string) Str::ulid()), $crossSchool->id] as $candidateId) {
            $incident = $this->triagedIncident([$user, $membership], $school);
            $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
                'assigneeMembershipId' => $candidateId,
            ], ['If-Match' => '"1"'])
                ->assertNotFound()
                ->assertJsonPath('code', 'INCIDENT_ASSIGNEE_NOT_FOUND');
            $this->assertSame(1, $incident->fresh()->version);
        }

        foreach ([$inactiveMembership, $inactiveUser, $noPermission] as $candidate) {
            $incident = $this->triagedIncident([$user, $membership], $school);
            $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
                'assigneeMembershipId' => $candidate->id,
            ], ['If-Match' => '"1"'])
                ->assertConflict()
                ->assertJsonPath('code', 'INCIDENT_ASSIGNEE_INELIGIBLE');
            $this->assertSame(1, $incident->fresh()->version);
            $this->assertNull($incident->fresh()->assignee_membership_id);
        }
    }

    public function test_stale_version_wins_before_locked_candidate_eligibility_evaluation(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Inactive Candidate', ['incidents.update'], membershipStatus: 'inactive');

        DB::table('incidents')->where('id', $incident->id)->update(['version' => 2]);
        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
        ], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
    }

    #[DataProvider('nonAssignableStatusProvider')]
    public function test_non_assignable_statuses_return_status_conflict_without_mutation(string $status): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->createIncidentFor([$user, $membership], Laboratory::factory()->for($school)->create());
        $this->setStatus($incident, $status, $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/assignments', [
            'assigneeMembershipId' => $candidate->id,
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_STATUS_CONFLICT');
        $this->assertSame(1, $incident->fresh()->version);
    }

    public static function nonAssignableStatusProvider(): array
    {
        return collect(['reported', 'verified', 'closed', 'rejected'])
            ->mapWithKeys(fn (string $status): array => [$status => [$status]])
            ->all();
    }

    public function test_candidate_eligibility_change_between_routing_read_and_lock_fails_closed(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);
        $membership->setRelation('user', $user);
        $inject = true;

        Event::listen('eloquent.retrieved: '.SchoolMembership::class, function (SchoolMembership $retrieved) use (&$inject, $candidate): void {
            if (! $inject || $retrieved->id !== $candidate->id) {
                return;
            }
            $inject = false;
            DB::table('school_memberships')->where('id', $candidate->id)->update(['status' => 'inactive']);
        });

        try {
            app(IncidentAssignmentService::class)->assign(
                new CurrentMembershipContext($membership, collect($this->assignmentPermissions())),
                $incident->id,
                1,
                ['assigneeMembershipId' => $candidate->id],
            );
            $this->fail('Expected the changed candidate eligibility to fail closed.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_ASSIGNEE_INELIGIBLE', $exception->errorCode);
        } finally {
            Event::forget('eloquent.retrieved: '.SchoolMembership::class);
        }

        $this->assertSame(1, $incident->fresh()->version);
        $this->assertNull($incident->fresh()->assignee_membership_id);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_assignment_lock_order_is_candidate_user_then_membership_then_incident(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);
        $membership->setRelation('user', $user);
        DB::flushQueryLog();
        DB::enableQueryLog();

        app(IncidentAssignmentService::class)->assign(
            new CurrentMembershipContext($membership, collect($this->assignmentPermissions())),
            $incident->id,
            1,
            ['assigneeMembershipId' => $candidate->id],
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
        $this->assertLessThan($userIndex, $membershipIndexes->first());
        $this->assertGreaterThan($userIndex, $membershipIndexes->last());
        $this->assertGreaterThan($membershipIndexes->last(), $incidentIndexes->last());
    }

    public function test_event_failure_rolls_back_assignment_root_version_and_values(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->assignmentPermissions());
        $incident = $this->triagedIncident([$user, $membership], $school);
        $candidate = $this->candidate($school, 'Teknisi', ['incidents.update']);
        $membership->setRelation('user', $user);
        Event::listen('eloquent.creating: '.IncidentEvent::class, static function (): never {
            throw new RuntimeException('forced assignment event failure');
        });

        try {
            app(IncidentAssignmentService::class)->assign(
                new CurrentMembershipContext($membership, collect($this->assignmentPermissions())),
                $incident->id,
                1,
                ['assigneeMembershipId' => $candidate->id],
            );
            $this->fail('Expected the event write to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('forced assignment event failure', $exception->getMessage());
        } finally {
            Event::forget('eloquent.creating: '.IncidentEvent::class);
        }

        $incident->refresh();
        $this->assertSame('triaged', $incident->status->value);
        $this->assertNull($incident->assignee_membership_id);
        $this->assertNull($incident->assigned_at);
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_routes_keep_static_candidate_order_and_exact_assignment_middleware_order(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/incidents'))
            ->values();
        $candidate = $routes->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/assignee-candidates');
        $detail = $routes->first(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}');
        $this->assertLessThan($routes->search($detail), $routes->search($candidate));
        $this->assertContains('permission:incidents.assign', $candidate->gatherMiddleware());
        $this->assertNotContains('permission:incidents.view', $candidate->gatherMiddleware());

        $assignment = $routes->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}/assignments');
        $middleware = array_values($assignment->gatherMiddleware());
        $view = array_search('permission:incidents.view', $middleware, true);
        $assign = array_search('permission:incidents.assign', $middleware, true);
        $precondition = array_search('App\\Http\\Middleware\\RequireIncidentVersionPrecondition', $middleware, true);
        $this->assertIsInt($view);
        $this->assertIsInt($assign);
        $this->assertIsInt($precondition);
        $this->assertLessThan($assign, $view);
        $this->assertLessThan($precondition, $assign);
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
    private function triagedIncident(array $reporter, School $school): Incident
    {
        $incident = $this->createIncidentFor(
            $reporter,
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'triaged',
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => now()->subMinute(),
        ]);

        return $incident->fresh();
    }

    /** @param array{User, SchoolMembership} $reporter */
    private function createIncidentFor(array $reporter, Laboratory $laboratory): Incident
    {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);

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

    private function setAssignedState(Incident $incident, SchoolMembership $assignee, bool $inProgress = false): void
    {
        $user = $assignee->user()->firstOrFail();
        $now = now()->subMinute();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => $inProgress ? 'in_progress' : 'assigned',
            'assignee_membership_id' => $assignee->id,
            'assignee_user_id_snapshot' => $user->id,
            'assignee_name_snapshot' => $user->name,
            'assigned_at' => $now,
            'started_at' => $inProgress ? $now : null,
        ]);
    }

    private function setResolvedState(Incident $incident): void
    {
        $now = now()->subMinute();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'resolved',
            'resolution_summary' => 'Incident telah diselesaikan.',
            'resolved_at' => $now,
        ]);
    }

    private function setStatus(Incident $incident, string $status, School $school): void
    {
        if ($status === 'reported') {
            return;
        }
        $now = now()->subMinute();
        $attributes = [
            'status' => $status,
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => $now,
        ];
        if (in_array($status, ['resolved', 'verified', 'closed'], true)) {
            $attributes['resolution_summary'] = 'Incident telah diselesaikan.';
            $attributes['resolved_at'] = $now;
        }
        if (in_array($status, ['verified', 'closed'], true)) {
            $attributes['verification_note'] = 'Hasil sudah diverifikasi.';
            $attributes['verified_at'] = $now;
        }
        if ($status === 'closed') {
            $attributes['closed_at'] = $now;
        }
        if ($status === 'rejected') {
            $attributes = [
                'status' => 'rejected',
                'rejection_reason' => 'Laporan tidak dapat diverifikasi.',
                'rejected_at' => $now,
            ];
        }
        DB::table('incidents')->where('id', $incident->id)->update($attributes);
    }

    /** @return list<string> */
    private function assignmentPermissions(): array
    {
        return ['incidents.view', 'incidents.assign'];
    }
}
