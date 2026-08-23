<?php

namespace Tests\Feature;

use App\Models\Device;
use App\Models\Laboratory;
use App\Models\Layout;
use App\Models\LayoutChangeEvent;
use App\Models\LayoutDevicePlacement;
use App\Models\LayoutStructuralElement;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class LayoutApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_exact_seven_layout_routes_and_permissions_are_registered(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route) => str_contains($route->uri(), 'layout'))
            ->map(fn ($route) => [
                'method' => collect($route->methods())->first(fn ($method) => $method !== 'HEAD'),
                'uri' => $route->uri(),
                'middleware' => $route->gatherMiddleware(),
            ])->values();

        $this->assertCount(7, $routes);
        $this->assertSame([
            ['GET', 'api/v1/laboratories/{laboratoryId}/layouts', ['permission:layouts.view']],
            ['POST', 'api/v1/laboratories/{laboratoryId}/layouts', ['permission:layouts.create']],
            ['GET', 'api/v1/layouts/{layoutId}', ['permission:layouts.view']],
            ['PUT', 'api/v1/layouts/{layoutId}', ['permission:layouts.update']],
            ['POST', 'api/v1/layouts/{layoutId}/activate', ['permission:layouts.update']],
            ['DELETE', 'api/v1/layouts/{layoutId}', ['permission:layouts.delete']],
            ['GET', 'api/v1/layouts/{layoutId}/unplaced-devices', ['permission:layouts.view', 'permission:devices.view']],
        ], $routes->map(fn ($route) => [
            $route['method'],
            $route['uri'],
            array_values(array_filter($route['middleware'], fn ($middleware) => str_starts_with($middleware, 'permission:'))),
        ])->all());
    }

    public function test_guest_and_layouts_manage_only_user_are_rejected(): void
    {
        $this->getJson('/api/v1/layouts/'.Str::ulid())->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');
        $this->authenticate(['layouts.manage']);
        $this->getJson('/api/v1/layouts/'.Str::ulid())->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
    }

    #[DataProvider('endpointPermissionProvider')]
    public function test_each_endpoint_requires_exact_permissions(string $method, string $uri, array $required): void
    {
        [, $school] = $this->authenticate([]);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);
        $uri = str_replace(['{lab}', '{layout}'], [$lab->id, $layout->id], $uri);
        $headers = in_array($method, ['PUT', 'POST_ACTIVATE', 'DELETE'], true) ? ['If-Match' => '"1"'] : [];
        $actualMethod = $method === 'POST_ACTIVATE' ? 'POST' : $method;

        $this->json($actualMethod, $uri, $actualMethod === 'PUT' ? $this->replacePayload($layout) : [], $headers)
            ->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');

        foreach ($required as $permission) {
            $this->assertStringContainsString('.', $permission);
        }
    }

    public function test_create_empty_draft_derives_tenant_and_writes_create_event(): void
    {
        [$user, $school] = $this->authenticate(['layouts.create']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);

        $response = $this->postJson('/api/v1/laboratories/'.$lab->id.'/layouts', [
            'name' => '  Tata Letak Utama  ',
            'templateKey' => '  grid-classic  ',
            'rows' => 8,
            'columns' => 10,
        ])->assertCreated()->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.laboratoryId', $lab->id)
            ->assertJsonPath('data.name', 'Tata Letak Utama')
            ->assertJsonPath('data.templateKey', 'grid-classic')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.version', 1)
            ->assertJsonCount(0, 'data.structuralElements')
            ->assertJsonCount(0, 'data.devicePlacements');

        $layoutId = $response->json('data.id');
        $event = LayoutChangeEvent::query()->sole();
        $this->assertSame('layout.created', $event->event_type);
        $this->assertSame($layoutId, $event->layout_id_snapshot);
        $this->assertSame($user->id, $event->actor_id_snapshot);
    }

    public function test_create_clones_active_with_new_root_and_child_ids_and_optional_name_override(): void
    {
        [, $school] = $this->authenticate(['layouts.create']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $active = $this->layout($lab, 'active', ['name' => 'Aktif', 'template_key' => 'grid-classic']);
        $device = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $structure = $this->structure($active, ['element_type' => 'wall', 'row' => 1, 'column' => 1]);
        $placement = $this->placement($active, $device, ['row' => 2, 'column' => 2, 'role' => 'student_station']);

        $response = $this->postJson('/api/v1/laboratories/'.$lab->id.'/layouts', ['name' => '  Revisi 2  '])
            ->assertCreated()->assertJsonPath('data.name', 'Revisi 2')
            ->assertJsonPath('data.rows', $active->rows)
            ->assertJsonPath('data.templateKey', 'grid-classic')
            ->assertJsonPath('data.devicePlacements.0.deviceId', $device->id);

        $this->assertNotSame($active->id, $response->json('data.id'));
        $this->assertNotSame($structure->id, $response->json('data.structuralElements.0.id'));
        $this->assertNotSame($placement->id, $response->json('data.devicePlacements.0.id'));
        $this->assertSame(2, $response->json('data.devicePlacements.0.row'));
    }

    public function test_create_enforces_active_laboratory_single_draft_tenant_and_request_shape(): void
    {
        [, $school] = $this->authenticate(['layouts.create']);
        $inactive = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'inactive']);
        $this->postJson('/api/v1/laboratories/'.$inactive->id.'/layouts', $this->createPayload())
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_LABORATORY_INACTIVE');

        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $this->layout($lab);
        $this->postJson('/api/v1/laboratories/'.$lab->id.'/layouts', $this->createPayload())
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_DRAFT_ALREADY_EXISTS');

        $otherLab = Laboratory::factory()->create();
        $unknown = $this->postJson('/api/v1/laboratories/'.Str::ulid().'/layouts', $this->createPayload());
        $cross = $this->postJson('/api/v1/laboratories/'.$otherLab->id.'/layouts', $this->createPayload());
        $unknown->assertNotFound()->assertJsonPath('code', 'LABORATORY_NOT_FOUND');
        $cross->assertNotFound()->assertExactJson($unknown->json());

        $activeLab = Laboratory::factory()->create(['school_id' => $school->id]);
        $this->layout($activeLab, 'active');
        $this->postJson('/api/v1/laboratories/'.$activeLab->id.'/layouts', ['rows' => 5])
            ->assertUnprocessable()->assertJsonValidationErrors('rows');
        $this->postJson('/api/v1/laboratories/'.$activeLab->id.'/layouts', ['children' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('children');
    }

    public function test_list_is_tenant_scoped_paginated_filtered_summary_only_and_deterministic(): void
    {
        [, $school] = $this->authenticate(['layouts.view']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $older = $this->layout($lab, 'archived');
        DB::table('layouts')->where('id', $older->id)->update(['created_at' => now()->subDay(), 'updated_at' => now()->subDay()]);
        $newer = $this->layout($lab, 'active');
        $this->layout(Laboratory::factory()->create());

        $this->getJson('/api/v1/laboratories/'.$lab->id.'/layouts?perPage=1&page=1')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonMissingPath('data.0.structuralElements')->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.lastPage', 2);
        $this->getJson('/api/v1/laboratories/'.$lab->id.'/layouts?status=archived')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $older->id);
        $this->getJson('/api/v1/laboratories/'.$lab->id.'/layouts?sort=name')
            ->assertUnprocessable()->assertJsonValidationErrors('sort');
    }

    public function test_detail_returns_exact_aggregate_order_and_strong_etag_without_tenant_leak(): void
    {
        [, $school] = $this->authenticate(['layouts.view']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab, 'active', ['version' => 7]);
        $later = $this->structure($layout, ['row' => 3, 'column' => 2]);
        $earlier = $this->structure($layout, ['row' => 1, 'column' => 4]);

        $response = $this->getJson('/api/v1/layouts/'.$layout->id)->assertOk()->assertHeader('ETag', '"7"');
        $this->assertSame($earlier->id, $response->json('data.structuralElements.0.id'));
        $this->assertSame($later->id, $response->json('data.structuralElements.1.id'));
        $this->assertSame([
            'id', 'schoolId', 'laboratoryId', 'name', 'templateKey', 'rows', 'columns', 'status',
            'version', 'activatedAt', 'archivedAt', 'createdAt', 'updatedAt', 'structuralElements', 'devicePlacements',
        ], array_keys($response->json('data')));

        $other = $this->layout(Laboratory::factory()->create());
        $unknown = $this->getJson('/api/v1/layouts/'.Str::ulid());
        $cross = $this->getJson('/api/v1/layouts/'.$other->id);
        $unknown->assertNotFound()->assertJsonPath('code', 'LAYOUT_NOT_FOUND');
        $cross->assertNotFound()->assertExactJson($unknown->json());
    }

    public function test_full_put_applies_mixed_mutation_once_preserves_existing_ids_and_writes_audit(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);
        $wall = $this->structure($layout, ['element_type' => 'wall', 'row' => 1, 'column' => 1]);
        $removed = $this->structure($layout, ['element_type' => 'door', 'row' => 1, 'column' => 2]);
        $first = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $second = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $placement = $this->placement($layout, $first, ['row' => 2, 'column' => 1, 'role' => 'student_station']);
        DB::table('layouts')->where('id', $layout->id)->update(['updated_at' => now()->subMinute()]);
        $layout->refresh();
        $beforeTime = $layout->updated_at->toISOString();

        $payload = [
            'name' => 'Revisi', 'templateKey' => null, 'rows' => 10, 'columns' => 10,
            'structuralElements' => [
                ['id' => $wall->id, 'type' => 'wall', 'label' => 'Utara', 'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 2, 'rotation' => 0],
                ['type' => 'label', 'label' => 'Area A', 'row' => 1, 'column' => 4, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0],
            ],
            'devicePlacements' => [
                ['id' => $placement->id, 'deviceId' => $first->id, 'role' => 'teacher_station', 'label' => 'Guru', 'row' => 3, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 90],
                ['deviceId' => $second->id, 'role' => 'student_station', 'label' => 'PC-02', 'row' => 3, 'column' => 2, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0],
            ],
        ];

        $response = $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertOk()->assertHeader('ETag', '"2"')->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.name', 'Revisi');
        $this->assertSame($wall->id, $response->json('data.structuralElements.0.id'));
        $this->assertSame($placement->id, $response->json('data.devicePlacements.0.id'));
        $this->assertDatabaseMissing('layout_structural_elements', ['id' => $removed->id]);
        $this->assertNotSame($beforeTime, $layout->fresh()->updated_at->toISOString());
        $this->assertEqualsCanonicalizing(
            ['layout.structure_updated', 'device.moved', 'device.placed'],
            LayoutChangeEvent::query()->pluck('event_type')->all(),
        );
    }

    public function test_semantically_reordered_trim_normalized_put_is_noop_but_stale_noop_fails_first(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab, 'draft', ['name' => 'Layout', 'template_key' => null, 'updated_at' => now()->subMinute()]);
        $a = $this->structure($layout, ['element_type' => 'wall', 'label' => null, 'row' => 1, 'column' => 1]);
        $b = $this->structure($layout, ['element_type' => 'door', 'label' => null, 'row' => 1, 'column' => 2]);
        $updatedAt = $layout->fresh()->updated_at->toISOString();
        $payload = $this->replacePayload($layout, [
            'name' => '  Layout  ',
            'templateKey' => '   ',
            'structuralElements' => array_reverse([
                $this->structurePayload($a, ['label' => '  ']),
                $this->structurePayload($b),
            ]),
        ]);

        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertOk()->assertHeader('ETag', '"1"')->assertJsonPath('data.updatedAt', $updatedAt);
        $this->assertDatabaseCount('layout_change_events', 0);

        $layout->update(['version' => 2]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertStatus(412)->assertJsonPath('code', 'LAYOUT_VERSION_CONFLICT');
        $this->assertDatabaseCount('layout_change_events', 0);
    }

    #[DataProvider('invalidGeometryProvider')]
    public function test_geometry_validation_rejects_bounds_spans_rotation_and_all_collision_kinds(array $payload, int $status, string $code): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab, 'draft', ['rows' => 5, 'columns' => 5]);
        $deviceA = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $deviceB = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $payload = json_decode(str_replace(
            ['{deviceA}', '{deviceB}'],
            [$deviceA->id, $deviceB->id],
            json_encode($payload, JSON_THROW_ON_ERROR),
        ), true, 512, JSON_THROW_ON_ERROR);
        $payload = $this->replacePayload($layout, $payload);

        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertStatus($status)->assertJsonPath('code', $code);
        $this->assertSame(1, $layout->fresh()->version);
        $this->assertDatabaseCount('layout_change_events', 0);
    }

    public function test_device_placement_eligibility_and_role_rules_are_enforced_without_tenant_leak(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $otherLab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);

        $cases = [
            [Device::factory()->create(['school_id' => $school->id]), 'LAYOUT_DEVICE_HOME_MISMATCH', 409, null],
            [Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $otherLab->id]), 'LAYOUT_DEVICE_HOME_MISMATCH', 409, null],
            [Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'lifecycle_status' => 'retired']), 'LAYOUT_DEVICE_NOT_ELIGIBLE', 409, null],
            [Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'lifecycle_status' => 'decommissioned']), 'LAYOUT_DEVICE_NOT_ELIGIBLE', 409, null],
            [Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'device_type' => 'printer']), 'VALIDATION_FAILED', 422, 'student_station'],
            [Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'device_type' => 'router']), 'VALIDATION_FAILED', 422, 'teacher_station'],
        ];
        foreach ($cases as [$device, $code, $status, $role]) {
            $payload = $this->replacePayload($layout, ['devicePlacements' => [[
                'deviceId' => $device->id, 'role' => $role, 'label' => null,
                'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0,
            ]]]);
            $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
                ->assertStatus($status)->assertJsonPath('code', $code);
        }

        $foreign = Device::factory()->create();
        foreach ([$foreign->id, (string) Str::ulid()] as $deviceId) {
            $payload = $this->replacePayload($layout, ['devicePlacements' => [[
                'deviceId' => $deviceId, 'role' => null, 'label' => null,
                'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0,
            ]]]);
            $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
                ->assertUnprocessable()->assertJsonValidationErrors('devicePlacements.0.deviceId');
        }
    }

    public function test_valid_device_types_roles_duplicate_device_and_sparse_extreme_grids(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab, 'draft', ['rows' => 1, 'columns' => 1]);
        $desktop = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);

        $payload = $this->replacePayload($layout, ['devicePlacements' => [[
            'deviceId' => $desktop->id, 'role' => 'teacher_station', 'label' => null,
            'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 270,
        ]]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])->assertOk();

        $duplicate = $this->replacePayload($layout->fresh(), ['devicePlacements' => [
            [...$payload['devicePlacements'][0]],
            [...$payload['devicePlacements'][0], 'row' => 1, 'column' => 1],
        ]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $duplicate, ['If-Match' => '"2"'])
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_DEVICE_ALREADY_PLACED');

        $empty = $this->replacePayload($layout->fresh(), [
            'rows' => 50, 'columns' => 50, 'structuralElements' => [], 'devicePlacements' => [],
        ]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $empty, ['If-Match' => '"2"'])
            ->assertOk()->assertJsonPath('data.rows', 50)->assertJsonCount(0, 'data.devicePlacements');
    }

    public function test_desktop_laptop_and_non_station_devices_accept_only_their_valid_roles(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab, 'draft', ['rows' => 3, 'columns' => 3]);
        $desktop = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $laptop = Device::factory()->create([
            'school_id' => $school->id, 'home_laboratory_id' => $lab->id,
            'device_type' => 'laptop', 'lifecycle_status' => 'spare',
        ]);
        $printer = Device::factory()->create([
            'school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'device_type' => 'printer',
        ]);
        $payload = $this->replacePayload($layout, ['devicePlacements' => [
            ['deviceId' => $desktop->id, 'role' => 'student_station', 'label' => null, 'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0],
            ['deviceId' => $laptop->id, 'role' => 'teacher_station', 'label' => null, 'row' => 1, 'column' => 2, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0],
            ['deviceId' => $printer->id, 'role' => null, 'label' => null, 'row' => 1, 'column' => 3, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0],
        ]]);

        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertOk()->assertJsonCount(3, 'data.devicePlacements');
    }

    public function test_put_rejects_closed_or_incomplete_payload_and_foreign_child_ids(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);
        $foreignLayout = $this->layout(Laboratory::factory()->create(['school_id' => $school->id]));
        $foreignChild = $this->structure($foreignLayout);

        $this->putJson('/api/v1/layouts/'.$layout->id, ['name' => 'Only'], ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors(['templateKey', 'rows', 'columns', 'structuralElements', 'devicePlacements']);
        $payload = $this->replacePayload($layout, ['schoolId' => $school->id]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors('schoolId');
        $payload = $this->replacePayload($layout, ['structuralElements' => [[
            'id' => $foreignChild->id, 'type' => 'wall', 'label' => null,
            'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0,
        ]]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors('structuralElements.0.id');
        $payload['structuralElements'][0]['id'] = null;
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors('structuralElements.0.id');

        $payload = $this->replacePayload($layout, ['structuralElements' => [
            $this->structurePayload($foreignChild), $this->structurePayload($foreignChild),
        ]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors('structuralElements.1.id');

        $payload = $this->replacePayload($layout, ['structuralElements' => [[
            'type' => 'wall', 'label' => null, 'row' => 1, 'column' => 1,
            'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0, 'movable' => true,
        ]]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonValidationErrors('structuralElements.0');
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_put_activate_and_delete_require_exact_strong_if_match(?string $header): void
    {
        [, $school] = $this->authenticate(['layouts.update', 'layouts.delete']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);
        $headers = $header === null ? [] : ['If-Match' => $header];

        $this->putJson('/api/v1/layouts/'.$layout->id, $this->replacePayload($layout), $headers)
            ->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');
        $this->postJson('/api/v1/layouts/'.$layout->id.'/activate', [], $headers)
            ->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');
        $this->deleteJson('/api/v1/layouts/'.$layout->id, [], $headers)
            ->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');
    }

    public function test_activation_archives_predecessor_atomically_preserves_children_and_increments_versions_once(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $active = $this->layout($lab, 'active', ['version' => 4]);
        $wall = $this->structure($active);
        $draft = $this->layout($lab, 'draft', ['version' => 2]);
        $device = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $this->placement($draft, $device);

        $response = $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"2"'])
            ->assertOk()->assertHeader('ETag', '"3"')->assertJsonPath('data.status', 'active');
        $active->refresh();
        $draft->refresh();
        $this->assertSame('archived', $active->status);
        $this->assertSame(5, $active->version);
        $this->assertSame(3, $draft->version);
        $this->assertSame($draft->activated_at->toISOString(), $active->archived_at->toISOString());
        $this->assertDatabaseHas('layout_structural_elements', ['id' => $wall->id, 'layout_id' => $active->id]);
        $this->assertSame(
            ['layout.archived', 'layout.activated'],
            LayoutChangeEvent::query()->orderBy('created_at')->orderBy('id')->pluck('event_type')->all(),
        );
        $this->assertSame($draft->id, $response->json('data.id'));
    }

    public function test_first_activation_without_predecessor_creates_the_only_active_layout(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $draft = $this->layout($lab);

        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"1"'])
            ->assertOk()->assertHeader('ETag', '"2"')->assertJsonPath('data.status', 'active');
        $this->assertSame(1, Layout::query()->where('laboratory_id', $lab->id)->where('status', 'active')->count());
        $this->assertSame(0, Layout::query()->where('laboratory_id', $lab->id)->where('status', 'draft')->count());
    }

    public function test_activation_revalidates_current_device_and_laboratory_state_and_rejects_body(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $draft = $this->layout($lab);
        $device = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $this->placement($draft, $device);

        $device->update(['lifecycle_status' => 'retired']);
        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"1"'])
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_DEVICE_NOT_ELIGIBLE');
        $device->update(['lifecycle_status' => 'in_service']);
        $otherLab = Laboratory::factory()->create(['school_id' => $school->id]);
        $device->update(['home_laboratory_id' => $otherLab->id]);
        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"1"'])
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_DEVICE_HOME_MISMATCH');
        $device->update(['home_laboratory_id' => $lab->id]);
        $lab->update(['status' => 'inactive']);
        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"1"'])
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_LABORATORY_INACTIVE');
        $lab->update(['status' => 'active']);
        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', ['force' => true], ['If-Match' => '"1"'])
            ->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertDatabaseCount('layout_change_events', 0);
    }

    public function test_put_and_delete_status_inactive_and_stale_rules(): void
    {
        [, $school] = $this->authenticate(['layouts.update', 'layouts.delete']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $active = $this->layout($lab, 'active');
        $archived = $this->layout($lab, 'archived');
        foreach ([$active, $archived] as $immutable) {
            $this->putJson('/api/v1/layouts/'.$immutable->id, $this->replacePayload($immutable), ['If-Match' => '"1"'])
                ->assertConflict()->assertJsonPath('code', 'LAYOUT_STATUS_CONFLICT');
            $this->deleteJson('/api/v1/layouts/'.$immutable->id, [], ['If-Match' => '"1"'])
                ->assertConflict()->assertJsonPath('code', 'LAYOUT_STATUS_CONFLICT');
        }

        $draft = $this->layout($lab, 'draft');
        $lab->update(['status' => 'inactive']);
        $this->putJson('/api/v1/layouts/'.$draft->id, $this->replacePayload($draft), ['If-Match' => '"1"'])
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_LABORATORY_INACTIVE');
        $this->deleteJson('/api/v1/layouts/'.$draft->id, [], ['If-Match' => '"2"'])
            ->assertStatus(412)->assertJsonPath('code', 'LAYOUT_VERSION_CONFLICT');
        $this->postJson('/api/v1/layouts/'.$draft->id.'/activate', [], ['If-Match' => '"2"'])
            ->assertStatus(412)->assertJsonPath('code', 'LAYOUT_VERSION_CONFLICT');
    }

    public function test_delete_inactive_lab_draft_cascades_children_and_preserves_null_linked_audit(): void
    {
        [$user, $school] = $this->authenticate(['layouts.delete']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'inactive']);
        $draft = $this->layout($lab);
        $child = $this->structure($draft);

        $this->deleteJson('/api/v1/layouts/'.$draft->id, [], ['If-Match' => '"1"'])->assertNoContent();
        $this->assertDatabaseMissing('layouts', ['id' => $draft->id]);
        $this->assertDatabaseMissing('layout_structural_elements', ['id' => $child->id]);
        $event = LayoutChangeEvent::query()->sole();
        $this->assertNull($event->layout_id);
        $this->assertSame($draft->id, $event->layout_id_snapshot);
        $this->assertSame($user->id, $event->actor_id_snapshot);
    }

    public function test_unplaced_pool_is_layout_relative_paginated_searchable_and_minimal(): void
    {
        [, $school] = $this->authenticate(['layouts.view', 'devices.view']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $active = $this->layout($lab, 'active');
        $draft = $this->layout($lab, 'draft');
        $devices = collect(range(1, 40))->map(fn ($number) => Device::factory()->create([
            'school_id' => $school->id,
            'home_laboratory_id' => $lab->id,
            'device_code' => 'DEV-'.str_pad((string) $number, 6, '0', STR_PAD_LEFT),
            'hostname' => $number === 40 ? 'TARGET-HOST' : null,
            'lifecycle_status' => $number === 39 ? 'spare' : 'in_service',
        ]));
        foreach ($devices->take(36) as $device) {
            $this->placement($active, $device);
            $this->placement($draft, $device);
        }
        $removedFromDraft = $devices[36];
        $this->placement($active, $removedFromDraft);
        Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => null]);
        Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id, 'lifecycle_status' => 'retired']);
        Device::factory()->create();

        $response = $this->getJson('/api/v1/layouts/'.$draft->id.'/unplaced-devices?perPage=2&page=1')
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.total', 4)->assertJsonPath('meta.lastPage', 2);
        $this->assertSame($removedFromDraft->id, $response->json('data.0.id'));
        $this->assertSame(
            ['id', 'deviceCode', 'deviceType', 'lifecycleStatus', 'hostname', 'brand', 'model'],
            array_keys($response->json('data.0')),
        );
        $this->getJson('/api/v1/layouts/'.$draft->id.'/unplaced-devices?search=target-host')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $devices[39]->id);
    }

    public function test_unplaced_requires_both_permissions_and_rejects_archived_or_unknown_layout(): void
    {
        foreach ([['layouts.view'], ['devices.view']] as $permissions) {
            [, $school] = $this->authenticate($permissions);
            $layout = $this->layout(Laboratory::factory()->create(['school_id' => $school->id]));
            $this->getJson('/api/v1/layouts/'.$layout->id.'/unplaced-devices')
                ->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
        }

        [, $school] = $this->authenticate(['layouts.view', 'devices.view']);
        $archived = $this->layout(Laboratory::factory()->create(['school_id' => $school->id]), 'archived');
        $this->getJson('/api/v1/layouts/'.$archived->id.'/unplaced-devices')
            ->assertConflict()->assertJsonPath('code', 'LAYOUT_STATUS_CONFLICT');
        $this->getJson('/api/v1/layouts/'.Str::ulid().'/unplaced-devices')
            ->assertNotFound()->assertJsonPath('code', 'LAYOUT_NOT_FOUND');
    }

    public function test_cross_tenant_mutations_are_indistinguishable_and_do_not_mutate_or_audit(): void
    {
        $this->authenticate(['layouts.update', 'layouts.delete']);
        $foreign = $this->layout(Laboratory::factory()->create());
        $unknownId = (string) Str::ulid();
        foreach ([$foreign->id, $unknownId] as $id) {
            $this->putJson('/api/v1/layouts/'.$id, $this->replacePayload($foreign), ['If-Match' => '"1"'])
                ->assertNotFound()->assertJsonPath('code', 'LAYOUT_NOT_FOUND');
            $this->postJson('/api/v1/layouts/'.$id.'/activate', [], ['If-Match' => '"1"'])
                ->assertNotFound()->assertJsonPath('code', 'LAYOUT_NOT_FOUND');
            $this->deleteJson('/api/v1/layouts/'.$id, [], ['If-Match' => '"1"'])
                ->assertNotFound()->assertJsonPath('code', 'LAYOUT_NOT_FOUND');
        }
        $this->assertDatabaseCount('layout_change_events', 0);
    }

    public function test_database_enforces_partial_uniqueness_tenant_composites_cascades_and_device_restrict(): void
    {
        $school = School::factory()->create();
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $this->layout($lab, 'draft');
        try {
            $this->layout($lab, 'draft');
            $this->fail('Expected the one-draft partial unique index to reject a duplicate.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }

        $firstActive = $this->layout($lab, 'active');
        try {
            $this->layout($lab, 'active');
            $this->fail('Expected the one-active partial unique index to reject a duplicate.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
        $this->assertSame('active', $firstActive->fresh()->status);

        $otherSchool = School::factory()->create();
        try {
            Layout::query()->create([
                'school_id' => $otherSchool->id, 'laboratory_id' => $lab->id, 'name' => 'Invalid',
                'rows' => 1, 'columns' => 1, 'status' => 'draft', 'version' => 1,
            ]);
            $this->fail('Expected tenant composite Laboratory FK to reject mismatched ancestry.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }

        $layout = Layout::query()->where('laboratory_id', $lab->id)->where('status', 'draft')->firstOrFail();
        $device = Device::factory()->create(['school_id' => $school->id, 'home_laboratory_id' => $lab->id]);
        $placement = $this->placement($layout, $device);
        try {
            $this->placement($layout, $device, ['id' => (string) Str::ulid(), 'row' => 2]);
            $this->fail('Expected one Device per Layout to be database-enforced.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
        $foreignDevice = Device::factory()->create();
        try {
            $this->placement($layout, $foreignDevice, ['id' => (string) Str::ulid(), 'row' => 3]);
            $this->fail('Expected the tenant composite Device FK to reject mismatched ancestry.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
        try {
            $device->delete();
            $this->fail('Expected placement FK to restrict Device deletion.');
        } catch (QueryException) {
            $this->assertTrue(true);
        }
        $layout->delete();
        $this->assertDatabaseMissing('layout_device_placements', ['id' => $placement->id]);
    }

    public function test_layout_factory_creates_valid_composite_tenant_ancestry(): void
    {
        $layout = Layout::factory()->create();

        $this->assertSame($layout->school_id, $layout->laboratory->school_id);
    }

    public function test_audit_payloads_exclude_device_qr_profile_telemetry_and_asset_data(): void
    {
        [, $school] = $this->authenticate(['layouts.update']);
        $lab = Laboratory::factory()->create(['school_id' => $school->id]);
        $layout = $this->layout($lab);
        $device = Device::factory()->create([
            'school_id' => $school->id,
            'home_laboratory_id' => $lab->id,
            'technical_profile' => ['processor' => 'secret-profile-marker'],
        ]);
        $payload = $this->replacePayload($layout, ['devicePlacements' => [[
            'deviceId' => $device->id, 'role' => null, 'label' => 'Printer',
            'row' => 1, 'column' => 1, 'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0,
        ]]]);
        $this->putJson('/api/v1/layouts/'.$layout->id, $payload, ['If-Match' => '"1"'])->assertOk();

        $json = LayoutChangeEvent::query()->get()->toJson();
        foreach ([$device->qr_public_id, 'secret-profile-marker', 'technicalProfile', 'telemetry', 'assetId'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $json);
        }
    }

    public static function endpointPermissionProvider(): array
    {
        return [
            'list' => ['GET', '/api/v1/laboratories/{lab}/layouts', ['layouts.view']],
            'create' => ['POST', '/api/v1/laboratories/{lab}/layouts', ['layouts.create']],
            'detail' => ['GET', '/api/v1/layouts/{layout}', ['layouts.view']],
            'replace' => ['PUT', '/api/v1/layouts/{layout}', ['layouts.update']],
            'activate' => ['POST_ACTIVATE', '/api/v1/layouts/{layout}/activate', ['layouts.update']],
            'delete' => ['DELETE', '/api/v1/layouts/{layout}', ['layouts.delete']],
            'unplaced' => ['GET', '/api/v1/layouts/{layout}/unplaced-devices', ['layouts.view', 'devices.view']],
        ];
    }

    public static function invalidIfMatchProvider(): array
    {
        return [
            'missing' => [null], 'unquoted' => ['1'], 'weak' => ['W/"1"'], 'wildcard' => ['*'],
            'multiple' => ['"1", "2"'], 'zero' => ['"0"'], 'negative' => ['"-1"'],
            'nonnumeric' => ['"abc"'], 'malformed' => ['"1'], 'whitespace' => [' "1" '],
        ];
    }

    public static function invalidGeometryProvider(): array
    {
        $base = ['name' => 'Layout', 'templateKey' => null, 'rows' => 5, 'columns' => 5, 'structuralElements' => [], 'devicePlacements' => []];
        $structure = fn (array $overrides = []) => [
            'type' => 'wall', 'label' => null, 'row' => 1, 'column' => 1,
            'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0, ...$overrides,
        ];
        $placement = fn (string $device, array $overrides = []) => [
            'deviceId' => $device, 'role' => null, 'label' => null, 'row' => 1, 'column' => 1,
            'rowSpan' => 1, 'columnSpan' => 1, 'rotation' => 0, ...$overrides,
        ];

        return [
            'rows zero' => [[...$base, 'rows' => 0], 422, 'VALIDATION_FAILED'],
            'rows 51' => [[...$base, 'rows' => 51], 422, 'VALIDATION_FAILED'],
            'columns zero' => [[...$base, 'columns' => 0], 422, 'VALIDATION_FAILED'],
            'columns 51' => [[...$base, 'columns' => 51], 422, 'VALIDATION_FAILED'],
            'zero coordinate' => [[...$base, 'structuralElements' => [$structure(['row' => 0])]], 422, 'VALIDATION_FAILED'],
            'zero span' => [[...$base, 'structuralElements' => [$structure(['rowSpan' => 0])]], 422, 'VALIDATION_FAILED'],
            'out of bounds' => [[...$base, 'structuralElements' => [$structure(['row' => 5, 'rowSpan' => 2])]], 422, 'VALIDATION_FAILED'],
            'rotation invalid' => [[...$base, 'structuralElements' => [$structure(['rotation' => 45])]], 422, 'VALIDATION_FAILED'],
            'structure collision' => [[...$base, 'structuralElements' => [$structure(), $structure(['type' => 'door'])]], 409, 'LAYOUT_POSITION_OCCUPIED'],
            'placement collision' => [[...$base, 'devicePlacements' => [$placement('{deviceA}'), $placement('{deviceB}')]], 409, 'LAYOUT_POSITION_OCCUPIED'],
            'cross collision' => [[...$base, 'structuralElements' => [$structure()], 'devicePlacements' => [$placement('{deviceA}')]], 409, 'LAYOUT_POSITION_OCCUPIED'],
            'placement clipped' => [[...$base, 'devicePlacements' => [$placement('{deviceA}', ['column' => 5, 'columnSpan' => 2])]], 422, 'VALIDATION_FAILED'],
        ];
    }

    /** @param list<string> $permissions @return array{User, School, SchoolMembership} */
    private function authenticate(array $permissions, ?School $school = null): array
    {
        $user = User::factory()->create();
        $school ??= School::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id, 'user_id' => $user->id, 'status' => 'active',
        ]);
        if ($permissions !== []) {
            $role = Role::factory()->create();
            $ids = collect($permissions)->map(fn (string $key) => Permission::query()->firstOrCreate(
                ['key' => $key], ['name' => $key],
            )->id);
            $membership->roles()->attach($role->id);
            $role->permissions()->attach($ids);
        }
        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /** @param array<string, mixed> $overrides */
    private function layout(Laboratory $lab, string $status = 'draft', array $overrides = []): Layout
    {
        $timestamps = $status === 'draft'
            ? ['activated_at' => null, 'archived_at' => null]
            : ($status === 'active'
                ? ['activated_at' => now()->subHour(), 'archived_at' => null]
                : ['activated_at' => now()->subDay(), 'archived_at' => now()->subHour()]);

        return Layout::query()->create([
            'school_id' => $lab->school_id, 'laboratory_id' => $lab->id, 'name' => 'Layout',
            'template_key' => null, 'rows' => 8, 'columns' => 8, 'status' => $status,
            'version' => 1, ...$timestamps, ...$overrides,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function structure(Layout $layout, array $overrides = []): LayoutStructuralElement
    {
        return LayoutStructuralElement::query()->create([
            'school_id' => $layout->school_id, 'layout_id' => $layout->id, 'element_type' => 'wall',
            'label' => null, 'row' => 1, 'column' => 1, 'row_span' => 1, 'column_span' => 1,
            'rotation' => 0, ...$overrides,
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function placement(Layout $layout, Device $device, array $overrides = []): LayoutDevicePlacement
    {
        return LayoutDevicePlacement::query()->create([
            'school_id' => $layout->school_id, 'layout_id' => $layout->id, 'device_id' => $device->id,
            'role' => null, 'label' => null, 'row' => 1, 'column' => 1, 'row_span' => 1,
            'column_span' => 1, 'rotation' => 0, ...$overrides,
        ]);
    }

    private function createPayload(): array
    {
        return ['name' => 'Layout', 'templateKey' => null, 'rows' => 8, 'columns' => 8];
    }

    /** @param array<string, mixed> $overrides */
    private function replacePayload(Layout $layout, array $overrides = []): array
    {
        $layout->load(['structuralElements', 'devicePlacements']);

        return [
            'name' => $layout->name,
            'templateKey' => $layout->template_key,
            'rows' => $layout->rows,
            'columns' => $layout->columns,
            'structuralElements' => $layout->structuralElements->map(fn ($element) => $this->structurePayload($element))->all(),
            'devicePlacements' => $layout->devicePlacements->map(fn ($placement) => [
                'id' => $placement->id, 'deviceId' => $placement->device_id, 'role' => $placement->role,
                'label' => $placement->label, 'row' => $placement->row, 'column' => $placement->column,
                'rowSpan' => $placement->row_span, 'columnSpan' => $placement->column_span,
                'rotation' => $placement->rotation,
            ])->all(),
            ...$overrides,
        ];
    }

    /** @param array<string, mixed> $overrides */
    private function structurePayload(LayoutStructuralElement $element, array $overrides = []): array
    {
        return [
            'id' => $element->id, 'type' => $element->element_type, 'label' => $element->label,
            'row' => $element->row, 'column' => $element->column, 'rowSpan' => $element->row_span,
            'columnSpan' => $element->column_span, 'rotation' => $element->rotation, ...$overrides,
        ];
    }
}
