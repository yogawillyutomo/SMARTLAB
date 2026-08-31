<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCorrectionService;
use App\Application\Incident\IncidentCreationService;
use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentEventType;
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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class IncidentCorrectionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_is_rejected_before_precondition_and_body_validation(): void
    {
        $this->patchJson('/api/v1/incidents/'.strtolower((string) Str::ulid()), ['status' => 'closed'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');
    }

    #[DataProvider('missingPermissionProvider')]
    public function test_each_required_permission_failure_precedes_malformed_precondition(array $permissions): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($permissions);
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );

        $this->patchJson(
            '/api/v1/incidents/'.$incident->id,
            ['status' => 'closed'],
            ['If-Match' => 'W/"1"'],
        )->assertForbidden()->assertJsonPath('code', 'FORBIDDEN');
    }

    public static function missingPermissionProvider(): array
    {
        return [
            'view' => [['incidents.update', 'incidents.assign']],
            'update' => [['incidents.view', 'incidents.assign']],
            'assign' => [['incidents.view', 'incidents.update']],
        ];
    }

    #[DataProvider('invalidIfMatchProvider')]
    public function test_missing_and_malformed_preconditions_are_rejected(mixed $header): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        $headers = $header === null ? [] : ['If-Match' => $header];

        $this->patchJson('/api/v1/incidents/'.$incident->id, ['title' => 'Judul koreksi valid'], $headers)
            ->assertStatus(428)
            ->assertExactJson([
                'message' => 'A valid If-Match Incident version is required.',
                'code' => 'PRECONDITION_REQUIRED',
            ]);
    }

    public static function invalidIfMatchProvider(): array
    {
        return [
            'missing' => [null],
            'weak' => ['W/"1"'],
            'wildcard' => ['*'],
            'unquoted' => ['1'],
            'zero' => ['"0"'],
            'negative' => ['"-1"'],
            'list' => ['"1", "2"'],
            'whitespace' => [' "1" '],
            'overflow' => ['"999999999999999999999999999999999999"'],
        ];
    }

    public function test_valid_precondition_with_invalid_body_is_422_before_visibility(): void
    {
        $this->authenticateWithPermissions($this->permissions());
        $unknown = strtolower((string) Str::ulid());

        $this->patchJson('/api/v1/incidents/'.$unknown, [], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
        $this->patchJson('/api/v1/incidents/'.$unknown.'?force=true', ['status' => 'reported'], ['If-Match' => '"1"'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'VALIDATION_FAILED');
        foreach ([
            ['submissionId' => strtolower((string) Str::uuid())],
            ['schoolId' => strtolower((string) Str::ulid())],
            ['reporter' => ['userId' => strtolower((string) Str::ulid())]],
            ['status' => 'reported'],
            ['version' => 1],
            ['reportedAt' => now()->toISOString()],
            ['updatedAt' => now()->toISOString()],
        ] as $forged) {
            $this->patchJson('/api/v1/incidents/'.$unknown, $forged, ['If-Match' => '"1"'])
                ->assertUnprocessable()
                ->assertJsonPath('code', 'VALIDATION_FAILED');
        }
    }

    public function test_visibility_matches_b1_and_view_all_expands_only_same_school_rows(): void
    {
        [, $school] = $this->authenticateWithPermissions($this->permissions());
        $hidden = $this->createIncidentFor(
            $this->reporter($school),
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        $otherSchool = School::factory()->create();
        $crossSchool = $this->createIncidentFor(
            $this->reporter($otherSchool),
            Laboratory::factory()->for($otherSchool)->create(['status' => 'active']),
        );

        foreach ([$hidden->id, $crossSchool->id, strtolower((string) Str::ulid())] as $id) {
            $this->patchJson('/api/v1/incidents/'.$id, ['title' => 'Judul koreksi valid'], ['If-Match' => '"1"'])
                ->assertNotFound()
                ->assertExactJson(['message' => 'Incident not found.', 'code' => 'INCIDENT_NOT_FOUND']);
        }

        $viewer = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $viewer->id,
            'status' => 'active',
        ]);
        $this->grantPermissions($membership, [...$this->permissions(), 'incidents.view-all']);
        Sanctum::actingAs($viewer);

        $this->patchJson('/api/v1/incidents/'.$hidden->id, ['title' => 'Judul koreksi valid'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.version', 2);
    }

    public function test_meaningful_partial_correction_updates_once_and_records_exact_canonical_event(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        DB::table('incidents')->where('id', $incident->id)->update(['updated_at' => now()->subHour()]);

        $response = $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'title' => '  Printer tidak merespons  ',
            'priority' => ' HIGH ',
            'impact' => '  Praktikum tertunda  ',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.title', 'Printer tidak merespons')
            ->assertJsonPath('data.priority', 'high')
            ->assertJsonPath('data.impact', 'Praktikum tertunda');

        $this->assertIncidentDtoKeys($response->json('data'));
        $incident->refresh();
        $this->assertSame(2, $incident->version);
        $this->assertSame('Desktop berhenti sebelum sistem operasi dimuat.', $incident->description);
        $this->assertDatabaseCount('incident_events', 2);

        $event = IncidentEvent::query()->where('event_type', IncidentEventType::Updated->value)->sole();
        $this->assertSame(1, $event->incident_version_before);
        $this->assertSame(2, $event->incident_version_after);
        $this->assertSame($user->id, $event->actor_user_id_snapshot);
        $this->assertSame($membership->id, $event->actor_membership_id_snapshot);
        $this->assertSame(['impact', 'priority', 'title'], $event->payload['changedFields']);
        $this->assertSame([
            'impact' => null,
            'priority' => 'normal',
            'title' => 'Desktop gagal menyala',
        ], $event->payload['before']);
        $this->assertSame([
            'impact' => 'Praktikum tertunda',
            'priority' => 'high',
            'title' => 'Printer tidak merespons',
        ], $event->payload['after']);
    }

    public function test_canonical_no_op_preserves_version_timestamp_events_and_historical_snapshots(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $laboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-LAMA',
            'name' => 'Laboratorium Lama',
        ]);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
            'device_code' => 'PC-LAMA',
            'device_type' => 'desktop_pc',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $laboratory, $device)->fresh();
        $updatedAt = $incident->updated_at?->toISOString();
        $occurredOffset = $incident->occurred_at?->setTimezone('+07:00')->format('Y-m-d\TH:i:s.uP');
        $laboratory->update(['code' => 'LAB-BARU', 'name' => 'Laboratorium Baru']);
        $device->update(['device_code' => 'PC-BARU', 'device_type' => 'laptop']);

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'laboratoryId' => strtoupper($laboratory->id),
            'deviceId' => strtoupper($device->id),
            'category' => ' HARDWARE ',
            'title' => ' Desktop gagal menyala ',
            'impact' => '   ',
            'occurredAt' => $occurredOffset,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.laboratory.code', 'LAB-LAMA')
            ->assertJsonPath('data.device.deviceCode', 'PC-LAMA');

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertSame($updatedAt, $incident->updated_at?->toISOString());
        $this->assertSame('LAB-LAMA', $incident->laboratory_code_snapshot);
        $this->assertSame('PC-LAMA', $incident->device_code_snapshot);
        $this->assertDatabaseCount('incident_events', 1);

        $this->patchJson('/api/v1/incidents/'.$incident->id, ['title' => ' Desktop gagal menyala '], ['If-Match' => '"2"'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'INCIDENT_VERSION_CONFLICT');
    }

    public function test_non_subject_correction_does_not_revalidate_or_lock_historical_subjects(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $laboratory, $device);
        $laboratory->update(['status' => 'inactive']);
        $device->update(['lifecycle_status' => 'decommissioned']);
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->patchJson('/api/v1/incidents/'.$incident->id, ['title' => 'Perangkat gagal menyala'], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.version', 2);

        $queries = collect(DB::getQueryLog())->pluck('query');
        $this->assertFalse($queries->contains(fn (string $sql): bool => str_contains($sql, 'from "laboratories"')));
        $this->assertFalse($queries->contains(fn (string $sql): bool => str_contains($sql, 'from "devices"')));
    }

    public function test_same_snapshot_subject_ids_remain_non_subject_when_live_foreign_keys_are_null(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $laboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-HISTORIS',
            'name' => 'Laboratorium Historis',
        ]);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
            'device_code' => 'PC-HISTORIS',
            'device_type' => 'desktop_pc',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $laboratory, $device);
        DB::table('incidents')->where('id', $incident->id)->update([
            'laboratory_id' => null,
            'device_id' => null,
        ]);
        $laboratory->update(['status' => 'inactive']);
        $device->update(['lifecycle_status' => 'decommissioned']);
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'laboratoryId' => $laboratory->id,
            'deviceId' => $device->id,
            'title' => 'Perangkat historis gagal menyala',
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.laboratory.id', $laboratory->id)
            ->assertJsonPath('data.device.id', $device->id);

        $incident->refresh();
        $this->assertNull($incident->laboratory_id);
        $this->assertNull($incident->device_id);
        $this->assertSame($laboratory->id, $incident->laboratory_id_snapshot);
        $this->assertSame('LAB-HISTORIS', $incident->laboratory_code_snapshot);
        $this->assertSame($device->id, $incident->device_id_snapshot);
        $this->assertSame('PC-HISTORIS', $incident->device_code_snapshot);
        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Updated->value)
            ->sole();
        $this->assertSame(['title'], $event->payload['changedFields']);
        $this->assertSame(['title' => 'Desktop gagal menyala'], $event->payload['before']);
        $this->assertSame(['title' => 'Perangkat historis gagal menyala'], $event->payload['after']);

        $queries = collect(DB::getQueryLog())->pluck('query');
        $this->assertFalse($queries->contains(fn (string $sql): bool => str_contains($sql, 'from "laboratories"')));
        $this->assertFalse($queries->contains(fn (string $sql): bool => str_contains($sql, 'from "devices"')));
    }

    public function test_non_subject_device_pre_read_that_becomes_subject_after_lock_fails_closed_as_version_conflict(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $originalDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $concurrentDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
            'device_code' => 'PC-CONCURRENT',
            'device_type' => 'laptop',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $laboratory, $originalDevice);
        $membership->setRelation('user', $user);
        $injectConcurrentCorrection = true;

        Event::listen('eloquent.retrieved: '.Incident::class, function (Incident $retrieved) use (
            &$injectConcurrentCorrection,
            $incident,
            $concurrentDevice,
        ): void {
            if (! $injectConcurrentCorrection || $retrieved->id !== $incident->id) {
                return;
            }

            $injectConcurrentCorrection = false;
            DB::table('incidents')->where('id', $incident->id)->update([
                'device_id' => $concurrentDevice->id,
                'device_id_snapshot' => $concurrentDevice->id,
                'device_code_snapshot' => $concurrentDevice->device_code,
                'device_type_snapshot' => $concurrentDevice->device_type,
                'version' => 2,
            ]);
        });

        try {
            app(IncidentCorrectionService::class)->correct(
                new CurrentMembershipContext($membership, collect($this->permissions())),
                $incident->id,
                2,
                [
                    'deviceId' => $originalDevice->id,
                    'title' => 'Perangkat gagal menyala setelah koreksi bersamaan',
                ],
            );
            $this->fail('Expected stale non-subject routing classification to fail closed.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_VERSION_CONFLICT', $exception->errorCode);
        } finally {
            Event::forget('eloquent.retrieved: '.Incident::class);
        }

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertSame($originalDevice->id, $incident->device_id);
        $this->assertSame($originalDevice->id, $incident->device_id_snapshot);
        $this->assertSame('Desktop gagal menyala', $incident->title);
        $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());
    }

    public function test_non_subject_laboratory_pre_read_that_becomes_subject_after_lock_fails_closed_as_version_conflict(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $originalLaboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $concurrentLaboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-CONCURRENT',
            'name' => 'Laboratorium Concurrent',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $originalLaboratory);
        $membership->setRelation('user', $user);
        $injectConcurrentCorrection = true;

        Event::listen('eloquent.retrieved: '.Incident::class, function (Incident $retrieved) use (
            &$injectConcurrentCorrection,
            $incident,
            $concurrentLaboratory,
        ): void {
            if (! $injectConcurrentCorrection || $retrieved->id !== $incident->id) {
                return;
            }

            $injectConcurrentCorrection = false;
            DB::table('incidents')->where('id', $incident->id)->update([
                'laboratory_id' => $concurrentLaboratory->id,
                'laboratory_id_snapshot' => $concurrentLaboratory->id,
                'laboratory_code_snapshot' => $concurrentLaboratory->code,
                'laboratory_name_snapshot' => $concurrentLaboratory->name,
                'version' => 2,
            ]);
        });

        try {
            app(IncidentCorrectionService::class)->correct(
                new CurrentMembershipContext($membership, collect($this->permissions())),
                $incident->id,
                2,
                [
                    'laboratoryId' => $originalLaboratory->id,
                    'title' => 'Laboratorium gagal beroperasi setelah koreksi bersamaan',
                ],
            );
            $this->fail('Expected stale Laboratory routing classification to fail closed.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_VERSION_CONFLICT', $exception->errorCode);
        } finally {
            Event::forget('eloquent.retrieved: '.Incident::class);
        }

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertSame($originalLaboratory->id, $incident->laboratory_id);
        $this->assertSame($originalLaboratory->id, $incident->laboratory_id_snapshot);
        $this->assertSame('Desktop gagal menyala', $incident->title);
        $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());
    }

    public function test_laboratory_correction_uses_retained_snapshot_id_as_event_before_value(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $oldLaboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $incident = $this->createIncidentFor([$user, $membership], $oldLaboratory);
        DB::table('incidents')->where('id', $incident->id)->update(['laboratory_id' => null]);
        $oldLaboratory->update(['status' => 'inactive']);
        $newLaboratory = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-KOREKSI',
            'name' => 'Laboratorium Koreksi',
        ]);

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'laboratoryId' => $newLaboratory->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.laboratory.id', $newLaboratory->id)
            ->assertJsonPath('data.laboratory.code', 'LAB-KOREKSI');

        $incident->refresh();
        $this->assertSame($newLaboratory->id, $incident->laboratory_id);
        $this->assertSame($newLaboratory->id, $incident->laboratory_id_snapshot);
        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Updated->value)
            ->sole();
        $this->assertSame(['laboratoryId'], $event->payload['changedFields']);
        $this->assertSame(['laboratoryId' => $oldLaboratory->id], $event->payload['before']);
        $this->assertSame(['laboratoryId' => $newLaboratory->id], $event->payload['after']);
    }

    public function test_device_correction_uses_retained_snapshot_id_as_event_before_value(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $laboratory = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $oldDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'in_service',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $laboratory, $oldDevice);
        DB::table('incidents')->where('id', $incident->id)->update(['device_id' => null]);
        $oldDevice->update(['lifecycle_status' => 'retired']);
        $newDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $laboratory->id,
            'lifecycle_status' => 'spare',
            'device_code' => 'PC-KOREKSI',
            'device_type' => 'laptop',
        ]);

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'deviceId' => $newDevice->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.device.id', $newDevice->id)
            ->assertJsonPath('data.device.deviceCode', 'PC-KOREKSI');

        $incident->refresh();
        $this->assertSame($newDevice->id, $incident->device_id);
        $this->assertSame($newDevice->id, $incident->device_id_snapshot);
        $event = IncidentEvent::query()
            ->where('incident_id_snapshot', $incident->id)
            ->where('event_type', IncidentEventType::Updated->value)
            ->sole();
        $this->assertSame(['deviceId'], $event->payload['changedFields']);
        $this->assertSame(['deviceId' => $oldDevice->id], $event->payload['before']);
        $this->assertSame(['deviceId' => $newDevice->id], $event->payload['after']);
    }

    public function test_subject_corrections_refresh_only_changed_snapshots_and_device_removal_clears_all_device_fields(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $oldLab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $oldDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $oldLab->id,
            'lifecycle_status' => 'in_service',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $oldLab, $oldDevice);
        $newLab = Laboratory::factory()->for($school)->create([
            'status' => 'active',
            'code' => 'LAB-TUJUAN',
            'name' => 'Lab Tujuan',
        ]);
        $newDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $newLab->id,
            'lifecycle_status' => 'spare',
            'device_code' => 'PC-TUJUAN',
            'device_type' => 'laptop',
        ]);

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'laboratoryId' => $newLab->id,
            'deviceId' => $newDevice->id,
        ], ['If-Match' => '"1"'])
            ->assertOk()
            ->assertJsonPath('data.laboratory.code', 'LAB-TUJUAN')
            ->assertJsonPath('data.device.deviceCode', 'PC-TUJUAN');

        $incident->refresh();
        $this->assertSame($newLab->id, $incident->laboratory_id_snapshot);
        $this->assertSame($newDevice->id, $incident->device_id_snapshot);

        $this->patchJson('/api/v1/incidents/'.$incident->id, ['deviceId' => '   '], ['If-Match' => '"2"'])
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.device', null);

        $incident->refresh();
        $this->assertNull($incident->device_id);
        $this->assertNull($incident->device_id_snapshot);
        $this->assertNull($incident->device_code_snapshot);
        $this->assertNull($incident->device_type_snapshot);
    }

    public function test_subject_change_locks_laboratories_then_devices_then_incident(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $oldLab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $oldDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $oldLab->id,
            'lifecycle_status' => 'in_service',
        ]);
        $incident = $this->createIncidentFor([$user, $membership], $oldLab, $oldDevice);
        $newLab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $newDevice = Device::factory()->for($school)->create([
            'home_laboratory_id' => $newLab->id,
            'lifecycle_status' => 'in_service',
        ]);
        DB::flushQueryLog();
        DB::enableQueryLog();

        $this->patchJson('/api/v1/incidents/'.$incident->id, [
            'laboratoryId' => $newLab->id,
            'deviceId' => $newDevice->id,
        ], ['If-Match' => '"1"'])->assertOk();

        $selects = collect(DB::getQueryLog())
            ->pluck('query')
            ->filter(fn (string $sql): bool => str_starts_with(strtolower($sql), 'select'))
            ->values();
        $labIndex = $selects->search(fn (string $sql): bool => str_contains($sql, 'from "laboratories"'));
        $deviceIndex = $selects->search(fn (string $sql): bool => str_contains($sql, 'from "devices"'));
        $incidentIndexes = $selects->keys()->filter(fn (int $index): bool => str_contains($selects[$index], 'from "incidents"'))->values();

        $this->assertIsInt($labIndex);
        $this->assertIsInt($deviceIndex);
        $this->assertGreaterThan($labIndex, $deviceIndex);
        $this->assertCount(3, $incidentIndexes);
        $this->assertLessThan($labIndex, $incidentIndexes[0]);
        $this->assertGreaterThan($deviceIndex, $incidentIndexes[1]);
    }

    public function test_ineligible_subjects_fail_without_partial_writes_or_events(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $lab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $device = Device::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'lifecycle_status' => 'in_service',
        ]);
        $inactive = Laboratory::factory()->for($school)->create(['status' => 'inactive']);
        $wrongLab = Laboratory::factory()->for($school)->create(['status' => 'active']);
        $retired = Device::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'lifecycle_status' => 'retired',
        ]);
        $decommissioned = Device::factory()->for($school)->create([
            'home_laboratory_id' => $lab->id,
            'lifecycle_status' => 'decommissioned',
        ]);
        $wrongHome = Device::factory()->for($school)->create([
            'home_laboratory_id' => $wrongLab->id,
            'lifecycle_status' => 'in_service',
        ]);
        $otherSchool = School::factory()->create();
        $crossSchoolLab = Laboratory::factory()->for($otherSchool)->create(['status' => 'active']);
        $crossSchoolDevice = Device::factory()->for($otherSchool)->create([
            'home_laboratory_id' => $crossSchoolLab->id,
            'lifecycle_status' => 'in_service',
        ]);

        $cases = [
            [['laboratoryId' => $inactive->id], 'INCIDENT_LABORATORY_INELIGIBLE'],
            [['laboratoryId' => strtolower((string) Str::ulid())], 'INCIDENT_LABORATORY_INELIGIBLE'],
            [['laboratoryId' => $crossSchoolLab->id], 'INCIDENT_LABORATORY_INELIGIBLE'],
            [['deviceId' => $retired->id], 'INCIDENT_DEVICE_NOT_ELIGIBLE'],
            [['deviceId' => $decommissioned->id], 'INCIDENT_DEVICE_NOT_ELIGIBLE'],
            [['deviceId' => $wrongHome->id], 'INCIDENT_DEVICE_NOT_ELIGIBLE'],
            [['deviceId' => $crossSchoolDevice->id], 'INCIDENT_DEVICE_NOT_ELIGIBLE'],
            [['laboratoryId' => $wrongLab->id], 'INCIDENT_DEVICE_NOT_ELIGIBLE'],
        ];

        foreach ($cases as [$payload, $code]) {
            $incident = $this->createIncidentFor([$user, $membership], $lab, $device);
            $this->patchJson('/api/v1/incidents/'.$incident->id, $payload, ['If-Match' => '"1"'])
                ->assertConflict()
                ->assertJsonPath('code', $code);
            $incident->refresh();
            $this->assertSame(1, $incident->version);
            $this->assertSame($lab->id, $incident->laboratory_id);
            $this->assertSame($device->id, $incident->device_id);
            $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());
        }
    }

    #[DataProvider('nonReportedStatusProvider')]
    public function test_every_non_reported_status_is_rejected_before_mutation(string $status): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        DB::table('incidents')->where('id', $incident->id)->update(
            $this->validStatusAttributes($status, $school),
        );

        $this->patchJson('/api/v1/incidents/'.$incident->id, ['title' => 'Judul koreksi valid'], ['If-Match' => '"1"'])
            ->assertConflict()
            ->assertJsonPath('code', 'INCIDENT_STATUS_CONFLICT');
        $this->assertSame('Desktop gagal menyala', $incident->fresh()->title);
        $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());
    }

    public static function nonReportedStatusProvider(): array
    {
        return collect(['triaged', 'assigned', 'in_progress', 'resolved', 'verified', 'closed', 'rejected'])
            ->mapWithKeys(fn (string $status): array => [$status => [$status]])
            ->all();
    }

    public function test_event_failure_rolls_back_root_version_and_values(): void
    {
        [$user, $school, $membership] = $this->authenticateWithPermissions($this->permissions());
        $incident = $this->createIncidentFor(
            [$user, $membership],
            Laboratory::factory()->for($school)->create(['status' => 'active']),
        );
        $membership->setRelation('user', $user);
        Event::listen('eloquent.creating: '.IncidentEvent::class, static function (): never {
            throw new RuntimeException('forced event failure');
        });

        try {
            app(IncidentCorrectionService::class)->correct(
                new CurrentMembershipContext($membership, collect($this->permissions())),
                $incident->id,
                1,
                ['title' => 'Judul koreksi valid'],
            );
            $this->fail('Expected the event write to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('forced event failure', $exception->getMessage());
        } finally {
            Event::forget('eloquent.creating: '.IncidentEvent::class);
        }

        $incident->refresh();
        $this->assertSame(1, $incident->version);
        $this->assertSame('Desktop gagal menyala', $incident->title);
        $this->assertSame(1, IncidentEvent::query()->where('incident_id_snapshot', $incident->id)->count());
    }

    public function test_route_uses_exact_permission_and_precondition_order(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())->sole(
            fn ($route): bool => $route->uri() === 'api/v1/incidents/{incidentId}'
                && in_array('PATCH', $route->methods(), true),
        );
        $middleware = array_values($route->gatherMiddleware());

        $view = array_search('permission:incidents.view', $middleware, true);
        $update = array_search('permission:incidents.update', $middleware, true);
        $assign = array_search('permission:incidents.assign', $middleware, true);
        $precondition = array_search('App\\Http\\Middleware\\RequireIncidentVersionPrecondition', $middleware, true);
        $this->assertIsInt($view);
        $this->assertIsInt($update);
        $this->assertIsInt($assign);
        $this->assertIsInt($precondition);
        $this->assertLessThan($update, $view);
        $this->assertLessThan($assign, $update);
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
    private function createIncidentFor(array $reporter, Laboratory $laboratory, ?Device $device = null): Incident
    {
        [$user, $membership] = $reporter;
        $membership->setRelation('user', $user);

        return app(IncidentCreationService::class)->create(
            new CurrentMembershipContext($membership, collect()),
            strtolower((string) Str::uuid()),
            [
                'laboratoryId' => $laboratory->id,
                'deviceId' => $device?->id,
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

    /** @return list<string> */
    private function permissions(): array
    {
        return ['incidents.view', 'incidents.update', 'incidents.assign'];
    }

    /** @return array<string, mixed> */
    private function validStatusAttributes(string $status, School $school): array
    {
        $now = now()->subMinute();
        $triaged = [
            'status' => $status,
            'triage_summary' => 'Incident sudah ditinjau.',
            'triaged_at' => $now,
        ];

        if (in_array($status, ['assigned', 'in_progress'], true)) {
            $assignee = User::factory()->create();
            $assigneeMembership = SchoolMembership::factory()->create([
                'school_id' => $school->id,
                'user_id' => $assignee->id,
                'status' => 'active',
            ]);

            return [
                ...$triaged,
                'assignee_membership_id' => $assigneeMembership->id,
                'assignee_user_id_snapshot' => $assignee->id,
                'assignee_name_snapshot' => $assignee->name,
                'assigned_at' => $now,
                'started_at' => $status === 'in_progress' ? $now : null,
            ];
        }

        return match ($status) {
            'triaged' => $triaged,
            'resolved' => [
                ...$triaged,
                'resolution_summary' => 'Incident telah diselesaikan.',
                'resolved_at' => $now,
            ],
            'verified' => [
                ...$triaged,
                'resolution_summary' => 'Incident telah diselesaikan.',
                'resolved_at' => $now,
                'verification_note' => 'Hasil sudah diverifikasi.',
                'verified_at' => $now,
            ],
            'closed' => [
                ...$triaged,
                'resolution_summary' => 'Incident telah diselesaikan.',
                'resolved_at' => $now,
                'verification_note' => 'Hasil sudah diverifikasi.',
                'verified_at' => $now,
                'closed_at' => $now,
            ],
            'rejected' => [
                'status' => $status,
                'rejection_reason' => 'Laporan tidak dapat diverifikasi.',
                'rejected_at' => $now,
            ],
        };
    }

    /** @param array<string, mixed> $data */
    private function assertIncidentDtoKeys(array $data): void
    {
        $this->assertSame([
            'id', 'ticketNumber', 'reporter', 'laboratory', 'device', 'category', 'priority',
            'title', 'description', 'impact', 'blocksLaboratoryOperation', 'stepsTaken', 'status',
            'assignee', 'triageSummary', 'resolutionSummary', 'rejectionReason', 'verificationNote',
            'version', 'occurredAt', 'reportedAt', 'triagedAt', 'assignedAt', 'startedAt',
            'resolvedAt', 'verifiedAt', 'closedAt', 'rejectedAt', 'createdAt', 'updatedAt',
        ], array_keys($data));
    }
}
