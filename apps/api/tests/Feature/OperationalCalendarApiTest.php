<?php

namespace Tests\Feature;

use App\Models\Laboratory;
use App\Models\OperationalCalendarEvent;
use App\Models\OperationalCalendarEventEvent;
use App\Models\Role;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OperationalCalendarApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
    }

    public function test_calendar_auth_and_permission_precede_payload_validation(): void
    {
        $this->postJson('/api/v1/calendar-events', ['unexpected' => true])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'UNAUTHENTICATED');

        $school = School::factory()->create();
        $this->actingAsRole($school, 'guru');

        $this->postJson('/api/v1/calendar-events', ['unexpected' => true])
            ->assertForbidden()
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->actingAsRole($school, 'admin-lab');

        $this->postJson('/api/v1/calendar-events', ['unexpected' => true])
            ->assertStatus(422)
            ->assertJsonValidationErrors([
                'scope','category','availabilityEffect','title','startsOn','endsOn','allDay','unexpected',
            ]);

        $admin = Role::query()->where('key', 'admin-lab')->firstOrFail();
        $teacher = Role::query()->where('key', 'guru')->firstOrFail();

        $this->assertSame(
            ['calendar.cancel','calendar.create','calendar.export','calendar.update','calendar.view'],
            $admin->permissions()->where('key', 'like', 'calendar.%')->pluck('key')->sort()->values()->all(),
        );
        $this->assertSame(
            ['calendar.view'],
            $teacher->permissions()->where('key', 'like', 'calendar.%')->pluck('key')->sort()->values()->all(),
        );
    }

    public function test_school_blocking_event_is_created_listed_and_audited(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');

        $response = $this->postJson('/api/v1/calendar-events', [
            'scope' => 'school',
            'laboratoryId' => null,
            'category' => 'holiday',
            'availabilityEffect' => 'blocked',
            'title' => 'Libur sekolah',
            'description' => 'Kegiatan sekolah ditutup.',
            'startsOn' => '2026-09-14',
            'endsOn' => '2026-09-15',
            'allDay' => true,
            'startsAt' => null,
            'endsAt' => null,
        ])->assertCreated()
            ->assertHeader('ETag', '"1"')
            ->assertJsonPath('data.scope', 'school')
            ->assertJsonPath('data.laboratory', null)
            ->assertJsonPath('data.availabilityEffect', 'blocked')
            ->assertJsonPath('data.status', 'active')
            ->assertJsonPath('data.version', 1);

        $id = $response->json('data.id');

        $this->getJson('/api/v1/calendar-events?from=2026-09-01&to=2026-09-30')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $id);

        $this->assertDatabaseHas('operational_calendar_events', [
            'id' => $id,
            'school_id' => $school->id,
            'scope' => 'school',
            'availability_effect' => 'blocked',
        ]);
        $this->assertDatabaseHas('operational_calendar_event_events', [
            'calendar_event_id' => $id,
            'event_type' => 'calendar_event.created',
            'entity_version_before' => 0,
            'entity_version_after' => 1,
        ]);
    }

    public function test_laboratory_partial_day_event_requires_same_school_active_lab_and_valid_time_shape(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $lab = $this->lab($school, 'LAB-A', 'Lab A');

        $this->postJson('/api/v1/calendar-events', [
            'scope' => 'laboratory',
            'laboratoryId' => $lab->id,
            'category' => 'maintenance',
            'availabilityEffect' => 'blocked',
            'title' => 'Maintenance listrik',
            'startsOn' => '2026-09-20',
            'endsOn' => '2026-09-20',
            'allDay' => false,
            'startsAt' => '10:00',
            'endsAt' => '12:00',
        ])->assertCreated()
            ->assertJsonPath('data.laboratory.id', $lab->id)
            ->assertJsonPath('data.startsAt', '10:00')
            ->assertJsonPath('data.endsAt', '12:00');

        $this->postJson('/api/v1/calendar-events', [
            'scope' => 'laboratory',
            'laboratoryId' => $lab->id,
            'category' => 'maintenance',
            'availabilityEffect' => 'blocked',
            'title' => 'Invalid multi-day partial closure',
            'startsOn' => '2026-09-20',
            'endsOn' => '2026-09-21',
            'allDay' => false,
            'startsAt' => '10:00',
            'endsAt' => '12:00',
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['endsOn']);

        $otherSchool = School::factory()->create();
        $foreign = $this->lab($otherSchool, 'LAB-X', 'Foreign Lab');

        $this->postJson('/api/v1/calendar-events', [
            'scope' => 'laboratory',
            'laboratoryId' => $foreign->id,
            'category' => 'laboratory_closure',
            'availabilityEffect' => 'blocked',
            'title' => 'Foreign',
            'startsOn' => '2026-09-22',
            'endsOn' => '2026-09-22',
            'allDay' => true,
        ])->assertStatus(422)
            ->assertJsonValidationErrors(['laboratoryId']);
    }

    public function test_update_uses_if_match_and_cancel_is_non_destructive(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $lab = $this->lab($school, 'LAB-A', 'Lab A');

        $created = $this->postJson('/api/v1/calendar-events', [
            'scope' => 'laboratory',
            'laboratoryId' => $lab->id,
            'category' => 'maintenance',
            'availabilityEffect' => 'blocked',
            'title' => 'Maintenance',
            'startsOn' => '2026-09-20',
            'endsOn' => '2026-09-20',
            'allDay' => false,
            'startsAt' => '10:00',
            'endsAt' => '12:00',
        ])->assertCreated()->json('data');

        $this->patchJson('/api/v1/calendar-events/'.$created['id'], ['title' => 'Maintenance revisi'])
            ->assertStatus(428)
            ->assertJsonPath('code', 'PRECONDITION_REQUIRED');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/calendar-events/'.$created['id'], ['title' => 'Maintenance revisi'])
            ->assertOk()
            ->assertHeader('ETag', '"2"')
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.title', 'Maintenance revisi');

        $this->withHeader('If-Match', '"1"')
            ->patchJson('/api/v1/calendar-events/'.$created['id'], ['title' => 'stale'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'CALENDAR_EVENT_VERSION_CONFLICT');

        $this->withHeader('If-Match', '"2"')
            ->postJson('/api/v1/calendar-events/'.$created['id'].'/cancel')
            ->assertOk()
            ->assertHeader('ETag', '"3"')
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.version', 3);

        $this->assertDatabaseCount('operational_calendar_events', 1);
        $this->assertDatabaseCount('operational_calendar_event_events', 3);

        $this->getJson('/api/v1/calendar-events?from=2026-09-01&to=2026-09-30')
            ->assertOk()
            ->assertJsonPath('meta.total', 0);

        $this->getJson('/api/v1/calendar-events?from=2026-09-01&to=2026-09-30&status=cancelled')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.status', 'cancelled');

        $this->deleteJson('/api/v1/calendar-events/'.$created['id'])
            ->assertStatus(405);
    }

    public function test_list_uses_overlap_semantics_filters_scope_effect_and_laboratory_and_is_tenant_scoped(): void
    {
        [, $school] = $this->actingAsRole(School::factory()->create(), 'admin-lab');
        $labA = $this->lab($school, 'LAB-A', 'Lab A');
        $labB = $this->lab($school, 'LAB-B', 'Lab B');

        OperationalCalendarEvent::query()->create([
            'school_id'=>$school->id,'scope'=>'school','laboratory_id'=>null,'category'=>'school_event',
            'availability_effect'=>'informational','title'=>'Info','starts_on'=>'2026-09-01','ends_on'=>'2026-09-30',
            'all_day'=>true,'starts_at'=>null,'ends_at'=>null,'status'=>'active','version'=>1,'cancelled_at'=>null,
        ]);
        $target = OperationalCalendarEvent::query()->create([
            'school_id'=>$school->id,'scope'=>'laboratory','laboratory_id'=>$labA->id,'category'=>'laboratory_closure',
            'availability_effect'=>'blocked','title'=>'Closure','starts_on'=>'2026-09-15','ends_on'=>'2026-09-15',
            'all_day'=>true,'starts_at'=>null,'ends_at'=>null,'status'=>'active','version'=>1,'cancelled_at'=>null,
        ]);
        OperationalCalendarEvent::query()->create([
            'school_id'=>$school->id,'scope'=>'laboratory','laboratory_id'=>$labB->id,'category'=>'maintenance',
            'availability_effect'=>'blocked','title'=>'Other Lab','starts_on'=>'2026-09-15','ends_on'=>'2026-09-15',
            'all_day'=>true,'starts_at'=>null,'ends_at'=>null,'status'=>'active','version'=>1,'cancelled_at'=>null,
        ]);

        $foreignSchool = School::factory()->create();
        OperationalCalendarEvent::query()->create([
            'school_id'=>$foreignSchool->id,'scope'=>'school','laboratory_id'=>null,'category'=>'holiday',
            'availability_effect'=>'blocked','title'=>'Foreign','starts_on'=>'2026-09-15','ends_on'=>'2026-09-15',
            'all_day'=>true,'starts_at'=>null,'ends_at'=>null,'status'=>'active','version'=>1,'cancelled_at'=>null,
        ]);

        $this->getJson('/api/v1/calendar-events?from=2026-09-15&to=2026-09-15&scope=laboratory&availabilityEffect=blocked&laboratoryId='.$labA->id)
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $target->id);

        $this->getJson('/api/v1/calendar-events?from=2026-01-01&to=2027-01-02')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['to']);
    }

    private function lab(School $school, string $code, string $name): Laboratory
    {
        return Laboratory::query()->create([
            'school_id'=>$school->id,'code'=>$code,'name'=>$name,'location'=>'Gedung A','capacity'=>36,'status'=>'active',
        ]);
    }

    /** @return array{User,School,SchoolMembership} */
    private function actingAsRole(School $school, string $roleKey): array
    {
        $user=User::factory()->create();
        $membership=SchoolMembership::factory()->create(['school_id'=>$school->id,'user_id'=>$user->id,'status'=>'active']);
        $role=Role::query()->where('key',$roleKey)->firstOrFail();
        $membership->roles()->sync([$role->id]);
        Sanctum::actingAs($user);
        return [$user,$school,$membership];
    }
}
