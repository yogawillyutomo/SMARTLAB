<?php

namespace App\Application\PriorityEvent;

use App\Application\Availability\LaboratoryAvailabilityQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\PriorityEvent\PriorityEventDomainException;
use App\Models\Laboratory;
use App\Models\PriorityEvent;
use App\Models\School;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PriorityEventMutationService
{
    public function __construct(
        private readonly LaboratoryAvailabilityQueryService $availability,
        private readonly PriorityEventEventRecorder $recorder,
    ) {
    }

    /** @param array<string,mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): PriorityEvent
    {
        return DB::transaction(function () use ($context, $actor, $data): PriorityEvent {
            $schoolId = (string) $context->membership->school_id;
            School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['laboratoryId'])
                ->lockForUpdate()
                ->first();

            if ($laboratory === null || $laboratory->status !== 'active') {
                throw ValidationException::withMessages([
                    'laboratoryId' => ['The selected Laboratory must exist and be active in the current School.'],
                ]);
            }

            if ((int) $data['participants'] > (int) $laboratory->capacity) {
                throw ValidationException::withMessages([
                    'participants' => ['Participant count exceeds the Laboratory capacity.'],
                ]);
            }

            $availability = $this->availability->check($context, [
                'laboratoryId' => (string) $laboratory->id,
                'date' => (string) $data['date'],
                'startsAt' => (string) $data['startsAt'],
                'endsAt' => (string) $data['endsAt'],
            ]);

            $id = (string) Str::ulid();
            $event = new PriorityEvent([
                'school_id' => $schoolId,
                'event_number' => 'PEV-'.str_replace('-', '', (string) $data['date']).'-'.substr($id, -8),
                'laboratory_id' => $laboratory->id,
                'requester_user_id' => $actor->id,
                'requester_membership_id' => $context->membership->id,
                'requester_name_snapshot' => $actor->name,
                'requester_email_snapshot' => $actor->email,
                'event_date' => $data['date'],
                'starts_at' => $this->seconds((string) $data['startsAt']),
                'ends_at' => $this->seconds((string) $data['endsAt']),
                'category' => $data['category'],
                'title' => trim((string) $data['title']),
                'participants' => (int) $data['participants'],
                'description' => $this->nullableTrim($data['description'] ?? null),
                'pic_name' => trim((string) $data['picName']),
                'status' => 'submitted',
                'rejection_reason' => null,
                'decided_at' => null,
                'cancelled_at' => null,
                'version' => 1,
            ]);
            $event->id = $id;
            $event->save();

            $this->recorder->record(
                $context,
                $actor,
                $event,
                'priority_event.submitted',
                [
                    'availabilityAtSubmission' => [
                        'available' => $availability['available'],
                        'state' => $availability['state'],
                        'blockerCount' => $availability['blockerCount'],
                        'sourceCoverage' => $availability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                0,
                1,
            );

            return $this->reload($event);
        });
    }

    public function approve(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
    ): PriorityEvent {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): PriorityEvent {
            [$laboratory, $event] = $this->lockForMutation($context, $id);

            $this->assertVersion($event, $expectedVersion);
            if ($event->status !== 'submitted') {
                throw PriorityEventDomainException::stateConflict('Only submitted Priority Events may be approved.');
            }

            $availability = $this->availability->check(
                $context,
                [
                    'laboratoryId' => (string) $laboratory->id,
                    'date' => $event->event_date->format('Y-m-d'),
                    'startsAt' => substr((string) $event->starts_at, 0, 5),
                    'endsAt' => substr((string) $event->ends_at, 0, 5),
                ],
            );

            if (($availability['available'] ?? false) !== true) {
                throw PriorityEventDomainException::reconciliationRequired($availability);
            }

            $before = $event->version;
            $event->status = 'approved';
            $event->decided_at = now();
            $event->version++;
            $event->save();

            $this->recorder->record(
                $context,
                $actor,
                $event,
                'priority_event.approved',
                [
                    'availabilityAtApproval' => [
                        'state' => $availability['state'],
                        'sourceCoverage' => $availability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                $before,
                $event->version,
            );

            return $this->reload($event);
        });
    }

    public function reject(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): PriorityEvent {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): PriorityEvent {
            [, $event] = $this->lockForMutation($context, $id);

            $this->assertVersion($event, $expectedVersion);
            if ($event->status !== 'submitted') {
                throw PriorityEventDomainException::stateConflict('Only submitted Priority Events may be rejected.');
            }

            $before = $event->version;
            $event->status = 'rejected';
            $event->rejection_reason = trim($reason);
            $event->decided_at = now();
            $event->version++;
            $event->save();

            $this->recorder->record(
                $context,
                $actor,
                $event,
                'priority_event.rejected',
                ['reason' => $event->rejection_reason],
                $before,
                $event->version,
            );

            return $this->reload($event);
        });
    }

    public function cancel(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): PriorityEvent {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): PriorityEvent {
            [, $event] = $this->lockForMutation($context, $id);

            if ($event->requester_membership_id !== $context->membership->id
                && ! $context->permissions->contains('priority-events.view-all')) {
                throw PriorityEventDomainException::notFound();
            }

            $this->assertVersion($event, $expectedVersion);
            if (! in_array($event->status, ['submitted', 'approved'], true)) {
                throw PriorityEventDomainException::stateConflict('Only submitted or approved Priority Events may be cancelled.');
            }

            $beforeStatus = $event->status;
            $before = $event->version;
            $event->status = 'cancelled';
            $event->cancelled_at = now();
            $event->version++;
            $event->save();

            $this->recorder->record(
                $context,
                $actor,
                $event,
                'priority_event.cancelled',
                [
                    'reason' => trim($reason),
                    'previousStatus' => $beforeStatus,
                ],
                $before,
                $event->version,
            );

            return $this->reload($event);
        });
    }

    /** @return array{Laboratory,PriorityEvent} */
    private function lockForMutation(CurrentMembershipContext $context, string $id): array
    {
        $schoolId = (string) $context->membership->school_id;
        School::query()->whereKey($schoolId)->lockForUpdate()->firstOrFail();

        $candidate = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->first();

        if ($candidate === null) {
            throw PriorityEventDomainException::notFound();
        }

        $laboratory = Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereKey($candidate->laboratory_id)
            ->lockForUpdate()
            ->first();

        if ($laboratory === null) {
            throw PriorityEventDomainException::stateConflict('The Priority Event Laboratory is no longer resolvable.');
        }

        $event = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->lockForUpdate()
            ->first();

        if ($event === null) {
            throw PriorityEventDomainException::notFound();
        }

        return [$laboratory, $event];
    }

    private function assertVersion(PriorityEvent $event, int $expectedVersion): void
    {
        if ($event->version !== $expectedVersion) {
            throw PriorityEventDomainException::versionConflict();
        }
    }

    private function reload(PriorityEvent $event): PriorityEvent
    {
        return $event->refresh()->load([
            'laboratory:id,school_id,code,name,capacity,status',
            'events' => fn ($query) => $query->orderBy('created_at')->orderBy('id'),
        ]);
    }

    private function seconds(string $time): string
    {
        return strlen($time) === 5 ? $time.':00' : $time;
    }

    private function nullableTrim(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
