<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentEndToEndApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_e1_through_e13_complete_incident_flow_stays_versioned_and_snapshot_backed(): void
    {
        [$admin, $school, $adminMembership] = $this->authenticateWithPermissions($this->fullIncidentPermissions());
        $laboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-UAT',
            'name' => 'Lab UAT',
        ]);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-UAT-01',
            'lifecycle_status' => 'in_service',
        ]);
        [, $technicianMembership] = $this->member($school, 'Teknisi UAT', ['incidents.update']);

        // E1 reporting Laboratories.
        $this->getJson('/api/v1/incidents/reporting-context/laboratories?search=LAB-UAT')
            ->assertOk()
            ->assertJsonPath('data.0.id', $laboratory->id)
            ->assertJsonPath('data.0.code', 'LAB-UAT');

        // E2 bounded Device discovery.
        $this->getJson('/api/v1/incidents/reporting-context/laboratories/'.$laboratory->id.'/devices?search=PC-UAT')
            ->assertOk()
            ->assertJsonPath('data.0.id', $device->id)
            ->assertJsonPath('data.0.deviceCode', 'PC-UAT-01')
            ->assertJsonPath('meta.hasMore', false);

        $submissionId = strtolower((string) Str::uuid());
        $create = $this->postJson('/api/v1/incidents', $this->createPayload($submissionId, $laboratory, $device))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.status', 'reported')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.reporter.userId', $admin->id)
            ->assertJsonPath('data.laboratory.id', $laboratory->id)
            ->assertJsonPath('data.device.id', $device->id);

        $incidentId = $create->json('data.id');
        $ticketNumber = $create->json('data.ticketNumber');

        // E4 create recovery.
        $this->getJson('/api/v1/incidents/submissions/'.$submissionId)
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.id', $incidentId)
            ->assertJsonPath('data.ticketNumber', $ticketNumber);

        // E5 list and E7 detail.
        $this->getJson('/api/v1/incidents?search='.urlencode((string) $ticketNumber))
            ->assertOk()
            ->assertJsonPath('data.0.id', $incidentId)
            ->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/incidents/'.$incidentId)
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.version', 1);

        // E8 reported-state correction.
        $this->patchJson('/api/v1/incidents/'.$incidentId, [
            'title' => 'Komputer laboratorium gagal melakukan boot ulang',
            'priority' => 'high',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.title', 'Komputer laboratorium gagal melakukan boot ulang')
            ->assertJsonPath('data.priority', 'high')
            ->assertJsonPath('data.version', 2);

        // Stale concurrency must win before any later edge-specific decision.
        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Triage end-to-end.',
        ], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
        $this->assertSame(2, Incident::query()->findOrFail($incidentId)->version);
        $this->assertSame(2, IncidentEvent::query()->where('incident_id_snapshot', $incidentId)->count());

        // E3 assignee discovery.
        $this->getJson('/api/v1/incidents/assignee-candidates?search=Teknisi%20UAT')
            ->assertOk()
            ->assertJsonPath('data.0.membershipId', $technicianMembership->id)
            ->assertJsonPath('data.0.user.name', 'Teknisi UAT');

        // E10 reported -> triaged.
        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Triage end-to-end selesai.',
        ], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'triaged')
            ->assertJsonPath('data.version', 3);

        // E9 assignment.
        $this->postJson('/api/v1/incidents/'.$incidentId.'/assignments', [
            'assigneeMembershipId' => $technicianMembership->id,
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.assignee.membershipId', $technicianMembership->id)
            ->assertJsonPath('data.version', 4);

        // E10 assigned -> in_progress, using the documented incidents.assign override.
        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'in_progress',
        ], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 5);

        // E11 append-only participant comment.
        $comment = $this->postJson('/api/v1/incidents/'.$incidentId.'/comments', [
            'text' => 'Perangkat sedang diuji setelah pemeriksaan awal.',
        ], ['If-Match' => '"5"'])
            ->assertCreated()
            ->assertHeader('ETag', '"6"')
            ->assertJsonPath('data.text', 'Perangkat sedang diuji setelah pemeriksaan awal.');
        $commentId = $comment->json('data.id');

        // E12 participant-safe comment projection.
        $this->getJson('/api/v1/incidents/'.$incidentId.'/comments')
            ->assertOk()
            ->assertJsonPath('data.0.id', $commentId)
            ->assertJsonPath('data.0.actor.userId', $admin->id)
            ->assertJsonPath('data.0.text', 'Perangkat sedang diuji setelah pemeriksaan awal.')
            ->assertJsonMissingPath('data.0.actor.membershipId')
            ->assertJsonMissingPath('data.0.payload');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Boot normal setelah konektor daya dipasang ulang.',
        ], ['If-Match' => '"6"'])
            ->assertOk()
            ->assertHeader('ETag', '"7"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.version', 7);

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'verified',
            'verificationNote' => 'Diverifikasi dengan dua kali cold boot.',
        ], ['If-Match' => '"7"'])
            ->assertOk()
            ->assertHeader('ETag', '"8"')
            ->assertJsonPath('data.status', 'verified')
            ->assertJsonPath('data.version', 8);

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'closed',
        ], ['If-Match' => '"8"'])
            ->assertOk()
            ->assertHeader('ETag', '"9"')
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.version', 9);

        // Terminal state remains readable but rejects a new comment.
        $this->getJson('/api/v1/incidents/'.$incidentId.'/comments')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);
        $this->postJson('/api/v1/incidents/'.$incidentId.'/comments', [
            'text' => 'Komentar baru tidak boleh masuk setelah closed.',
        ], ['If-Match' => '"9"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_STATUS_CONFLICT');

        // E13 complete internal immutable event history.
        $events = $this->getJson('/api/v1/incidents/'.$incidentId.'/events')
            ->assertOk()
            ->assertJsonPath('meta.total', 9)
            ->assertJsonPath('data.0.eventType', 'incident.closed')
            ->assertJsonPath('data.0.incidentVersionBefore', 8)
            ->assertJsonPath('data.0.incidentVersionAfter', 9)
            ->assertJsonPath('data.8.eventType', 'incident.reported')
            ->assertJsonPath('data.8.incidentVersionBefore', 0)
            ->assertJsonPath('data.8.incidentVersionAfter', 1);

        $this->assertSame([
            'incident.closed',
            'incident.verified',
            'incident.resolved',
            'incident.comment_added',
            'incident.started',
            'incident.assigned',
            'incident.triaged',
            'incident.updated',
            'incident.reported',
        ], collect($events->json('data'))->pluck('eventType')->all());
        $this->assertSame(9, Incident::query()->findOrFail($incidentId)->version);
        $this->assertSame(9, IncidentEvent::query()->where('incident_id_snapshot', $incidentId)->count());
        $this->assertSame($adminMembership->id, $events->json('data.0.actor.membershipId'));
    }

    public function test_cross_tenant_gate_hides_incident_and_submission_across_all_row_scoped_surfaces(): void
    {
        [, $schoolA] = $this->authenticateWithPermissions($this->fullIncidentPermissions());
        $laboratoryA = Laboratory::factory()->for($schoolA)->create([
            'status' => 'active',
            'code' => 'LAB-A',
        ]);
        $deviceA = Device::factory()->for($schoolA)->create([
            'home_laboratory_id' => $laboratoryA->id,
            'device_code' => 'PC-A-01',
            'lifecycle_status' => 'in_service',
        ]);
        $submissionId = strtolower((string) Str::uuid());
        $created = $this->postJson('/api/v1/incidents', $this->createPayload($submissionId, $laboratoryA, $deviceA))
            ->assertCreated();
        $incidentId = $created->json('data.id');

        [, $schoolB, $membershipB] = $this->authenticateWithPermissions($this->fullIncidentPermissions(), School::factory()->create());
        [, $candidateB] = $this->member($schoolB, 'Teknisi Tenant B', ['incidents.update']);

        $this->getJson('/api/v1/incidents')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/incidents/'.$incidentId)
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');
        $this->getJson('/api/v1/incidents/'.$incidentId.'/comments')
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');
        $this->getJson('/api/v1/incidents/'.$incidentId.'/events')
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');
        $this->getJson('/api/v1/incidents/submissions/'.$submissionId)
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_SUBMISSION_NOT_FOUND');

        $this->patchJson('/api/v1/incidents/'.$incidentId, [
            'title' => 'Percobaan lintas tenant harus tersembunyi',
        ], ['If-Match' => '"1"'])
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/assignments', [
            'assigneeMembershipId' => $candidateB->id,
        ], ['If-Match' => '"1"'])
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Tidak boleh mengungkap state tenant lain.',
        ], ['If-Match' => '"1"'])
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/comments', [
            'text' => 'Komentar lintas tenant harus ditolak.',
        ], ['If-Match' => '"1"'])
            ->assertNotFound()->assertJsonPath('code', 'INCIDENT_NOT_FOUND');

        $this->getJson('/api/v1/incidents/reporting-context/laboratories/'.$laboratoryA->id.'/devices?search=PC-A')
            ->assertNotFound()->assertJsonPath('code', 'LABORATORY_NOT_FOUND');

        $this->assertSame($membershipB->school_id, $schoolB->id);
        $this->assertSame(1, Incident::query()->where('school_id', $schoolA->id)->count());
        $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incidentId)->count());
    }

    public function test_degraded_assignee_recovery_then_reopen_works_end_to_end_without_losing_resolution_history(): void
    {
        [, $school] = $this->authenticateWithPermissions($this->fullIncidentPermissions());
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = strtolower((string) Str::uuid());
        [, $oldAssignee] = $this->member($school, 'Teknisi Lama UAT', ['incidents.update']);
        [, $replacementAssignee] = $this->member($school, 'Teknisi Pengganti UAT', ['incidents.update']);

        $created = $this->postJson('/api/v1/incidents', $this->createPayload($submissionId, $laboratory))
            ->assertCreated();
        $incidentId = $created->json('data.id');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'triaged',
            'triageSummary' => 'Perlu penanganan teknisi.',
        ], ['If-Match' => '"1"'])->assertOk()->assertHeader('ETag', '"2"');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/assignments', [
            'assigneeMembershipId' => $oldAssignee->id,
        ], ['If-Match' => '"2"'])->assertOk()->assertHeader('ETag', '"3"');

        $started = $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'in_progress',
        ], ['If-Match' => '"3"'])->assertOk()->assertHeader('ETag', '"4"');
        $firstStartedAt = $started->json('data.startedAt');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'resolved',
            'resolutionSummary' => 'Perbaikan awal selesai dan menunggu verifikasi.',
        ], ['If-Match' => '"4"'])
            ->assertOk()->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.resolutionSummary', 'Perbaikan awal selesai dan menunggu verifikasi.');

        $oldAssigneeId = $oldAssignee->id;
        $oldAssignee->delete();
        $degraded = Incident::query()->findOrFail($incidentId);
        $this->assertNull($degraded->assignee_membership_id);
        $this->assertNotNull($degraded->assignee_user_id_snapshot);
        $this->assertNotNull($degraded->assignee_name_snapshot);

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Membuka ulang setelah ditemukan masalah lanjutan.',
        ], ['If-Match' => '"5"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_ASSIGNEE_INELIGIBLE');
        $this->assertSame(5, Incident::query()->findOrFail($incidentId)->version);

        $this->postJson('/api/v1/incidents/'.$incidentId.'/assignments', [
            'assigneeMembershipId' => $replacementAssignee->id,
            'reason' => 'Teknisi sebelumnya sudah tidak memiliki membership aktif.',
        ], ['If-Match' => '"5"'])
            ->assertOk()
            ->assertHeader('ETag', '"6"')
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.assignee.membershipId', $replacementAssignee->id)
            ->assertJsonPath('data.resolutionSummary', 'Perbaikan awal selesai dan menunggu verifikasi.')
            ->assertJsonPath('data.startedAt', $firstStartedAt);

        $this->postJson('/api/v1/incidents/'.$incidentId.'/transitions', [
            'toStatus' => 'in_progress',
            'reason' => 'Masalah lanjutan perlu dikerjakan kembali.',
        ], ['If-Match' => '"6"'])
            ->assertOk()
            ->assertHeader('ETag', '"7"')
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.resolutionSummary', null)
            ->assertJsonPath('data.resolvedAt', null)
            ->assertJsonPath('data.startedAt', $firstStartedAt)
            ->assertJsonPath('data.version', 7);

        $events = $this->getJson('/api/v1/incidents/'.$incidentId.'/events')
            ->assertOk()
            ->assertJsonPath('data.0.eventType', 'incident.reopened')
            ->assertJsonPath('data.1.eventType', 'incident.reassigned')
            ->assertJsonPath('data.1.payload.previousAssignee.membershipId', $oldAssigneeId)
            ->assertJsonPath('data.1.payload.newAssignee.membershipId', $replacementAssignee->id);

        $this->assertSame(7, Incident::query()->findOrFail($incidentId)->version);
        $this->assertSame(7, IncidentEvent::query()->where('incident_id_snapshot', $incidentId)->count());
    }

    public function test_participant_comments_remain_available_without_internal_history_permission(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'incidents.create',
            'incidents.view',
            'incidents.comment',
        ]);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = strtolower((string) Str::uuid());
        $created = $this->postJson('/api/v1/incidents', $this->createPayload($submissionId, $laboratory))
            ->assertCreated();
        $incidentId = $created->json('data.id');

        $this->postJson('/api/v1/incidents/'.$incidentId.'/comments', [
            'text' => 'Komentar participant-safe tetap dapat dipakai.',
        ], ['If-Match' => '"1"'])
            ->assertCreated()->assertHeader('ETag', '"2"');

        $this->getJson('/api/v1/incidents/'.$incidentId.'/comments')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.text', 'Komentar participant-safe tetap dapat dipakai.');

        $this->getJson('/api/v1/incidents/'.$incidentId.'/events')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    /** @return list<string> */
    private function fullIncidentPermissions(): array
    {
        return [
            'incidents.view',
            'incidents.view-all',
            'incidents.create',
            'incidents.update',
            'incidents.approve',
            'incidents.assign',
            'incidents.view-history',
            'incidents.comment',
        ];
    }

    /** @return array{User, School, SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = SchoolMembership::factory()->for($school)->for($user)->create(['status' => 'active']);
        $this->grantPermissions($membership, $permissions);
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @return array{User, SchoolMembership} */
    private function member(School $school, string $name, array $permissions): array
    {
        $user = User::factory()->create(['name' => $name]);
        $membership = SchoolMembership::factory()->for($school)->for($user)->create(['status' => 'active']);
        $this->grantPermissions($membership, $permissions);

        return [$user, $membership];
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

    /** @return array<string, mixed> */
    private function createPayload(string $submissionId, Laboratory $laboratory, ?Device $device = null): array
    {
        return [
            'submissionId' => $submissionId,
            'laboratoryId' => $laboratory->id,
            'deviceId' => $device?->id,
            'category' => 'hardware',
            'priority' => 'normal',
            'title' => 'Komputer laboratorium gagal melakukan boot',
            'description' => 'Komputer berhenti sebelum sistem operasi selesai dimuat dan perlu diperiksa.',
            'impact' => 'Satu workstation tidak dapat digunakan untuk praktikum.',
            'blocksLaboratoryOperation' => false,
            'stepsTaken' => 'Kabel daya dan monitor sudah diperiksa.',
            'occurredAt' => now()->subMinute()->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ];
    }
}
