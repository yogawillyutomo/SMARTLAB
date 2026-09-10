<?php

namespace Tests\Feature;

use App\Http\Middleware\RequireMaintenanceCampaignVersionPrecondition;
use App\Models\Asset;
use App\Models\Laboratory;
use App\Models\MaintenanceCampaign;
use App\Models\MaintenanceCampaignEvent;
use App\Models\MaintenanceCampaignItem;
use App\Models\MaintenanceExecution;
use App\Models\MaintenancePlan;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class MaintenanceCampaignApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_campaign_create_requires_existing_maintenance_and_exact_scope_permissions(): void
    {
        [, $school] = $this->authenticateWithPermissions(['maintenance.create-plan']);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['home_laboratory_id' => $lab->id]);

        $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$asset]))
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->assertDatabaseCount('maintenance_campaigns', 0);
        $this->assertDatabaseCount('maintenance_plans', 0);
    }

    public function test_campaign_atomically_provisions_one_exact_plan_per_selected_same_lab_asset(): void
    {
        [$user, $school] = $this->authenticateWithPermissions([
            'maintenance.view', 'maintenance.create-plan', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create(['code' => 'RPL1', 'name' => 'Lab RPL 1']);
        $assets = collect([
            Asset::factory()->for($school)->create([
                'asset_code' => 'PC-001', 'name' => 'PC 001', 'home_laboratory_id' => $lab->id, 'condition' => 'good',
            ]),
            Asset::factory()->for($school)->create([
                'asset_code' => 'PC-002', 'name' => 'PC 002', 'home_laboratory_id' => $lab->id, 'condition' => 'good',
            ]),
            Asset::factory()->for($school)->create([
                'asset_code' => 'SW-001', 'name' => 'Switch 001', 'home_laboratory_id' => $lab->id, 'condition' => 'good',
            ]),
        ]);

        $response = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, $assets->all()))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.laboratoryId', $lab->id)
            ->assertJsonPath('data.laboratoryCodeSnapshot', 'RPL1')
            ->assertJsonPath('data.laboratoryNameSnapshot', 'Lab RPL 1')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.itemCount', 3)
            ->assertJsonCount(3, 'data.items')
            ->assertJsonPath('data.version', 1);

        $campaignId = (string) $response->json('data.id');
        $this->assertTrue(Str::isUlid($campaignId));
        $this->assertStringStartsWith('MC-', (string) $response->json('data.campaignCode'));

        $this->assertDatabaseCount('maintenance_campaigns', 1);
        $this->assertDatabaseCount('maintenance_campaign_items', 3);
        $this->assertDatabaseCount('maintenance_plans', 3);
        $this->assertDatabaseCount('maintenance_executions', 0);

        $items = MaintenanceCampaignItem::query()->where('maintenance_campaign_id', $campaignId)->get();
        $this->assertEqualsCanonicalizing($assets->pluck('id')->all(), $items->pluck('asset_id')->all());

        foreach ($items as $item) {
            $plan = MaintenancePlan::query()->findOrFail($item->maintenance_plan_id);
            $this->assertSame((string) $item->asset_id, (string) $plan->asset_id);
            $this->assertSame((string) $item->plan_code_snapshot, (string) $plan->plan_code);
            $this->assertSame('monthly', $plan->frequency_kind);
            $this->assertSame(['Bersihkan debu', 'Cek koneksi'], $plan->checklist_template);
            $this->assertSame('active', $plan->status);
        }

        $this->assertSame(0, MaintenanceExecution::query()->where('custody_active', true)->count());
        $this->assertDatabaseHas('maintenance_campaign_events', [
            'maintenance_campaign_id' => $campaignId,
            'event_type' => 'maintenance_campaign.created',
            'actor_user_id_snapshot' => $user->id,
        ]);
    }

    public function test_campaign_rejects_cross_lab_cross_school_and_ineligible_assets_without_partial_plans(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.create-plan', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $otherLab = Laboratory::factory()->for($school)->create();
        $valid = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id, 'condition' => 'good', 'lifecycle_status' => 'active',
        ]);
        $wrongLab = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $otherLab->id, 'condition' => 'good', 'lifecycle_status' => 'active',
        ]);

        $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$valid, $wrongLab]))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertDatabaseCount('maintenance_campaigns', 0);
        $this->assertDatabaseCount('maintenance_campaign_items', 0);
        $this->assertDatabaseCount('maintenance_plans', 0);

        $retired = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id, 'condition' => 'good', 'lifecycle_status' => 'retired',
        ]);
        $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$valid, $retired]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_ASSET_UNAVAILABLE');

        $this->assertDatabaseCount('maintenance_campaigns', 0);
        $this->assertDatabaseCount('maintenance_plans', 0);

        $otherSchool = School::factory()->create();
        $foreign = Asset::factory()->for($otherSchool)->create();
        $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$valid, $foreign]))
            ->assertUnprocessable();

        $this->assertDatabaseCount('maintenance_campaigns', 0);
        $this->assertDatabaseCount('maintenance_plans', 0);
    }

    public function test_batch_schedule_creates_exact_executions_atomically_without_campaign_custody(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.view', 'maintenance.create-plan', 'maintenance.schedule',
            'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $assets = collect(range(1, 3))->map(fn (int $i) => Asset::factory()->for($school)->create([
            'asset_code' => 'BATCH-00'.$i,
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
            'lifecycle_status' => 'active',
        ]));

        $campaign = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, $assets->all()))
            ->assertCreated();
        $campaignId = (string) $campaign->json('data.id');
        $date = now()->addDays(3)->toDateString();

        $result = $this->postJson("/api/v1/maintenance-campaigns/{$campaignId}/executions", [
            'scheduledFor' => $date,
            'technicianName' => 'Teknisi Batch',
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('meta.executionCount', 3)
            ->assertJsonCount(3, 'executions');

        $executionIds = collect($result->json('executions'))->pluck('id')->all();
        $this->assertCount(3, array_unique($executionIds));
        $this->assertDatabaseCount('maintenance_executions', 3);
        $this->assertSame(0, MaintenanceExecution::query()->where('custody_active', true)->count());

        foreach (MaintenanceExecution::query()->get() as $execution) {
            $this->assertSame('scheduled', $execution->status);
            $this->assertSame($date, $execution->scheduled_for->toDateString());
            $this->assertSame(['Bersihkan debu', 'Cek koneksi'], $execution->checklist_snapshot);
            $this->assertContains((string) $execution->asset_id, $assets->pluck('id')->all());
        }

        $this->postJson("/api/v1/maintenance-campaigns/{$campaignId}/executions", [
            'scheduledFor' => now()->addDays(4)->toDateString(),
            'technicianName' => 'Teknisi Batch',
        ], ['If-Match' => '"1"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'MAINTENANCE_CAMPAIGN_VERSION_CONFLICT');

        $this->assertDatabaseCount('maintenance_executions', 3);
        $this->assertDatabaseHas('maintenance_campaign_events', [
            'maintenance_campaign_id' => $campaignId,
            'event_type' => 'maintenance_campaign.batch_scheduled',
        ]);
    }

    public function test_batch_schedule_supports_subset_but_rejects_non_campaign_asset(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.create-plan', 'maintenance.schedule', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $assets = collect(range(1, 4))->map(fn (int $i) => Asset::factory()->for($school)->create([
            'asset_code' => 'SUBSET-00'.$i,
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
        ]));
        $campaign = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, $assets->all()))->assertCreated();
        $id = (string) $campaign->json('data.id');

        $selected = $assets->take(2)->pluck('id')->all();
        $this->postJson("/api/v1/maintenance-campaigns/{$id}/executions", [
            'scheduledFor' => now()->addDays(2)->toDateString(),
            'technicianName' => 'Teknisi Subset',
            'assetIds' => $selected,
        ], ['If-Match' => '"1"'])
            ->assertCreated()
            ->assertJsonPath('meta.executionCount', 2);

        $this->assertEqualsCanonicalizing(
            $selected,
            MaintenanceExecution::query()->pluck('asset_id')->all(),
        );

        $outsider = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
        ]);
        $this->postJson("/api/v1/maintenance-campaigns/{$id}/executions", [
            'scheduledFor' => now()->addDays(5)->toDateString(),
            'technicianName' => 'Teknisi Subset',
            'assetIds' => [$outsider->id],
        ], ['If-Match' => '"2"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertDatabaseCount('maintenance_executions', 2);
    }

    public function test_batch_schedule_rolls_back_new_children_when_one_plan_date_conflicts(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.create-plan', 'maintenance.schedule', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $assets = collect([
            Asset::factory()->for($school)->create(['asset_code' => 'ROLL-001', 'home_laboratory_id' => $lab->id, 'condition' => 'good']),
            Asset::factory()->for($school)->create(['asset_code' => 'ROLL-002', 'home_laboratory_id' => $lab->id, 'condition' => 'good']),
        ]);

        $campaign = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, $assets->all()))->assertCreated();
        $id = (string) $campaign->json('data.id');
        $items = MaintenanceCampaignItem::query()->where('maintenance_campaign_id', $id)->orderBy('asset_id')->get();
        $date = now()->addWeek()->toDateString();

        $this->postJson('/api/v1/maintenance-plans/'.$items->last()->maintenance_plan_id.'/executions', [
            'scheduledFor' => $date,
            'technicianName' => 'Teknisi Existing',
        ], ['If-Match' => '"1"'])->assertCreated();

        $this->assertDatabaseCount('maintenance_executions', 1);

        $this->postJson("/api/v1/maintenance-campaigns/{$id}/executions", [
            'scheduledFor' => $date,
            'technicianName' => 'Teknisi Batch',
        ], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertDatabaseCount('maintenance_executions', 1);
        $this->assertSame(1, MaintenanceCampaign::query()->findOrFail($id)->version);
        $this->assertSame(0, MaintenanceCampaignEvent::query()
            ->where('maintenance_campaign_id', $id)
            ->where('event_type', 'maintenance_campaign.batch_scheduled')
            ->count());
    }

    public function test_campaign_activation_is_versioned_and_only_gates_orchestration_not_child_plan_authority(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.create-plan', 'maintenance.update-plan', 'maintenance.schedule',
            'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
        ]);

        $campaign = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$asset]))->assertCreated();
        $id = (string) $campaign->json('data.id');
        $planId = (string) $campaign->json('data.items.0.maintenancePlanId');

        $this->postJson("/api/v1/maintenance-campaigns/{$id}/deactivate", [], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'inactive');

        $this->postJson("/api/v1/maintenance-campaigns/{$id}/executions", [
            'scheduledFor' => now()->addDay()->toDateString(),
            'technicianName' => 'Teknisi Campaign',
        ], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'MAINTENANCE_STATE_CONFLICT');

        $this->postJson("/api/v1/maintenance-plans/{$planId}/executions", [
            'scheduledFor' => now()->addDay()->toDateString(),
            'technicianName' => 'Teknisi Individual',
        ], ['If-Match' => '"1"'])->assertCreated();

        $this->postJson("/api/v1/maintenance-campaigns/{$id}/activate", [], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'active');
    }

    public function test_campaign_and_item_evidence_are_database_immutable_and_cross_school_show_is_hidden(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'maintenance.view', 'maintenance.create-plan', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'condition' => 'good',
        ]);
        $response = $this->postJson('/api/v1/maintenance-campaigns', $this->payload($lab, [$asset]))->assertCreated();
        $id = (string) $response->json('data.id');

        $campaign = MaintenanceCampaign::query()->findOrFail($id);
        try {
            $campaign->update(['name' => 'Tampered Campaign']);
            $this->fail('Expected immutable Campaign configuration guard.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $item = MaintenanceCampaignItem::query()->where('maintenance_campaign_id', $id)->sole();
        try {
            $item->update(['asset_name_snapshot' => 'Tampered Asset']);
            $this->fail('Expected immutable Campaign item guard.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $event = MaintenanceCampaignEvent::query()->where('maintenance_campaign_id', $id)->sole();
        try {
            $event->update(['event_type' => 'maintenance_campaign.tampered']);
            $this->fail('Expected immutable Campaign event guard.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $otherSchool = School::factory()->create();
        $this->authenticateWithPermissions(['maintenance.view'], $otherSchool);
        $this->getJson("/api/v1/maintenance-campaigns/{$id}")
            ->assertNotFound()
            ->assertJsonPath('code', 'MAINTENANCE_CAMPAIGN_NOT_FOUND');
    }

    public function test_campaign_routes_use_server_permissions_and_version_preconditions(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/maintenance-campaigns'))
            ->values();

        $this->assertCount(7, $routes);
        $map = $routes->mapWithKeys(fn ($route): array => [
            implode(',', $route->methods()).' '.$route->uri() => $route->gatherMiddleware(),
        ]);

        $this->assertContains(
            'permission:maintenance.view',
            $map->get('GET,HEAD api/v1/maintenance-campaigns'),
        );
        $this->assertContains(
            'permission:maintenance.view',
            $map->get('GET,HEAD api/v1/maintenance-campaigns/{campaignId}'),
        );
        $this->assertContains(
            'permission:maintenance.view',
            $map->get('GET,HEAD api/v1/maintenance-campaigns/{campaignId}/history'),
        );

        $createMiddleware = $map->get('POST api/v1/maintenance-campaigns');
        $this->assertContains('permission:maintenance.create-plan', $createMiddleware);
        $this->assertContains('permission:assets.view', $createMiddleware);
        $this->assertContains('permission:laboratories.view', $createMiddleware);

        foreach (['activate', 'deactivate'] as $action) {
            $middleware = $map->get("POST api/v1/maintenance-campaigns/{campaignId}/{$action}");
            $this->assertContains('permission:maintenance.update-plan', $middleware);
            $this->assertContains(RequireMaintenanceCampaignVersionPrecondition::class, $middleware);
        }

        $scheduleMiddleware = $map->get('POST api/v1/maintenance-campaigns/{campaignId}/executions');
        $this->assertContains('permission:maintenance.schedule', $scheduleMiddleware);
        $this->assertContains(RequireMaintenanceCampaignVersionPrecondition::class, $scheduleMiddleware);
    }

    /** @param list<string> $permissions @return array{User,School,SchoolMembership} */
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
            $permissionIds = collect($permissions)->unique()->values()->map(fn (string $key): string => Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key],
            )->id);
            $membership->roles()->attach($role->id);
            $role->permissions()->attach($permissionIds);
        }

        Sanctum::actingAs($user);

        return [$user, $school, $membership];
    }

    /**
     * @param list<Asset> $assets
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function payload(Laboratory $lab, array $assets, array $overrides = []): array
    {
        return [
            'laboratoryId' => $lab->id,
            'name' => 'Pemeliharaan Bulanan '.$lab->code,
            'description' => 'Batch preventive maintenance UAT',
            'frequencyKind' => 'monthly',
            'checklistTemplate' => ['Bersihkan debu', 'Cek koneksi'],
            'assignedTechnicianName' => 'Andi Teknisi',
            'nextDueDate' => now()->addDays(7)->toDateString(),
            'assetIds' => array_map(fn (Asset $asset): string => (string) $asset->id, $assets),
            ...$overrides,
        ];
    }
}
