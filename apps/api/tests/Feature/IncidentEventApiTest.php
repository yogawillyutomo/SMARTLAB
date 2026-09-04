<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCommentService;
use App\Application\Incident\IncidentCreationService;
use App\Models\Incident;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentEventApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_event_history_requires_authentication_view_and_view_history(): void
    {
        $unknown = strtolower((string) Str::ulid());

        $this->getJson('/api/v1/incidents/'.$unknown.'/events?forged=1')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $this->authenticateWithPermissions(['incidents.view-history']);
        $this->getJson('/api/v1/incidents/'.$unknown.'/events?forged=1')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['incidents.view']);
        $this->getJson('/api/v1/incidents/'.$unknown.'/events?forged=1')
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');
    }

    public function test_event_history_validates_only_page_and_per_page_before_row_lookup(): void
    {
        $this->authenticateWithPermissions(['incidents.view', 'incidents.view-history']);
        $unknown = strtolower((string) Str::ulid());

        foreach ([
            '?page=0',
            '?perPage=0',
            '?perPage=101',
            '?eventType=incident.reported',
        ] as $query) {
            $this->getJson('/api/v1/incidents/'.$unknown.'/events'.$query)
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }
    }

    public function test_view_history_never_expands_incident_row_visibility(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.view', 'incidents.view-history']);
        $hidden = $this->createIncidentFor($this->reporter($school), $school);

        $this->getJson('/api/v1/incidents/'.$hidden->id.'/events')
            ->assertNotFound()
            ->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
    }

    public function test_view_all_plus_view_history_can_read_same_school_internal_history(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'incidents.view',
            'incidents.view-all',
            'incidents.view-history',
        ]);
        $incident = $this->createIncidentFor($this->reporter($school), $school);

        $this->getJson('/api/v1/incidents/'.$incident->id.'/events')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.eventType', 'incident.reported')
            ->assertJsonPath('meta.total', 1);
    }

    public function test_event_history_exposes_complete_snapshot_authoritative_typed_evidence(): void
    {
        [$reporter, $school, $reporterMembership] = $this->authenticateWithPermissions([
            'incidents.view',
            'incidents.view-history',
        ]);
        $incident = $this->createIncidentFor([$reporter, $reporterMembership], $school);
        $commenterUser = User::factory()->create(['name' => 'Teknisi Historis']);
        $commenterMembership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $commenterUser->id,
            'status' => 'active',
        ]);
        $commenterMembership->setRelation('user', $commenterUser);

        $comment = app(IncidentCommentService::class)->add(
            new CurrentMembershipContext($commenterMembership, collect(['incidents.view-all'])),
            $incident->id,
            1,
            'Bukti internal untuk history.',
        );

        $commenterUser->update(['name' => 'Nama Baru']);

        $response = $this->getJson('/api/v1/incidents/'.$incident->id.'/events')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $comment->id)
            ->assertJsonPath('data.0.incidentId', $incident->id)
            ->assertJsonPath('data.0.ticketNumber', $incident->ticket_number)
            ->assertJsonPath('data.0.actor.userId', $commenterUser->id)
            ->assertJsonPath('data.0.actor.membershipId', $commenterMembership->id)
            ->assertJsonPath('data.0.actor.name', 'Teknisi Historis')
            ->assertJsonPath('data.0.eventType', 'incident.comment_added')
            ->assertJsonPath('data.0.incidentVersionBefore', 1)
            ->assertJsonPath('data.0.incidentVersionAfter', 2)
            ->assertJsonPath('data.0.payload.text', 'Bukti internal untuk history.')
            ->assertJsonPath('data.1.eventType', 'incident.reported')
            ->assertJsonPath('data.1.incidentVersionBefore', 0)
            ->assertJsonPath('data.1.incidentVersionAfter', 1)
            ->assertJsonPath('meta.total', 2);

        $this->assertSame(
            ['id', 'incidentId', 'ticketNumber', 'actor', 'eventType', 'incidentVersionBefore', 'incidentVersionAfter', 'payload', 'createdAt'],
            array_keys($response->json('data.0')),
        );
        $this->assertSame(
            ['userId', 'membershipId', 'name'],
            array_keys($response->json('data.0.actor')),
        );
        $this->assertArrayNotHasKey('schoolId', $response->json('data.0'));
        $this->assertArrayNotHasKey('actorUserId', $response->json('data.0'));
        $this->assertArrayNotHasKey('actorMembershipId', $response->json('data.0'));
    }

    public function test_event_history_is_read_only_and_does_not_require_comment_or_update_permissions(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions([
            'incidents.view',
            'incidents.view-history',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $school)->fresh();
        $version = $incident->version;
        $updatedAt = $incident->updated_at?->toISOString();
        $eventCount = IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count();

        $this->getJson('/api/v1/incidents/'.$incident->id.'/events')
            ->assertOk()
            ->assertJsonPath('meta.total', 1);

        $incident->refresh();
        $this->assertSame($version, $incident->version);
        $this->assertSame($updatedAt, $incident->updated_at?->toISOString());
        $this->assertSame(
            $eventCount,
            IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count(),
        );
    }

    public function test_event_history_paginates_and_keeps_same_timestamp_events_stable(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions([
            'incidents.view',
            'incidents.view-history',
        ]);
        $membership->setRelation('user', $user);
        $context = new CurrentMembershipContext($membership, collect());

        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-03T11:59:00Z'));
        try {
            $incident = $this->createIncidentFor([$user, $membership], $school);

            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-09-03T12:00:00Z'));
            $first = app(IncidentCommentService::class)->add($context, $incident->id, 1, 'Komentar pertama.');
            $second = app(IncidentCommentService::class)->add($context, $incident->id, 2, 'Komentar kedua.');
        } finally {
            CarbonImmutable::setTestNow();
        }

        $this->assertSame($first->created_at?->toISOString(), $second->created_at?->toISOString());

        $pageOne = $this->getJson('/api/v1/incidents/'.$incident->id.'/events?perPage=2&page=1')
            ->assertOk()
            ->assertJsonPath('meta.page', 1)
            ->assertJsonPath('meta.perPage', 2)
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('meta.lastPage', 2);

        $pageOneIds = $pageOne->json('data.*.id');
        $this->assertEqualsCanonicalizing([$first->id, $second->id], $pageOneIds);

        $repeatPageOneIds = $this->getJson('/api/v1/incidents/'.$incident->id.'/events?perPage=2&page=1')
            ->assertOk()
            ->json('data.*.id');
        $this->assertSame($pageOneIds, $repeatPageOneIds);

        $this->getJson('/api/v1/incidents/'.$incident->id.'/events?perPage=2&page=2')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.eventType', 'incident.reported');
    }

    public function test_event_history_route_uses_exact_static_permissions_and_no_precondition(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())
            ->first(fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}/events');

        $this->assertNotNull($route);
        $this->assertSame(['GET', 'HEAD'], $route->methods());
        $this->assertContains('permission:incidents.view', $route->gatherMiddleware());
        $this->assertContains('permission:incidents.view-history', $route->gatherMiddleware());
        $this->assertNotContains('permission:incidents.comment', $route->gatherMiddleware());
        $this->assertNotContains('permission:incidents.update', $route->gatherMiddleware());
        $this->assertNotContains('permission:incidents.assign', $route->gatherMiddleware());
        $this->assertNotContains(
            'App\\Http\\Middleware\\RequireIncidentVersionPrecondition',
            $route->gatherMiddleware(),
        );
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
                'occurredAt' => now()->subMinute()->utc()->format('Y-m-d\\TH:i:s.u\\Z'),
            ],
        )->incident;
    }
}
