<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Incident\IncidentEventRecorder;
use App\Domain\Incident\Fingerprint\IncidentFingerprint;
use App\Domain\Incident\Fingerprint\IncidentFingerprintRegistry;
use App\Domain\Incident\Fingerprint\IncidentFingerprintV1;
use App\Domain\Incident\IncidentEventType;
use App\Models\Device;
use App\Models\Incident;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentCreateRecoveryApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_b3_routes_require_authentication_exact_permissions_and_static_order(): void
    {
        $submissionId = $this->submissionId();
        $this->postJson('/api/v1/incidents', [])->assertUnauthorized()->assertExactJson([
            'message' => 'Authentication is required.',
            'code' => 'UNAUTHENTICATED',
        ]);
        $this->getJson('/api/v1/incidents/submissions/'.$submissionId)->assertUnauthorized()->assertExactJson([
            'message' => 'Authentication is required.',
            'code' => 'UNAUTHENTICATED',
        ]);

        $this->authenticateWithPermissions([]);
        $this->postJson('/api/v1/incidents', [])->assertForbidden()->assertExactJson([
            'message' => 'You do not have permission to perform this action.',
            'code' => 'FORBIDDEN',
        ]);
        $this->getJson('/api/v1/incidents/submissions/'.$submissionId)->assertForbidden()->assertExactJson([
            'message' => 'You do not have permission to perform this action.',
            'code' => 'FORBIDDEN',
        ]);

        $routes = collect(Route::getRoutes()->getRoutes());
        $recovery = $routes->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/submissions/{submissionId}');
        $create = $routes->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents' && in_array('POST', $route->methods(), true));
        $detail = $routes->sole(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}'
            && in_array('GET', $route->methods(), true));

        $this->assertSame(['GET', 'HEAD'], $recovery->methods());
        $this->assertContains('permission:incidents.view', $recovery->gatherMiddleware());
        $this->assertSame(['POST'], $create->methods());
        $this->assertContains('permission:incidents.create', $create->gatherMiddleware());
        $this->assertLessThan(
            $routes->search(fn ($route): bool => $route === $detail),
            $routes->search(fn ($route): bool => $route === $recovery),
        );
    }

    public function test_laboratory_only_create_returns_full_dto_defaults_and_one_atomic_artifact_set(): void
    {
        [$user, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = $this->submissionId();

        $response = $this->postJson('/api/v1/incidents', $this->payload($laboratory, [
            'submissionId' => $submissionId,
        ], ['priority', 'blocksLaboratoryOperation']));

        $response->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.reporter.userId', $user->id)
            ->assertJsonPath('data.priority', 'normal')
            ->assertJsonPath('data.blocksLaboratoryOperation', false)
            ->assertJsonPath('data.status', 'reported')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.device', null)
            ->assertJsonMissingPath('data.submissionId')
            ->assertJsonMissingPath('data.payloadFingerprint')
            ->assertJsonMissingPath('data.payloadFingerprintVersion');
        $this->assertIncidentDtoKeys($response->json('data'));
        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_submissions', 1);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertDatabaseCount('incident_number_sequences', 1);
        $this->assertDatabaseHas('incident_submissions', [
            'submission_id' => $submissionId,
            'incident_id' => $response->json('data.id'),
        ]);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_create_accepts_in_service_and_spare_devices_without_inventory_view_permissions(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);

        foreach (['in_service', 'spare'] as $index => $lifecycle) {
            $device = Device::factory()->for($school)->create([
                'home_laboratory_id' => $laboratory->id,
                'device_code' => 'PC-B3-'.($index + 1),
                'lifecycle_status' => $lifecycle,
            ]);

            $this->postJson('/api/v1/incidents', $this->payload($laboratory, [
                'submissionId' => $this->submissionId(),
                'deviceId' => $device->id,
            ]))->assertCreated()->assertJsonPath('data.device.id', $device->id);
        }

        $this->assertDatabaseCount('incidents', 2);
        $this->assertDatabaseCount('incident_events', 2);
    }

    public function test_create_rejects_client_authority_and_unknown_fields_without_artifacts(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $forbidden = [
            'schoolId', 'school', 'reporter', 'reporterId', 'reporterUserId',
            'reporterMembershipId', 'ticketNumber', 'ticketSequence', 'ticketYear',
            'status', 'assignee', 'version', 'reportedAt', 'triagedAt', 'assignedAt',
            'startedAt', 'resolvedAt', 'verifiedAt', 'closedAt', 'rejectedAt',
            'createdAt', 'updatedAt', 'events', 'comments', 'workOrderId', 'unexpected',
        ];

        foreach ($forbidden as $field) {
            $this->postJson('/api/v1/incidents', $this->payload($laboratory, [
                'submissionId' => $this->submissionId(),
                $field => 'forged',
            ]))->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->assertNoCreateArtifacts();
    }

    public function test_create_rejects_all_query_parameters_and_never_uses_them_as_business_data(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);

        $this->postJson(
            '/api/v1/incidents?priority=critical',
            $this->payload($laboratory, ['submissionId' => $this->submissionId()]),
        )->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->assertNoCreateArtifacts();

        $payload = $this->payload($laboratory, ['submissionId' => $this->submissionId()]);
        unset($payload['description']);
        $this->postJson(
            '/api/v1/incidents?description=Supplied%20only%20through%20the%20query',
            $payload,
        )->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->assertNoCreateArtifacts();
    }

    public function test_all_client_controlled_invalid_create_inputs_return_422_without_artifacts(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $base = $this->payload($laboratory, ['submissionId' => $this->submissionId()]);
        $cases = [
            'missing submission' => [null, ['submissionId']],
            'malformed submission' => [['submissionId' => 'not-a-uuid'], []],
            'uppercase submission' => [['submissionId' => strtoupper($this->submissionId())], []],
            'non-v4 submission' => [['submissionId' => '00000000-0000-1000-8000-000000000000'], []],
            'missing Laboratory' => [null, ['laboratoryId']],
            'invalid Laboratory ULID' => [['laboratoryId' => 'not-a-ulid'], []],
            'invalid Device ULID' => [['deviceId' => 'not-a-ulid'], []],
            'missing category' => [null, ['category']],
            'invalid category' => [['category' => 'invalid'], []],
            'invalid priority' => [['priority' => 'urgent'], []],
            'missing title' => [null, ['title']],
            'short title' => [['title' => 'tiny'], []],
            'missing description' => [null, ['description']],
            'short description' => [['description' => 'too short'], []],
            'long impact' => [['impact' => str_repeat('i', 2001)], []],
            'long steps' => [['stepsTaken' => str_repeat('s', 2001)], []],
            'non-boolean blocker' => [['blocksLaboratoryOperation' => 'false'], []],
            'missing occurredAt' => [null, ['occurredAt']],
            'invalid occurredAt' => [['occurredAt' => 'yesterday'], []],
            'future occurredAt' => [['occurredAt' => now()->addMinutes(6)->utc()->format('Y-m-d\TH:i:s.u\Z')], []],
        ];

        foreach ($cases as [$overrides, $remove]) {
            $payload = array_replace($base, $overrides ?? []);
            $payload['submissionId'] = $overrides['submissionId'] ?? $this->submissionId();
            foreach ($remove as $field) {
                unset($payload[$field]);
            }
            $this->postJson('/api/v1/incidents', $payload)
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->assertNoCreateArtifacts();
    }

    public function test_create_revalidates_all_subject_security_boundaries_without_partial_artifacts(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $active = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $otherSchool = School::factory()->create();
        $foreignLaboratory = Laboratory::factory()->for($otherSchool)->create(['status' => 'active']);
        $wrongHome = Laboratory::factory()->for($school)->create(['status' => 'active']);

        foreach ([$inactive->id, strtolower((string) Str::ulid()), $foreignLaboratory->id] as $laboratoryId) {
            $this->postJson('/api/v1/incidents', $this->payload($active, [
                'submissionId' => $this->submissionId(),
                'laboratoryId' => $laboratoryId,
            ]))->assertConflict()->assertJsonPath('code', 'INCIDENT_LABORATORY_INELIGIBLE');
        }

        $deviceIds = [
            strtolower((string) Str::ulid()),
            Device::factory()->for($school)->create(['home_laboratory_id' => $active->id, 'lifecycle_status' => 'retired'])->id,
            Device::factory()->for($school)->create(['home_laboratory_id' => $active->id, 'lifecycle_status' => 'decommissioned'])->id,
            Device::factory()->for($school)->create(['home_laboratory_id' => $wrongHome->id, 'lifecycle_status' => 'in_service'])->id,
            Device::factory()->for($otherSchool)->create(['home_laboratory_id' => $foreignLaboratory->id, 'lifecycle_status' => 'in_service'])->id,
        ];
        foreach ($deviceIds as $deviceId) {
            $this->postJson('/api/v1/incidents', $this->payload($active, [
                'submissionId' => $this->submissionId(),
                'deviceId' => $deviceId,
            ]))->assertConflict()->assertJsonPath('code', 'INCIDENT_DEVICE_NOT_ELIGIBLE');
        }

        $this->assertNoCreateArtifacts();
    }

    public function test_equivalent_repeat_uses_fast_path_returns_current_dto_and_allocates_nothing(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $submissionId = $this->submissionId();
        $occurredAt = now()->subMinute()->startOfSecond();
        $firstPayload = $this->payload($laboratory, [
            'submissionId' => $submissionId,
            'deviceId' => $device->id,
            'title' => '  Desktop gagal menyala  ',
            'impact' => '',
            'occurredAt' => $occurredAt->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ], ['priority', 'blocksLaboratoryOperation', 'stepsTaken']);

        $first = $this->postJson('/api/v1/incidents', $firstPayload)->assertCreated();
        $incidentId = $first->json('data.id');
        $originalUpdatedAt = $first->json('data.updatedAt');
        $laboratory->update(['status' => 'inactive']);
        $device->update(['lifecycle_status' => 'retired']);

        $equivalent = array_reverse($this->payload($laboratory, [
            'submissionId' => $submissionId,
            'deviceId' => $device->id,
            'occurredAt' => $occurredAt->setTimezone('Asia/Jakarta')->format('Y-m-d\TH:i:sP'),
        ]), true);
        $second = $this->postJson('/api/v1/incidents', $equivalent);

        $second->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.id', $incidentId)
            ->assertJsonPath('data.updatedAt', $originalUpdatedAt);
        $this->assertIncidentDtoKeys($second->json('data'));
        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_submissions', 1);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_nullable_blanks_omissions_defaults_and_timezone_are_http_fingerprint_equivalent(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = $this->submissionId();
        $occurredAt = now()->subMinute()->startOfSecond();
        $implicit = $this->payload($laboratory, [
            'submissionId' => $submissionId,
            'occurredAt' => $occurredAt->utc()->format('Y-m-d\TH:i:s.u\Z'),
        ], ['deviceId', 'impact', 'stepsTaken', 'priority', 'blocksLaboratoryOperation']);
        $first = $this->postJson('/api/v1/incidents', $implicit)->assertCreated();

        $explicit = array_reverse($this->payload($laboratory, [
            'submissionId' => $submissionId,
            'deviceId' => '',
            'impact' => '',
            'stepsTaken' => '',
            'occurredAt' => $occurredAt->setTimezone('Asia/Jakarta')->format('Y-m-d\TH:i:sP'),
        ]), true);
        $this->postJson('/api/v1/incidents', $explicit)
            ->assertOk()
            ->assertJsonPath('data.id', $first->json('data.id'));

        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_materially_different_repeat_conflicts_while_other_reporters_and_schools_are_independent(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = $this->submissionId();
        $first = $this->postJson('/api/v1/incidents', $this->payload($laboratory, ['submissionId' => $submissionId]))
            ->assertCreated();

        $this->postJson('/api/v1/incidents', $this->payload($laboratory, [
            'submissionId' => $submissionId,
            'priority' => 'critical',
        ]))->assertConflict()->assertExactJson([
            'message' => 'The submission ID was already used for different Incident data.',
            'code' => 'INCIDENT_SUBMISSION_CONFLICT',
        ]);
        $this->assertSame($first->json('data.id'), Incident::query()->sole()->id);
        $this->assertDatabaseCount('incident_events', 1);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));

        $otherUser = User::factory()->create();
        $otherMembership = SchoolMembership::factory()->for($school)->for($otherUser)->create(['status' => 'active']);
        $this->grantPermissions($otherMembership, ['incidents.create']);
        Sanctum::actingAs($otherUser);
        $this->postJson('/api/v1/incidents', $this->payload($laboratory, ['submissionId' => $submissionId]))
            ->assertCreated();

        $otherSchool = School::factory()->create();
        $otherLaboratory = Laboratory::factory()->for($otherSchool)->create(['status' => 'active']);
        $otherSchoolMembership = SchoolMembership::factory()->for($otherSchool)->for($user)->create(['status' => 'active']);
        $membership->delete();
        $this->grantPermissions($otherSchoolMembership, ['incidents.create']);
        Sanctum::actingAs($user);
        $this->postJson('/api/v1/incidents', $this->payload($otherLaboratory, ['submissionId' => $submissionId]))
            ->assertCreated();

        $this->assertDatabaseCount('incidents', 3);
        $this->assertDatabaseCount('incident_events', 3);
        $this->assertDatabaseCount('incident_submissions', 3);
    }

    public function test_duplicate_uses_the_submission_stored_fingerprint_version(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $payload = $this->payload($laboratory, ['submissionId' => $this->submissionId()]);
        $first = $this->postJson('/api/v1/incidents', $payload)->assertCreated();

        $this->app->instance(IncidentFingerprintRegistry::class, new IncidentFingerprintRegistry([
            new IncidentFingerprintV1,
            new IncidentFingerprintV2ForHttpTest,
        ]));

        $queries = [];
        DB::listen(function (QueryExecuted $query) use (&$queries): void {
            $queries[] = strtolower($query->sql);
        });

        $this->postJson('/api/v1/incidents', $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $first->json('data.id'));
        $submissionReads = array_values(array_filter(
            $queries,
            fn (string $query): bool => str_starts_with(ltrim($query), 'select')
                && str_contains($query, 'incident_submissions'),
        ));
        $this->assertCount(1, $submissionReads, 'FormRequest must not read the stored fingerprint version before service serialization.');
        $this->assertDatabaseHas('incident_submissions', [
            'submission_id' => $payload['submissionId'],
            'payload_fingerprint_version' => 1,
        ]);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_unsupported_stored_fingerprint_version_is_not_misclassified_as_client_validation(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $payload = $this->payload($laboratory, ['submissionId' => $this->submissionId()]);
        $this->postJson('/api/v1/incidents', $payload)->assertCreated();
        $this->app->instance(IncidentFingerprintRegistry::class, new IncidentFingerprintRegistry([
            new IncidentFingerprintV2ForHttpTest,
        ]));

        $this->withoutExceptionHandling();
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Unsupported Incident fingerprint version: 1');

        $this->postJson('/api/v1/incidents', $payload);
    }

    public function test_recovery_safe_404_is_identical_for_malformed_unknown_other_reporter_cross_school_and_uncommitted(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $otherReporter = $this->reporter($school);
        $otherSubmission = $this->createDirect($otherReporter, $laboratory, $this->submissionId());
        $otherSchool = School::factory()->create();
        $otherLaboratory = Laboratory::factory()->for($otherSchool)->create(['status' => 'active']);
        $crossSubmission = $this->createDirect($this->reporter($otherSchool), $otherLaboratory, $this->submissionId());
        $uncommitted = $this->submissionId();
        DB::table('incident_submissions')->insert([
            'school_id' => $school->id,
            'reporter_user_id_snapshot' => $user->id,
            'submission_id' => $uncommitted,
            'payload_fingerprint' => str_repeat('a', 64),
            'payload_fingerprint_version' => 1,
            'incident_id' => null,
            'created_at' => now(),
        ]);
        $expected = [
            'message' => 'Incident submission not found.',
            'code' => 'INCIDENT_SUBMISSION_NOT_FOUND',
        ];

        foreach ([
            'not-a-uuid',
            strtoupper($this->submissionId()),
            $this->submissionId(),
            $otherSubmission['submissionId'],
            $crossSubmission['submissionId'],
            $uncommitted,
        ] as $candidate) {
            $this->getJson('/api/v1/incidents/submissions/'.$candidate)
                ->assertNotFound()
                ->assertExactJson($expected);
        }

        $this->assertSame($membership->user_id, $user->id);
        $this->assertDatabaseCount('incidents', 2);
        $this->assertDatabaseCount('incident_events', 2);
    }

    public function test_recovery_uses_same_user_across_replacement_membership_and_is_read_only_after_subject_changes(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $submissionId = $this->submissionId();
        $created = $this->createDirect([$user, $membership], $laboratory, $submissionId, $device);
        $incident = $created['incident'];
        $before = [$incident->version, $incident->updated_at?->toISOString(), DB::table('incident_events')->count()];

        $membership->delete();
        $replacement = SchoolMembership::factory()->for($school)->for($user)->create(['status' => 'active']);
        $this->grantPermissions($replacement, ['incidents.view']);
        $laboratory->update(['status' => 'inactive']);
        $device->update(['lifecycle_status' => 'decommissioned']);
        Sanctum::actingAs($user);

        $response = $this->getJson('/api/v1/incidents/submissions/'.$submissionId);
        $response->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.id', $incident->id)
            ->assertJsonPath('data.laboratory.id', $laboratory->id)
            ->assertJsonPath('data.device.id', $device->id)
            ->assertJsonMissingPath('data.submissionId');
        $this->assertIncidentDtoKeys($response->json('data'));
        $incident->refresh();
        $this->assertSame($before, [$incident->version, $incident->updated_at?->toISOString(), DB::table('incident_events')->count()]);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));
    }

    public function test_duplicate_and_recovery_reuse_b1_historical_assignee_projection_and_current_etag(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.create', 'incidents.view']);
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $submissionId = $this->submissionId();
        $payload = $this->payload($laboratory, ['submissionId' => $submissionId]);
        $created = $this->postJson('/api/v1/incidents', $payload)->assertCreated();
        $incident = Incident::query()->findOrFail($created->json('data.id'));
        $assigneeUser = User::factory()->create(['name' => 'Teknisi Historis']);
        $assignee = SchoolMembership::factory()->for($school)->for($assigneeUser)->create(['status' => 'active']);
        $membership->setRelation('user', $user);
        $context = new CurrentMembershipContext($membership, collect(['incidents.create', 'incidents.view']));
        $triagedAt = now()->subMinutes(2);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'triaged',
            'triage_summary' => 'Triage selesai.',
            'triaged_at' => $triagedAt,
            'version' => 2,
            'updated_at' => $triagedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Triaged,
            1,
            2,
            [
                'triageSummary' => 'Triage selesai.',
                'priority' => 'normal',
                'impact' => null,
                'blocksLaboratoryOperation' => false,
            ],
            $triagedAt,
        );

        $assignedAt = now()->subMinute();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'assigned',
            'assignee_membership_id' => $assignee->id,
            'assignee_user_id_snapshot' => $assigneeUser->id,
            'assignee_name_snapshot' => $assigneeUser->name,
            'assigned_at' => $assignedAt,
            'version' => 3,
            'updated_at' => $assignedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Assigned,
            2,
            3,
            [
                'assignee' => ['membershipId' => $assignee->id, 'userId' => $assigneeUser->id, 'name' => $assigneeUser->name],
                'reason' => null,
            ],
            $assignedAt,
        );

        $resolvedAt = now();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'resolved',
            'resolution_summary' => 'Perangkat kembali berfungsi.',
            'resolved_at' => $resolvedAt,
            'version' => 4,
            'updated_at' => $resolvedAt,
        ]);
        $incident->refresh();
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::Resolved,
            3,
            4,
            ['resolutionSummary' => 'Perangkat kembali berfungsi.'],
            $resolvedAt,
        );
        $assignee->delete();

        foreach ([
            $this->postJson('/api/v1/incidents', $payload),
            $this->getJson('/api/v1/incidents/submissions/'.$submissionId),
        ] as $response) {
            $response->assertOk()
                ->assertHeader('ETag', '"4"')
                ->assertJsonPath('data.version', 4)
                ->assertJsonPath('data.status', 'resolved')
                ->assertJsonPath('data.assignee.membershipId', $assignee->id);
        }

        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('incident_submissions', 1);
        $this->assertDatabaseCount('incident_events', 4);
        $this->assertSame(1, (int) DB::table('incident_number_sequences')->value('last_value'));
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

    /** @return array{User, SchoolMembership} */
    private function reporter(School $school): array
    {
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->for($school)->for($user)->create(['status' => 'active']);

        return [$user, $membership];
    }

    /** @param array{User, SchoolMembership} $reporter @return array{incident: Incident, submissionId: string} */
    private function createDirect(
        array $reporter,
        Laboratory $laboratory,
        string $submissionId,
        ?Device $device = null,
    ): array {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);
        $incident = app(IncidentCreationService::class)->create(
            new CurrentMembershipContext($membership, collect()),
            $submissionId,
            $this->payload($laboratory, ['deviceId' => $device?->id], ['submissionId']),
        )->incident;

        return ['incident' => $incident, 'submissionId' => $submissionId];
    }

    /** @param array<string, mixed> $overrides @param list<string> $remove @return array<string, mixed> */
    private function payload(Laboratory $laboratory, array $overrides = [], array $remove = []): array
    {
        $payload = array_replace([
            'submissionId' => $this->submissionId(),
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
        ], $overrides);
        foreach ($remove as $field) {
            unset($payload[$field]);
        }

        return $payload;
    }

    private function submissionId(): string
    {
        return strtolower((string) Str::uuid());
    }

    /** @param array<string, mixed> $data */
    private function assertIncidentDtoKeys(array $data): void
    {
        $expected = [
            'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority',
            'title', 'description', 'impact', 'blocksLaboratoryOperation', 'stepsTaken',
            'status', 'assignee', 'triageSummary', 'resolutionSummary', 'rejectionReason',
            'verificationNote', 'version', 'occurredAt', 'reportedAt', 'triagedAt',
            'assignedAt', 'startedAt', 'resolvedAt', 'verifiedAt', 'closedAt',
            'rejectedAt', 'createdAt', 'updatedAt',
        ];
        $actual = array_keys($data);
        sort($expected);
        sort($actual);
        $this->assertSame($expected, $actual);
    }

    private function assertNoCreateArtifacts(): void
    {
        $this->assertDatabaseCount('incident_submissions', 0);
        $this->assertDatabaseCount('incident_number_sequences', 0);
        $this->assertDatabaseCount('incidents', 0);
        $this->assertDatabaseCount('incident_events', 0);
    }
}

final class IncidentFingerprintV2ForHttpTest implements IncidentFingerprint
{
    private IncidentFingerprintV1 $v1;

    public function __construct()
    {
        $this->v1 = new IncidentFingerprintV1;
    }

    public function version(): int
    {
        return 2;
    }

    public function canonicalize(array $payload): array
    {
        return $this->v1->canonicalize($payload);
    }

    public function canonicalJson(array $payload): string
    {
        return $this->v1->canonicalJson($payload);
    }

    public function fingerprint(array $payload): string
    {
        return hash('sha256', 'v2:'.$this->canonicalJson($payload));
    }
}
