<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\Device;
use App\Models\Loan;
use App\Models\LoanEvent;
use App\Models\LoanItem;
use App\Models\Permission;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LoanApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_missing_membership_are_rejected(): void
    {
        $this->getJson('/api/v1/loans')->assertUnauthorized()->assertJsonPath('code', 'UNAUTHENTICATED');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/loans')->assertStatus(409)->assertJsonPath('code', 'ACTIVE_MEMBERSHIP_REQUIRED');
    }

    public function test_create_uses_exact_assets_and_never_accepts_quantity_or_free_text_item_identity(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create']);
        $assetA = $this->loanableAsset($school, ['asset_code' => 'AST-LOAN-A']);
        $assetB = $this->loanableAsset($school, ['asset_code' => 'AST-LOAN-B']);

        $response = $this->postJson('/api/v1/loans', $this->validPayload([$assetB->id, $assetA->id]))
            ->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.schoolId', $school->id)
            ->assertJsonPath('data.status', 'submitted')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.items.0.assetCodeSnapshot', 'AST-LOAN-A')
            ->assertJsonPath('data.items.1.assetCodeSnapshot', 'AST-LOAN-B')
            ->assertJsonPath('data.items.0.conditionOut', null)
            ->assertJsonPath('data.items.0.custodyActive', false);

        $this->assertDatabaseCount('loans', 1);
        $this->assertDatabaseCount('loan_items', 2);
        $this->assertDatabaseCount('loan_events', 1);
        $this->assertDatabaseHas('loan_events', ['loan_id' => $response->json('data.id'), 'event_type' => 'loan.submitted']);

        $this->postJson('/api/v1/loans', $this->validPayload([$assetA->id], [
            'quantity' => 2,
            'itemName' => 'Laptop bebas',
        ]))
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
    }

    public function test_create_rejects_duplicate_cross_school_and_ineligible_assets(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create']);
        $asset = $this->loanableAsset($school);
        $crossSchool = $this->loanableAsset(School::factory()->create());

        $this->postJson('/api/v1/loans', $this->validPayload([$asset->id, $asset->id]))
            ->assertUnprocessable();

        $this->postJson('/api/v1/loans', $this->validPayload([$crossSchool->id]))
            ->assertUnprocessable();

        $moderate = $this->loanableAsset($school, ['condition' => 'moderate_damage']);
        $this->postJson('/api/v1/loans', $this->validPayload([$moderate->id]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'LOAN_ASSET_INELIGIBLE');

        $retired = $this->loanableAsset($school, ['lifecycle_status' => 'retired']);
        $this->postJson('/api/v1/loans', $this->validPayload([$retired->id]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'LOAN_ASSET_INELIGIBLE');
    }

    public function test_linked_device_lifecycle_is_revalidated_fail_closed(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create']);
        $device = Device::factory()->for($school)->create(['lifecycle_status' => 'decommissioned']);
        $asset = $this->loanableAsset($school, ['linked_device_id' => $device->id]);

        $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))
            ->assertStatus(409)
            ->assertJsonPath('code', 'LOAN_DEVICE_INELIGIBLE');
    }

    public function test_view_is_requester_scoped_without_view_all(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.view']);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $loanId = (string) $created->json('data.id');

        $this->getJson('/api/v1/loans')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/loans/'.$loanId)->assertOk();

        $this->authenticateWithPermissions(['loans.view'], $school);
        $this->getJson('/api/v1/loans')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/loans/'.$loanId)->assertNotFound()->assertJsonPath('code', 'LOAN_NOT_FOUND');

        $this->authenticateWithPermissions(['loans.view', 'loans.view-all'], $school);
        $this->getJson('/api/v1/loans')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/loans/'.$loanId)->assertOk();
    }

    public function test_lifecycle_permissions_preconditions_and_versions_fail_closed(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create']);
        $asset = $this->loanableAsset($school);
        $loan = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();

        $this->postJson('/api/v1/loans/'.$loan->json('data.id').'/approve', [], ['If-Match' => '"1"'])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->authenticateWithPermissions(['loans.approve'], $school);

        $this->postJson('/api/v1/loans/'.$loan->json('data.id').'/approve')
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->postJson('/api/v1/loans/'.$loan->json('data.id').'/approve', [], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'LOAN_VERSION_CONFLICT');

        $this->postJson('/api/v1/loans/'.$loan->json('data.id').'/approve', [], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.version', 2);
    }

    public function test_happy_path_checkout_return_close_preserves_asset_and_device_authority(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'loans.create', 'loans.view', 'loans.view-all', 'loans.approve',
            'loans.checkout', 'loans.return', 'loans.close',
        ]);
        $device = Device::factory()->for($school)->create([
            'lifecycle_status' => 'in_service',
            'home_laboratory_id' => null,
            'version' => 7,
        ]);
        $asset = $this->loanableAsset($school, [
            'linked_device_id' => $device->id,
            'condition' => 'minor_damage',
            'version' => 4,
        ]);

        $create = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $loanId = (string) $create->json('data.id');

        $this->postJson("/api/v1/loans/{$loanId}/approve", [], ['If-Match' => '"1"'])
            ->assertOk()->assertJsonPath('data.status', 'approved');

        $checkout = $this->postJson("/api/v1/loans/{$loanId}/checkout", [], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'checked_out')
            ->assertJsonPath('data.items.0.assetId', $asset->id)
            ->assertJsonPath('data.items.0.conditionOut', 'minor_damage')
            ->assertJsonPath('data.items.0.custodyActive', true);

        $loanItemId = (string) $checkout->json('data.items.0.id');

        $this->postJson("/api/v1/loans/{$loanId}/return", [
            'items' => [[
                'loanItemId' => $loanItemId,
                'conditionReturn' => 'moderate_damage',
                'returnNotes' => 'Retak casing ditemukan saat pengembalian.',
            ]],
        ], ['If-Match' => '"3"'])
            ->assertOk()
            ->assertHeader('ETag', '"4"')
            ->assertJsonPath('data.status', 'returned')
            ->assertJsonPath('data.items.0.conditionReturn', 'moderate_damage')
            ->assertJsonPath('data.items.0.custodyActive', false);

        $this->postJson("/api/v1/loans/{$loanId}/close", [], ['If-Match' => '"4"'])
            ->assertOk()
            ->assertHeader('ETag', '"5"')
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.version', 5);

        $asset->refresh();
        $device->refresh();
        $this->assertSame('minor_damage', $asset->condition);
        $this->assertSame('active', $asset->lifecycle_status);
        $this->assertSame(4, $asset->version);
        $this->assertSame('in_service', $device->lifecycle_status);
        $this->assertSame(7, $device->version);
        $this->assertDatabaseCount('incidents', 0);
        $this->assertDatabaseCount('loan_events', 5);
    }

    public function test_two_approved_loans_cannot_checkout_the_same_asset(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.approve', 'loans.checkout']);
        $asset = $this->loanableAsset($school);

        $first = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id], ['borrowerName' => 'Borrower A']))->assertCreated();
        $second = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id], ['borrowerName' => 'Borrower B']))->assertCreated();

        foreach ([$first, $second] as $response) {
            $this->postJson('/api/v1/loans/'.$response->json('data.id').'/approve', [], ['If-Match' => '"1"'])->assertOk();
        }

        $this->postJson('/api/v1/loans/'.$first->json('data.id').'/checkout', [], ['If-Match' => '"2"'])
            ->assertOk();

        $this->postJson('/api/v1/loans/'.$second->json('data.id').'/checkout', [], ['If-Match' => '"2"'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'LOAN_ASSET_UNAVAILABLE');

        $this->assertDatabaseCount('loan_items', 2);
        $this->assertSame(1, LoanItem::query()->where('custody_active', true)->count());
        $this->assertSame('approved', Loan::query()->findOrFail($second->json('data.id'))->status);
    }

    public function test_database_partial_unique_guard_blocks_second_active_custody_even_if_service_is_bypassed(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.approve', 'loans.checkout']);
        $asset = $this->loanableAsset($school);

        $first = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id], ['borrowerName' => 'AA']))->assertCreated();
        $second = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id], ['borrowerName' => 'BB']))->assertCreated();

        foreach ([$first, $second] as $response) {
            $this->postJson('/api/v1/loans/'.$response->json('data.id').'/approve', [], ['If-Match' => '"1"'])->assertOk();
        }
        $this->postJson('/api/v1/loans/'.$first->json('data.id').'/checkout', [], ['If-Match' => '"2"'])->assertOk();

        $secondItem = LoanItem::query()->where('loan_id', $second->json('data.id'))->sole();

        $this->expectException(QueryException::class);
        $secondItem->update(['condition_out' => 'good', 'custody_active' => true]);
    }

    public function test_captured_loan_item_identity_and_evidence_are_database_protected(): void
    {
        [, $school] = $this->authenticateWithPermissions([
            'loans.create', 'loans.approve', 'loans.checkout', 'loans.return',
        ]);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->postJson("/api/v1/loans/{$id}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $checked = $this->postJson("/api/v1/loans/{$id}/checkout", [], ['If-Match' => '"2"'])->assertOk();
        $itemId = (string) $checked->json('data.items.0.id');

        $item = LoanItem::query()->findOrFail($itemId);
        try {
            $item->update(['asset_code_snapshot' => 'TAMPERED']);
            $this->fail('Expected captured LoanItem identity to be immutable.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->postJson("/api/v1/loans/{$id}/return", [
            'items' => [[
                'loanItemId' => $itemId,
                'conditionReturn' => 'minor_damage',
                'returnNotes' => 'Evidence final.',
            ]],
        ], ['If-Match' => '"3"'])->assertOk();

        $item->refresh();
        try {
            $item->update(['condition_return' => 'good']);
            $this->fail('Expected captured return evidence to be immutable.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $this->expectException(QueryException::class);
        $item->delete();
    }

    public function test_return_evidence_must_cover_every_item_exactly_once(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.approve', 'loans.checkout', 'loans.return']);
        $a = $this->loanableAsset($school, ['asset_code' => 'AST-A']);
        $b = $this->loanableAsset($school, ['asset_code' => 'AST-B']);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$a->id, $b->id]))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->postJson("/api/v1/loans/{$id}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $checked = $this->postJson("/api/v1/loans/{$id}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        $this->postJson("/api/v1/loans/{$id}/return", [
            'items' => [[
                'loanItemId' => $checked->json('data.items.0.id'),
                'conditionReturn' => 'good',
            ]],
        ], ['If-Match' => '"3"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');

        $this->assertSame('checked_out', Loan::query()->findOrFail($id)->status);
        $this->assertSame(2, LoanItem::query()->where('loan_id', $id)->where('custody_active', true)->count());
    }

    public function test_overdue_is_derived_and_never_persisted_as_a_status(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.approve', 'loans.checkout', 'loans.view', 'loans.view-all']);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->postJson("/api/v1/loans/{$id}/approve", [], ['If-Match' => '"1"'])->assertOk();
        $this->postJson("/api/v1/loans/{$id}/checkout", [], ['If-Match' => '"2"'])->assertOk();

        Loan::query()->whereKey($id)->update(['requested_return_at' => now()->subHour()]);

        $this->getJson("/api/v1/loans/{$id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'checked_out')
            ->assertJsonPath('data.isOverdue', true);

        $this->assertSame('checked_out', Loan::query()->findOrFail($id)->status);
    }

    public function test_cancel_is_owner_scoped_without_view_all(): void
    {
        [, $school] = $this->authenticateWithPermissions(['loans.create', 'loans.cancel']);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $id = (string) $created->json('data.id');

        $this->authenticateWithPermissions(['loans.cancel'], $school);
        $this->postJson("/api/v1/loans/{$id}/cancel", ['reason' => 'Batal pihak lain'], ['If-Match' => '"1"'])
            ->assertNotFound()
            ->assertJsonPath('code', 'LOAN_NOT_FOUND');

        $this->authenticateWithPermissions(['loans.cancel', 'loans.view-all'], $school);
        $this->postJson("/api/v1/loans/{$id}/cancel", ['reason' => 'Dibatalkan admin'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled');
    }

    public function test_loan_events_are_append_only_but_actor_fk_cleanup_preserves_snapshots(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions(['loans.create']);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();
        $event = LoanEvent::query()->where('loan_id', $created->json('data.id'))->sole();

        try {
            $event->update(['payload' => ['tampered' => true]]);
            $this->fail('Expected LoanEvent update to be rejected.');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }

        $userId = $user->id;
        $membershipId = $membership->id;
        $membership->delete();
        $user->delete();

        $event->refresh();
        $this->assertNull($event->actor_user_id);
        $this->assertNull($event->actor_membership_id);
        $this->assertSame($userId, $event->actor_user_id_snapshot);
        $this->assertSame($membershipId, $event->actor_membership_id_snapshot);

        $this->expectException(QueryException::class);
        $event->delete();
    }

    public function test_loan_routes_have_exact_permissions_and_no_hard_delete(): void
    {
        $routes = collect(Route::getRoutes()->getRoutes())
            ->filter(fn ($route): bool => str_starts_with($route->uri(), 'api/v1/loans'))
            ->values();

        $this->assertCount(9, $routes);

        $map = $routes->mapWithKeys(fn ($route): array => [
            implode(',', $route->methods()).' '.$route->uri() => $route->gatherMiddleware(),
        ]);

        $this->assertContains('permission:loans.view', $map->first(fn ($middleware, $key) => str_contains($key, 'GET,HEAD api/v1/loans')));
        $this->assertContains('permission:loans.create', $map->first(fn ($middleware, $key) => str_contains($key, 'POST api/v1/loans') && ! str_contains($key, '{loanId}')));
        $this->assertContains('permission:loans.approve', $map->first(fn ($middleware, $key) => str_contains($key, '/approve')));
        $this->assertContains('permission:loans.checkout', $map->first(fn ($middleware, $key) => str_contains($key, '/checkout')));
        $this->assertContains('permission:loans.return', $map->first(fn ($middleware, $key) => str_contains($key, '/return')));
        $this->assertContains('permission:loans.close', $map->first(fn ($middleware, $key) => str_contains($key, '/close')));
        $this->assertContains('permission:loans.cancel', $map->first(fn ($middleware, $key) => str_contains($key, '/cancel')));

        [, $school] = $this->authenticateWithPermissions(['loans.create']);
        $asset = $this->loanableAsset($school);
        $created = $this->postJson('/api/v1/loans', $this->validPayload([$asset->id]))->assertCreated();

        $this->deleteJson('/api/v1/loans/'.$created->json('data.id'))->assertStatus(405);
        $this->assertDatabaseHas('loans', ['id' => $created->json('data.id')]);
    }

    /** @param list<string> $permissions @return array{User, School, SchoolMembership} */
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

    /** @param array<string, mixed> $overrides */
    private function loanableAsset(School $school, array $overrides = []): Asset
    {
        return Asset::factory()->for($school)->create([
            'condition' => 'good',
            'lifecycle_status' => 'active',
            ...$overrides,
        ]);
    }

    /**
     * @param list<string> $assetIds
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function validPayload(array $assetIds, array $overrides = []): array
    {
        return [
            'borrowerName' => 'Budi Santoso',
            'borrowerUnit' => 'XI PPLG 1',
            'purpose' => 'Kegiatan praktikum terjadwal',
            'requestedReturnAt' => now()->addDay()->toISOString(),
            'assetIds' => $assetIds,
            ...$overrides,
        ];
    }
}
