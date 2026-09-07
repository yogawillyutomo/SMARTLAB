<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Laboratory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use App\Models\WorkOrder;
use App\Models\WorkOrderEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class WorkOrderApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/work-orders')
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/work-orders')
            ->assertStatus(409)
            ->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_create_requires_exact_asset_and_dependency_permissions(): void
    {
        [, $school] = $this->authenticateWithPermissions(['work-orders.create']);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);

        $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertForbidden();

        $this->authenticateWithPermissions([
            'work-orders.create', 'assets.view', 'laboratories.view', 'work-orders.view',
        ], $school);

        $created = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.assetId', $asset->id)
            ->assertJsonPath('data.assetCodeSnapshot', $asset->asset_code)
            ->assertJsonPath('data.laboratoryId', $lab->id)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.version', 1);

        $this->assertMatchesRegularExpression('/^WO-\d{4}-\d{6}$/', (string) $created->json('data.workOrderNumber'));
        $this->assertDatabaseCount('work_orders', 1);
        $this->assertDatabaseHas('work_order_events', [
            'work_order_id' => $created->json('data.id'),
            'event_type' => 'work_order.created',
        ]);

        $this->postJson('/api/v1/work-orders', [
            ...$this->payload($asset, $lab),
            'assetCode' => $asset->asset_code,
        ])->assertUnprocessable()->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_work_orders_are_same_school_scoped(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create();

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $otherSchool = School::factory()->create();
        $this->authenticateWithPermissions(['work-orders.view'], $otherSchool);

        $this->getJson('/api/v1/work-orders')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/work-orders/'.$id)
            ->assertNotFound()
            ->assertJsonPath('code', 'WORK_ORDER_NOT_FOUND');
    }

    public function test_lifecycle_keeps_corrective_custody_until_future_verification(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'work-orders.approve',
            'assets.view', 'assets.retire', 'laboratories.view',
        ]);

        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create([
            'condition' => 'moderate_damage',
            'lifecycle_status' => 'active',
            'version' => 1,
        ]);

        $created = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'assigned')
            ->assertJsonPath('data.version', 2);

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.conditionBefore', 'moderate_damage')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 3);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'in_repair')
            ->assertJsonPath('data.provenance.workOrderCustodies.0.workOrderId', $id);

        $this->postJson("/api/v1/work-orders/{$id}/hold", [
            'reason' => 'Perlu pemeriksaan lanjutan',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'on_hold')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 4);

        $this->postJson("/api/v1/work-orders/{$id}/resume", [], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 5);

        $this->postJson("/api/v1/work-orders/{$id}/waiting-part", [
            'reason' => 'Menunggu komponen pengganti',
        ], ['If-Match' => '"5"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'waiting_part')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 6);

        $this->postJson("/api/v1/work-orders/{$id}/resume", [], ['If-Match' => '"6"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.version', 7);

        $completed = $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan komponen utama',
            'actionTaken' => 'Komponen diperiksa dan dikalibrasi',
            'conditionAfter' => 'good',
            'testResult' => 'Pengujian fungsi lulus',
        ], ['If-Match' => '"7"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.conditionAfter', 'good')
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 8);

        $this->assertNotNull($completed->json('data.completedAt'));

        $asset->refresh();
        $this->assertSame('moderate_damage', $asset->condition);
        $this->assertSame(1, $asset->version);

        $this->postJson('/api/v1/assets/'.$asset->id.'/retire', [
            'reason' => 'Tidak boleh saat corrective custody aktif',
        ], ['If-Match' => '"1"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'ASSET_ACTIVE_CUSTODY_CONFLICT');

        $this->postJson("/api/v1/work-orders/{$id}/rework", [
            'reason' => 'Uji akhir belum memuaskan',
        ], ['If-Match' => '"8"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'in_progress')
            ->assertJsonPath('data.conditionAfter', null)
            ->assertJsonPath('data.completedAt', null)
            ->assertJsonPath('data.custodyActive', true)
            ->assertJsonPath('data.version', 9);

        $this->postJson("/api/v1/work-orders/{$id}/complete", [
            'diagnosis' => 'Kerusakan komponen utama',
            'actionTaken' => 'Kalibrasi ulang selesai',
            'conditionAfter' => 'good',
        ], ['If-Match' => '"9"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.version', 10);

        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'Tidak boleh membatalkan completed',
        ], ['If-Match' => '"10"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_INVALID_TRANSITION');

        $this->getJson("/api/v1/work-orders/{$id}/history")
            ->assertOk()
            ->assertJsonCount(10, 'data');
    }

    public function test_second_work_order_cannot_take_the_same_active_corrective_custody(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update', 'work-orders.assign',
            'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create(['condition' => 'major_damage']);

        $first = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))->assertCreated();
        $second = $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab, [
            'problemSummary' => 'Perbaikan kedua untuk race guard',
        ]))->assertCreated();

        foreach ([$first, $second] as $response) {
            $this->postJson('/api/v1/work-orders/'.$response->json('data.id').'/assign', [
                'assigneeMembershipId' => $membership->id,
            ], ['If-Match' => '"1"'])->assertOk();
        }

        $this->postJson('/api/v1/work-orders/'.$first->json('data.id').'/start', [], ['If-Match' => '"2"'])
            ->assertOk();

        $this->postJson('/api/v1/work-orders/'.$second->json('data.id').'/start', [], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'WORK_ORDER_ACTIVE_CUSTODY_CONFLICT');

        $this->assertSame(1, WorkOrder::query()->where('asset_id', $asset->id)->where('custody_active', true)->count());
    }

    public function test_version_precondition_and_cancel_release_custody_fail_closed(): void
    {
        [, $school, $membership] = $this->authenticateWithPermissions([
            'work-orders.create', 'work-orders.view', 'work-orders.update',
            'work-orders.assign', 'assets.view', 'laboratories.view',
        ]);
        $lab = Laboratory::factory()->for($school)->create();
        $asset = Asset::factory()->for($school)->create();

        $id = (string) $this->postJson('/api/v1/work-orders', $this->payload($asset, $lab))
            ->assertCreated()
            ->json('data.id');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ])->assertStatus(428)->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'WORK_ORDER_VERSION_CONFLICT');

        $this->postJson("/api/v1/work-orders/{$id}/assign", [
            'assigneeMembershipId' => $membership->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/start", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson("/api/v1/work-orders/{$id}/cancel", [
            'reason' => 'Perbaikan dihentikan secara administratif',
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.custodyActive', false)
            ->assertJsonPath('data.version', 4);

        $this->getJson('/api/v1/assets/'.$asset->id.'/operational-state')
            ->assertOk()
            ->assertJsonPath('data.state', 'blocked_condition');
    }

    /** @param list<string> $permissions @return array{User,School,SchoolMembership} */
    private function authenticateWithPermissions(array $permissions, ?School $school = null): array
    {
        $school ??= School::factory()->create();
        $user = User::factory()->create();
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

    private function payload(Asset $asset, Laboratory $lab, array $overrides = []): array
    {
        return array_merge([
            'assetId' => $asset->id,
            'laboratoryId' => $lab->id,
            'problemSummary' => 'Perbaikan corrective Asset',
            'priority' => 'high',
            'scheduledFor' => now()->addDay()->toDateString(),
            'notes' => 'S5.2 API test',
        ], $overrides);
    }
}
