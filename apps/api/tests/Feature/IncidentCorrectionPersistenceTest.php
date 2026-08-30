<?php

namespace Tests\Feature;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Incident\IncidentCreationService;
use App\Application\Incident\IncidentEventRecorder;
use App\Application\Incident\IncidentTicketAllocator;
use App\Domain\Incident\IncidentEventType;
use App\Models\IncidentEvent;
use App\Models\Laboratory;
use App\Models\School;
use App\Models\SchoolMembership;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use LogicException;
use Tests\Concerns\ManagesIncidentDatabaseTestFailures;
use Tests\TestCase;

class IncidentCorrectionPersistenceTest extends TestCase
{
    use ManagesIncidentDatabaseTestFailures;
    use RefreshDatabase;

    public function test_event_live_foreign_keys_can_be_nulled_without_rewriting_historical_evidence(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();
        $original = $this->historicalEvidence($event);

        DB::table('incident_events')->where('id', $event->id)->update([
            'incident_id' => null,
            'actor_user_id' => null,
            'actor_membership_id' => null,
        ]);

        $event->refresh();
        $this->assertNull($event->incident_id);
        $this->assertNull($event->actor_user_id);
        $this->assertNull($event->actor_membership_id);
        $this->assertSame($original, $this->historicalEvidence($event));
    }

    public function test_event_id_update_is_rejected_by_the_database_trigger(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();
        $replacementId = strtolower((string) Str::ulid());

        $this->assertDatabaseOperationIsRejected(
            fn () => DB::table('incident_events')->where('id', $event->id)->update(['id' => $replacementId]),
            'Expected immutable event identity rejection.',
        );
        $this->assertDatabaseHas('incident_events', ['id' => $event->id]);
        $this->assertDatabaseMissing('incident_events', ['id' => $replacementId]);
    }

    public function test_arbitrary_event_update_is_rejected_by_the_database_trigger(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();

        $this->expectException(QueryException::class);
        DB::table('incident_events')->where('id', $event->id)->update(['event_type' => 'incident.updated']);
    }

    public function test_event_delete_is_rejected_by_the_database_trigger(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();

        $this->expectException(QueryException::class);
        DB::table('incident_events')->where('id', $event->id)->delete();
    }

    public function test_duplicate_aggregate_version_is_rejected(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();

        $duplicate = $event->getAttributes();
        $duplicate['id'] = strtolower((string) Str::ulid());
        $this->expectException(QueryException::class);
        DB::table('incident_events')->insert($duplicate);
    }

    public function test_deleting_actor_membership_uses_fk_set_null_without_rewriting_event_evidence(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();
        $original = $this->historicalEvidence($event);
        $actorUserId = $event->actor_user_id;

        $context->membership->delete();

        $event->refresh();
        $this->assertNull($event->actor_membership_id);
        $this->assertSame($actorUserId, $event->actor_user_id);
        $this->assertSame($original, $this->historicalEvidence($event));
    }

    public function test_deleting_actor_user_uses_fk_set_null_without_rewriting_event_evidence(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        app(IncidentCreationService::class)->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));
        $event = IncidentEvent::query()->sole();
        $original = $this->historicalEvidence($event);
        $actor = $context->membership->user;

        // User deletion is intentionally ordered after membership deletion because
        // the identity foundation restricts User deletion while memberships exist.
        $context->membership->delete();
        $actor->delete();

        $event->refresh();
        $this->assertNull($event->actor_membership_id);
        $this->assertNull($event->actor_user_id);
        $this->assertSame($original, $this->historicalEvidence($event));
    }

    public function test_event_recorder_requires_aggregate_version_after_to_match_incident(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $incident = app(IncidentCreationService::class)->create(
            $context,
            strtolower((string) Str::uuid()),
            $this->payload($laboratory),
        )->incident;

        $this->expectException(InvalidArgumentException::class);
        app(IncidentEventRecorder::class)->record(
            $incident,
            $context,
            IncidentEventType::CommentAdded,
            1,
            2,
            ['text' => 'This must not persist.'],
        );
    }

    public function test_ticket_allocator_fails_closed_without_an_active_transaction(): void
    {
        DB::shouldReceive('transactionLevel')->once()->andReturn(0);

        $this->expectException(LogicException::class);
        app(IncidentTicketAllocator::class)->allocate(School::factory()->create()->id);
    }

    public function test_portable_application_create_ends_with_one_mapping_and_rollback_leaves_none(): void
    {
        [$context, $laboratory] = $this->contextAndLaboratory();
        $service = app(IncidentCreationService::class);
        $created = $service->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory));

        $this->assertDatabaseHas('incident_submissions', ['incident_id' => $created->incident->id]);
        $this->assertSame(1, DB::table('incident_submissions')->count());

        try {
            $this->installIncidentEventInsertFailureTrigger();
            $this->assertIncidentEventInsertFailureIsRejected(
                fn () => $service->create($context, strtolower((string) Str::uuid()), $this->payload($laboratory)),
                'Expected rollback.',
            );
            $this->assertSame(1, DB::table('incident_submissions')->count());
            $this->assertSame(1, DB::table('incidents')->count());
        } finally {
            $this->removeIncidentEventInsertFailureTrigger();
        }
    }

    /** @return array{CurrentMembershipContext, Laboratory} */
    private function contextAndLaboratory(): array
    {
        $school = School::factory()->create();
        $user = User::factory()->create();
        $membership = SchoolMembership::factory()->create([
            'school_id' => $school->id,
            'user_id' => $user->id,
            'status' => 'active',
        ]);
        $membership->setRelation('user', $user);
        $laboratory = Laboratory::factory()->create(['school_id' => $school->id, 'status' => 'active']);

        return [new CurrentMembershipContext($membership, collect()), $laboratory];
    }

    /** @return array<string, mixed> */
    private function payload(Laboratory $laboratory): array
    {
        return [
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
        ];
    }

    /** @return array<string, mixed> */
    private function historicalEvidence(IncidentEvent $event): array
    {
        return [
            'id' => $event->id,
            'school_id' => $event->school_id,
            'incident_id_snapshot' => $event->incident_id_snapshot,
            'ticket_number_snapshot' => $event->ticket_number_snapshot,
            'actor_user_id_snapshot' => $event->actor_user_id_snapshot,
            'actor_membership_id_snapshot' => $event->actor_membership_id_snapshot,
            'actor_name_snapshot' => $event->actor_name_snapshot,
            'event_type' => $event->event_type,
            'incident_version_before' => $event->incident_version_before,
            'incident_version_after' => $event->incident_version_after,
            'payload' => $event->payload,
            'created_at' => $event->created_at?->utc()->format('Y-m-d\\TH:i:s.u\\Z'),
        ];
    }
}
