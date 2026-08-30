<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class IncidentReportingContextApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_reporting_discovery_requires_authentication_and_incidents_create_only(): void
    {
        $laboratoryId = strtolower((string) Str::ulid());
        foreach ([
            '/api/v1/incidents/reporting-context/laboratories',
            "/api/v1/incidents/reporting-context/laboratories/{$laboratoryId}/devices?search=PC",
        ] as $url) {
            $this->getJson($url)->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');
        }

        [, $school] = $this->authenticateWithPermissions([]);
        $laboratory = Laboratory::factory()->for($school)->create();
        foreach ([
            '/api/v1/incidents/reporting-context/laboratories',
            "/api/v1/incidents/reporting-context/laboratories/{$laboratory->id}/devices?search=PC",
        ] as $url) {
            $this->getJson($url)->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
        }

        $this->authenticateWithPermissions(['incidents.create'], $school);
        $this->getJson('/api/v1/incidents/reporting-context/laboratories')->assertOk();
        $this->getJson("/api/v1/incidents/reporting-context/laboratories/{$laboratory->id}/devices?search=PC")->assertOk();
    }

    public function test_laboratory_discovery_is_tenant_scoped_active_narrow_and_deterministic(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $sameCodeA = Laboratory::factory()->for($school)->create([
            'code' => 'LAB-A', 'name' => 'Laboratorium Alpha', 'status' => 'active',
        ]);
        $sameCodeB = Laboratory::factory()->for($school)->create([
            'code' => 'lab-a', 'name' => 'Laboratorium Beta', 'status' => 'active',
        ]);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-Z', 'status' => 'inactive']);
        $otherSchool = School::factory()->create();
        Laboratory::factory()->for($otherSchool)->create(['code' => 'LAB-0', 'status' => 'active']);

        $response = $this->getJson('/api/v1/incidents/reporting-context/laboratories')->assertOk();
        $expectedIds = collect([$sameCodeA, $sameCodeB])->sortBy('id')->pluck('id')->values()->all();
        $this->assertSame($expectedIds, array_column($response->json('data'), 'id'));
        $this->assertSame(['id', 'code', 'name'], array_keys($response->json('data.0')));
        $response->assertExactJson([
            'data' => $response->json('data'),
            'meta' => ['page' => 1, 'perPage' => 25, 'total' => 2, 'lastPage' => 1],
        ]);
        foreach (['location', 'capacity', 'status', 'school', 'deviceCount', 'layout'] as $forbidden) {
            $this->assertStringNotContainsString('"'.$forbidden.'"', json_encode($response->json(), JSON_THROW_ON_ERROR));
        }
    }

    public function test_laboratory_search_pagination_empty_and_validation_contract(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-NET', 'name' => 'Jaringan Utama']);
        Laboratory::factory()->for($school)->create(['code' => 'LAB-COMP', 'name' => 'Komputer Dasar']);

        foreach (['lab-net', 'jaringan'] as $search) {
            $this->getJson('/api/v1/incidents/reporting-context/laboratories?'.http_build_query(['search' => $search]))
                ->assertOk()
                ->assertJsonPath('meta.total', 1)
                ->assertJsonPath('data.0.code', 'LAB-NET');
        }
        foreach (['%', '_', '\\'] as $search) {
            $this->getJson('/api/v1/incidents/reporting-context/laboratories?'.http_build_query(['search' => 'XX'.$search]))
                ->assertOk()
                ->assertJsonPath('meta.total', 0);
        }

        $this->getJson('/api/v1/incidents/reporting-context/laboratories?perPage=1&page=2')
            ->assertOk()
            ->assertJsonPath('meta.page', 2)
            ->assertJsonPath('meta.perPage', 1)
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.lastPage', 2);
        $this->getJson('/api/v1/incidents/reporting-context/laboratories?search=missing')
            ->assertOk()
            ->assertExactJson(['data' => [], 'meta' => ['page' => 1, 'perPage' => 25, 'total' => 0, 'lastPage' => 1]]);

        foreach (['search=x', 'page=0', 'perPage=0', 'perPage=101', 'unknown=value'] as $query) {
            $this->getJson('/api/v1/incidents/reporting-context/laboratories?'.$query)
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }
    }

    public function test_device_discovery_safe_laboratory_lookup_is_exact_and_non_disclosing(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $otherSchool = School::factory()->create();
        $crossSchool = Laboratory::factory()->for($otherSchool)->create(['status' => 'active']);
        $expected = ['message' => 'Laboratory not found.', 'code' => 'LABORATORY_NOT_FOUND'];

        foreach (['malformed', strtolower((string) Str::ulid()), $crossSchool->id, $inactive->id] as $laboratoryId) {
            $this->getJson("/api/v1/incidents/reporting-context/laboratories/{$laboratoryId}/devices?search=PC")
                ->assertNotFound()
                ->assertExactJson($expected);
        }
    }

    public function test_device_discovery_rejects_missing_invalid_and_unknown_query_values(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create();
        $base = "/api/v1/incidents/reporting-context/laboratories/{$laboratory->id}/devices";

        foreach (['', '?search=x', '?search='.str_repeat('x', 101), '?search=%20%20x%20%20', '?search=PC&page=1'] as $query) {
            $this->getJson($base.$query)->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        }
        $this->getJson($base.'?search=%20%20PC%20%20')->assertOk();
    }

    public function test_device_discovery_applies_all_eligibility_search_and_exact_projection_rules(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create();
        $otherLaboratory = Laboratory::factory()->for($school)->create();
        $inService = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-ELIGIBLE-01',
            'lifecycle_status' => 'in_service',
            'hostname' => 'HOST-PRIVATE',
            'serial_number' => 'SERIAL-PRIVATE',
            'brand' => 'BRAND-PRIVATE',
            'model' => 'MODEL-PRIVATE',
        ]);
        $spare = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'device_code' => 'PC-ELIGIBLE-02',
            'lifecycle_status' => 'spare',
        ]);
        foreach (['retired', 'decommissioned'] as $index => $status) {
            Device::factory()->for($school)->create([
                'home_laboratory_id' => $laboratory->id,
                'device_code' => 'PC-INELIGIBLE-0'.($index + 1),
                'lifecycle_status' => $status,
            ]);
        }
        Device::factory()->for($school)->create([
            'home_laboratory_id' => $otherLaboratory->id,
            'device_code' => 'PC-WRONG-LAB',
        ]);
        $otherSchool = School::factory()->create();
        Device::factory()->for($otherSchool)->create([
            'home_laboratory_id' => Laboratory::factory()->for($otherSchool)->create()->id,
            'device_code' => 'PC-CROSS-SCHOOL',
        ]);

        $base = "/api/v1/incidents/reporting-context/laboratories/{$laboratory->id}/devices?";
        $response = $this->getJson($base.http_build_query(['search' => 'PC-']))->assertOk();
        $this->assertSame([$inService->id, $spare->id], array_column($response->json('data'), 'id'));
        $this->assertSame(['id', 'deviceCode', 'deviceType'], array_keys($response->json('data.0')));
        $response->assertJsonPath('meta.hasMore', false);

        foreach (['HOST-PRIVATE', 'SERIAL-PRIVATE', 'BRAND-PRIVATE', 'MODEL-PRIVATE'] as $search) {
            $this->getJson($base.http_build_query(['search' => $search]))
                ->assertOk()
                ->assertJsonPath('data', []);
        }
        foreach (['%', '_', '\\'] as $search) {
            $this->getJson($base.http_build_query(['search' => 'XX'.$search]))
                ->assertOk()
                ->assertJsonPath('data', []);
        }

        $serialized = json_encode($response->json(), JSON_THROW_ON_ERROR);
        foreach (['lifecycleStatus', 'hostname', 'serialNumber', 'qrPublicId', 'technicalProfile', 'layout', 'asset', 'location'] as $forbidden) {
            $this->assertStringNotContainsString('"'.$forbidden.'"', $serialized);
        }
    }

    public function test_device_discovery_fetches_twenty_one_returns_twenty_and_computes_has_more_after_eligibility(): void
    {
        [, $school] = $this->authenticateWithPermissions(['incidents.create']);
        $laboratory = Laboratory::factory()->for($school)->create();
        foreach (range(1, 22) as $index) {
            Device::factory()->for($school)->create([
                'home_laboratory_id' => $laboratory->id,
                'device_code' => sprintf('MATCH-%03d', $index),
                'lifecycle_status' => 'in_service',
            ]);
        }
        $base = "/api/v1/incidents/reporting-context/laboratories/{$laboratory->id}/devices?search=MATCH";
        $response = $this->getJson($base)->assertOk();
        $this->assertCount(20, $response->json('data'));
        $response->assertJsonPath('meta.hasMore', true);
        $this->assertSame('MATCH-001', $response->json('data.0.deviceCode'));
        $this->assertSame('MATCH-020', $response->json('data.19.deviceCode'));
        $this->assertSame(['hasMore'], array_keys($response->json('meta')));

        Device::query()->where('device_code', 'MATCH-022')->update(['lifecycle_status' => 'retired']);
        $response = $this->getJson($base)->assertOk();
        $this->assertCount(20, $response->json('data'));
        $response->assertJsonPath('meta.hasMore', true);

        Device::query()->where('device_code', 'MATCH-021')->update(['lifecycle_status' => 'retired']);
        $response = $this->getJson($base)->assertOk();
        $this->assertCount(20, $response->json('data'));
        $response->assertJsonPath('meta.hasMore', false);

        Device::query()->where('device_code', 'MATCH-020')->update(['lifecycle_status' => 'retired']);
        $this->getJson($base)->assertOk()->assertJsonCount(19, 'data')->assertJsonPath('meta.hasMore', false);
        $this->getJson(str_replace('search=MATCH', 'search=NONE', $base))
            ->assertOk()
            ->assertExactJson(['data' => [], 'meta' => ['hasMore' => false]]);
        $this->getJson(str_replace('search=MATCH', 'search=MATCH-001', $base))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.hasMore', false);
    }

    public function test_static_reporting_routes_precede_detail_and_exact_permissions_are_registered(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/incidents'))
            ->values();

        $this->assertSame([
            'api/v1/incidents/reporting-context/laboratories',
            'api/v1/incidents/reporting-context/laboratories/{laboratoryId}/devices',
            'api/v1/incidents/submissions/{submissionId}',
            'api/v1/incidents',
            'api/v1/incidents',
            'api/v1/incidents/{incidentId}',
        ], $routes->map(fn ($route): string => $route->uri())->all());
        $this->assertContains('permission:incidents.create', $routes[0]->gatherMiddleware());
        $this->assertContains('permission:incidents.create', $routes[1]->gatherMiddleware());
        $this->assertContains('permission:incidents.view', $routes[2]->gatherMiddleware());
        $this->assertContains('permission:incidents.view', $routes[3]->gatherMiddleware());
        $this->assertContains('permission:incidents.create', $routes[4]->gatherMiddleware());
        $this->assertContains('permission:incidents.view', $routes[5]->gatherMiddleware());
        $this->assertNotContains('permission:laboratories.view', $routes[0]->gatherMiddleware());
        $this->assertNotContains('permission:devices.view', $routes[1]->gatherMiddleware());

        $this->authenticateWithPermissions(['incidents.create']);
        $this->getJson('/api/v1/incidents/reporting-context/laboratories')->assertOk();
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
        if ($permissions !== []) {
            $role = Role::factory()->create();
            $permissionIds = collect($permissions)->map(fn (string $key): string => Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key],
            )->id);
            $membership->roles()->attach($role->id);
            $role->permissions()->attach($permissionIds);
        }
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }
}
