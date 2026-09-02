<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCommentService;
use App\Application\Incident\IncidentCreationService;
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

class IncidentCommentApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_comment_requires_authentication_view_and_comment_permission_before_precondition_or_body_validation(): void
    {
        $unknown = strtolower((string) Str::ulid());

        $this->postJson('/api/v1/incidents/'.$unknown.'/comments', ['forged' => true], ['If-Match' => 'W/"1"'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $this->authenticateWithPermissions(['incidents.comment']);
        $this->postJson('/api/v1/incidents/'.$unknown.'/comments', ['forged' => true], ['If-Match' => 'W/"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['incidents.view']);
        $this->postJson('/api/v1/incidents/'.$unknown.'/comments', ['forged' => true], ['If-Match' => 'W/"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_comment_requires_exact_incident_if_match(mixed $header): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $headers = $header === null ? [] : ['If-Match' => $header];

        $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', ['text' => 'Catatan valid.'], $headers)
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

    public function test_comment_structural_validation_precedes_visibility(): void
    {
        $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $unknown = strtolower((string) Str::ulid());

        foreach ([
            [],
            ['text' => '   '],
            ['text' => 'valid', 'forged' => true],
            ['text' => str_repeat('x', 2001)],
        ] as $payload) {
            $this->postJson('/api/v1/incidents/'.$unknown.'/comments', $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }

        $this->postJson(
            '/api/v1/incidents/'.$unknown.'/comments?force=true',
            ['text' => 'Catatan valid.'],
            ['If-Match' => '"1"'],
        )->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_non_visible_incident_returns_404_before_status_disclosure(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $hidden = $this->createIncidentFor($this->reporter($school), $school);
        $this->setStatus($hidden, 'closed', null);

        $this->postJson('/api/v1/incidents/'.$hidden->id.'/comments', [
            'text' => 'Tidak boleh mengungkap status.',
        ], ['If-Match' => '"1"'])
            ->assertNotFound()
            ->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
    }

    public function test_stale_version_wins_before_terminal_status_rule(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setStatus($incident, 'closed', null);
        DB::table('incidents')->where('id', $incident->id)->update(['version' => 2]);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Versi stale harus menang.',
        ], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');

        $this->assertDatabaseCount('incident_events', 1);
    }

    #[DataProvider('terminalStatusProvider')]
    public function test_terminal_incidents_reject_new_comments_without_mutation(string $status): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setStatus($incident, $status, null);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Komentar terminal tidak boleh ditambahkan.',
        ], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_STATUS_CONFLICT');

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public static function terminalStatusProvider(): array
    {
        return [
            'closed' => ['closed'],
            'rejected' => ['rejected'],
        ];
    }

    #[DataProvider('commentableStatusProvider')]
    public function test_comment_is_allowed_in_every_non_terminal_status_and_records_participant_safe_event(string $status): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setStatus($incident, $status, $membership);
        $originalName = $user->name;

        $response = $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => "  Catatan e\u{301}skalasi dari peserta.  ",
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.incidentId', $incident->id)
            ->assertJsonPath('data.actor.userId', $user->id)
            ->assertJsonPath('data.actor.name', $originalName)
            ->assertJsonPath('data.text', 'Catatan éskalasi dari peserta.');

        $incident->refresh();
        $this->assertSame(2, $incident->version);

        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::CommentAdded->value)
            ->sole();
        $this->assertSame(1, $event->incident_version_before);
        $this->assertSame(2, $event->incident_version_after);
        $this->assertSame(['text' => 'Catatan éskalasi dari peserta.'], $event->payload);
        $this->assertSame($event->id, $response->json('data.id'));
        $this->assertSame($event->created_at?->toISOString(), $response->json('data.createdAt'));
        $this->assertDatabaseCount('incident_events', 2);
        $this->assertSame(
            ['id', 'incidentId', 'actor', 'text', 'createdAt'],
            array_keys($response->json('data')),
        );
    }

    public static function commentableStatusProvider(): array
    {
        return [
            'reported' => ['reported'],
            'triaged' => ['triaged'],
            'assigned' => ['assigned'],
            'in_progress' => ['in_progress'],
            'resolved' => ['resolved'],
            'verified' => ['verified'],
        ];
    }

    public function test_comment_does_not_require_assignee_ownership_or_update_permission(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $assignee = $this->membershipFor($school, 'Teknisi Lain');
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $this->setStatus($incident, 'assigned', $assignee);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Reporter tetap boleh berkomunikasi setelah assignment.',
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertJsonPath('data.actor.userId', $user->id);
    }

    public function test_event_failure_rolls_back_comment_version_and_event(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);
        $membership->setRelation('user', $user);

        Event::listen('eloquent.creating: '.IncidentEvent::class, static function (): never {
            throw new RuntimeException('forced comment event failure');
        });

        try {
            app(IncidentCommentService::class)->add(
                new CurrentMembershipContext($membership, collect(['incidents.view', 'incidents.comment'])),
                $incident->id,
                1,
                'Catatan yang harus rollback.',
            );
            $this->fail('Expected comment event persistence to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('forced comment event failure', $exception->getMessage());
        } finally {
            Event::forget('eloquent.creating: '.IncidentEvent::class);
        }

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertDatabaseCount('incident_events', 1);
    }

    public function test_comment_projection_requires_only_view_and_redacts_internal_event_evidence(): void
    {
        [$reporter, $school, $reporterMembership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$reporter, $reporterMembership], $school);
        $originalName = $reporter->name;

        $first = $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Komentar pertama.',
        ], ['If-Match' => '"1"'])->assertCreated();
        $second = $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Komentar kedua.',
        ], ['If-Match' => '"2"'])->assertCreated();

        DB::table('incident_events')->where('id', $first->json('data.id'))->update([
            'created_at' => now()->subMinutes(2),
        ]);
        DB::table('incident_events')->where('id', $second->json('data.id'))->update([
            'created_at' => now()->subMinute(),
        ]);
        $reporter->update(['name' => 'Nama Baru Tidak Boleh Mengubah Snapshot']);
        $this->setStatus($incident, 'closed', null);

        $this->authenticateWithPermissions(['incidents.view', 'incidents.view-all'], $school);
        $response = $this->getJson('/api/v1/incidents/'.$incident->id.'/comments?perPage=1&page=1')
            ->assertOk()
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('meta.perPage', 1)
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.lastPage', 2)
            ->assertJsonPath('data.0.id', $second->json('data.id'))
            ->assertJsonPath('data.0.incidentId', $incident->id)
            ->assertJsonPath('data.0.actor.userId', $reporter->id)
            ->assertJsonPath('data.0.actor.name', $originalName)
            ->assertJsonPath('data.0.text', 'Komentar kedua.');

        $item = $response->json('data.0');
        $this->assertSame(['id', 'incidentId', 'actor', 'text', 'createdAt'], array_keys($item));
        $this->assertSame(['userId', 'name'], array_keys($item['actor']));
        $this->assertArrayNotHasKey('type', $item);
        $this->assertArrayNotHasKey('incidentVersionBefore', $item);
        $this->assertArrayNotHasKey('incidentVersionAfter', $item);
        $this->assertArrayNotHasKey('data', $item);
    }

    public function test_comment_projection_filters_out_non_comment_events_and_rejects_unknown_query_parameters(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['incidents.view', 'incidents.comment']);
        $incident = $this->createIncidentFor([$user, $membership], $school);

        $this->postJson('/api/v1/incidents/'.$incident->id.'/comments', [
            'text' => 'Satu-satunya komentar.',
        ], ['If-Match' => '"1"'])->assertCreated();

        $this->getJson('/api/v1/incidents/'.$incident->id.'/comments')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.text', 'Satu-satunya komentar.');

        $unknown = strtolower((string) Str::ulid());
        $this->getJson('/api/v1/incidents/'.$unknown.'/comments?eventType=incident.reopened')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_comment_projection_preserves_row_visibility(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view']);
        $hidden = $this->createIncidentFor($this->reporter($school), $school);

        $this->getJson('/api/v1/incidents/'.$hidden->id.'/comments')
            ->assertNotFound()
            ->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
    }

    public function test_comment_routes_use_exact_static_permissions(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}/comments')
            ->values();

        $this->assertCount(2, $routes);
        $get = $routes->first(fn ($route): bool => in_array('GET', $route->methods(), true));
        $post = $routes->first(fn ($route): bool => in_array('POST', $route->methods(), true));

        $this->assertNotNull($get);
        $this->assertNotNull($post);
        $this->assertContains('permission:incidents.view', $get->gatherMiddleware());
        $this->assertNotContains('permission:incidents.comment', $get->gatherMiddleware());
        $this->assertNotContains('permission:incidents.view-history', $get->gatherMiddleware());
        $this->assertContains('permission:incidents.view', $post->gatherMiddleware());
        $this->assertContains('permission:incidents.comment', $post->gatherMiddleware());
        $this->assertContains(
            'App\\Http\\Middleware\\RequireIncidentVersionPrecondition',
            $post->gatherMiddleware(),
        );
        $this->assertNotContains('permission:incidents.view-history', $post->gatherMiddleware());
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

    private function membershipFor(School $school, string $name): SchoolMembership
    {
        $user = User::factory()->create(['name' => $name]);

        return SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
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

    private function setStatus(
        Incident $incident,
        string $status,
        ?SchoolMembership $assignee,
    ): void {
        match ($status) {
            'reported' => null,
            'triaged' => $this->setTriaged($incident),
            'assigned' => $this->setAssigned($incident, $assignee, false),
            'in_progress' => $this->setAssigned($incident, $assignee, true),
            'resolved' => $this->setResolved($incident),
            'verified' => $this->setVerified($incident),
            'closed' => $this->setClosed($incident),
            'rejected' => DB::table('incidents')->where('id', $incident->id)->update([
                'status' => 'rejected',
                'rejection_reason' => 'Laporan tidak dapat diverifikasi.',
                'rejected_at' => now(),
            ]),
        };
    }

    private function setTriaged(Incident $incident): void
    {
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'triaged',
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => now()->subMinutes(4),
        ]);
    }

    private function setAssigned(Incident $incident, ?SchoolMembership $assignee, bool $started): void
    {
        if ($assignee === null) {
            throw new RuntimeException('Assignee fixture is required.');
        }

        $this->setTriaged($incident);
        $user = $assignee->user()->firstOrFail();
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => $started ? 'in_progress' : 'assigned',
            'assignee_membership_id' => $assignee->id,
            'assignee_user_id_snapshot' => $user->id,
            'assignee_name_snapshot' => $user->name,
            'assigned_at' => now()->subMinutes(3),
            'started_at' => $started ? now()->subMinutes(2) : null,
        ]);
    }

    private function setResolved(Incident $incident): void
    {
        $this->setTriaged($incident);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'resolved',
            'resolution_summary' => 'Incident telah diselesaikan.',
            'resolved_at' => now()->subMinute(),
        ]);
    }

    private function setVerified(Incident $incident): void
    {
        $this->setResolved($incident);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'verified',
            'verification_note' => 'Hasil sudah diverifikasi.',
            'verified_at' => now()->subSeconds(30),
        ]);
    }

    private function setClosed(Incident $incident): void
    {
        $this->setVerified($incident);
        DB::table('incidents')->where('id', $incident->id)->update([
            'status' => 'closed',
            'closed_at' => now(),
        ]);
    }
}
