<?php

namespace App\Application\Reservation;

use App\Application\Availability\LaboratoryAvailabilityQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Reservation\LaboratoryReservationException;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class LaboratoryReservationMutationService
{
    public function __construct(
        private readonly LaboratoryAvailabilityQueryService $availability,
        private readonly LaboratoryReservationEventRecorder $recorder,
    ) {
    }

    /** @param array<string,mixed> $data */
    public function create(CurrentMembershipContext $context, User $actor, array $data): LaboratoryReservation
    {
        return DB::transaction(function () use ($context, $actor, $data): LaboratoryReservation {
            $schoolId = (string) $context->membership->school_id;

            $laboratory = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($data['laboratoryId'])
                ->lockForUpdate()
                ->first();

            if ($laboratory === null) {
                throw ValidationException::withMessages([
                    'laboratoryId' => ['The selected Laboratory is invalid.'],
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

            if (($availability['available'] ?? false) !== true) {
                throw LaboratoryReservationException::unavailable($availability);
            }

            $id = (string) Str::ulid();
            $reservation = new LaboratoryReservation([
                'school_id' => $schoolId,
                'reservation_number' => 'RSV-'.str_replace('-', '', (string) $data['date']).'-'.substr($id, -8),
                'laboratory_id' => $laboratory->id,
                'requester_user_id' => $actor->id,
                'requester_membership_id' => $context->membership->id,
                'requester_name_snapshot' => $actor->name,
                'requester_email_snapshot' => $actor->email,
                'reservation_date' => $data['date'],
                'starts_at' => $this->seconds((string) $data['startsAt']),
                'ends_at' => $this->seconds((string) $data['endsAt']),
                'activity' => trim((string) $data['activity']),
                'participants' => (int) $data['participants'],
                'device_needs' => $this->nullableTrim($data['deviceNeeds'] ?? null),
                'notes' => $this->nullableTrim($data['notes'] ?? null),
                'pic_name' => trim((string) $data['picName']),
                'status' => 'submitted',
                'rejection_reason' => null,
                'decided_at' => null,
                'cancelled_at' => null,
                'version' => 1,
            ]);
            $reservation->id = $id;
            $reservation->save();

            $this->recorder->record(
                $context,
                $actor,
                $reservation,
                'reservation.submitted',
                [
                    'availabilityAtSubmission' => [
                        'state' => $availability['state'],
                        'sourceCoverage' => $availability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                0,
                1,
            );

            return $this->reload($reservation);
        });
    }

    public function approve(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
    ): LaboratoryReservation {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion): LaboratoryReservation {
            [$laboratory, $reservation] = $this->lockForMutation($context, $id);

            $this->assertVersion($reservation, $expectedVersion);
            if ($reservation->status !== 'submitted') {
                throw LaboratoryReservationException::stateConflict('Only submitted reservations may be approved.');
            }

            $availability = $this->availability->check(
                $context,
                [
                    'laboratoryId' => (string) $laboratory->id,
                    'date' => $reservation->reservation_date->format('Y-m-d'),
                    'startsAt' => substr((string) $reservation->starts_at, 0, 5),
                    'endsAt' => substr((string) $reservation->ends_at, 0, 5),
                ],
                (string) $reservation->id,
            );

            if (($availability['available'] ?? false) !== true) {
                throw LaboratoryReservationException::unavailable($availability);
            }

            $before = $reservation->version;
            $reservation->status = 'approved';
            $reservation->decided_at = now();
            $reservation->version++;
            $reservation->save();

            $this->recorder->record(
                $context,
                $actor,
                $reservation,
                'reservation.approved',
                [
                    'availabilityAtApproval' => [
                        'state' => $availability['state'],
                        'sourceCoverage' => $availability['sourceCoverage'],
                        'checkedAt' => now()->toISOString(),
                    ],
                ],
                $before,
                $reservation->version,
            );

            return $this->reload($reservation);
        });
    }

    public function reject(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): LaboratoryReservation {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): LaboratoryReservation {
            [, $reservation] = $this->lockForMutation($context, $id);

            $this->assertVersion($reservation, $expectedVersion);
            if ($reservation->status !== 'submitted') {
                throw LaboratoryReservationException::stateConflict('Only submitted reservations may be rejected.');
            }

            $before = $reservation->version;
            $reservation->status = 'rejected';
            $reservation->rejection_reason = trim($reason);
            $reservation->decided_at = now();
            $reservation->version++;
            $reservation->save();

            $this->recorder->record(
                $context,
                $actor,
                $reservation,
                'reservation.rejected',
                ['reason' => $reservation->rejection_reason],
                $before,
                $reservation->version,
            );

            return $this->reload($reservation);
        });
    }

    public function cancel(
        CurrentMembershipContext $context,
        User $actor,
        string $id,
        int $expectedVersion,
        string $reason,
    ): LaboratoryReservation {
        return DB::transaction(function () use ($context, $actor, $id, $expectedVersion, $reason): LaboratoryReservation {
            [, $reservation] = $this->lockForMutation($context, $id);

            if ($reservation->requester_membership_id !== $context->membership->id
                && ! $context->permissions->contains('bookings.view-all')) {
                throw LaboratoryReservationException::notFound();
            }

            $this->assertVersion($reservation, $expectedVersion);
            if (! in_array($reservation->status, ['submitted', 'approved'], true)) {
                throw LaboratoryReservationException::stateConflict('Only submitted or approved reservations may be cancelled.');
            }

            $beforeStatus = $reservation->status;
            $before = $reservation->version;
            $reservation->status = 'cancelled';
            $reservation->cancelled_at = now();
            $reservation->version++;
            $reservation->save();

            $this->recorder->record(
                $context,
                $actor,
                $reservation,
                'reservation.cancelled',
                [
                    'reason' => trim($reason),
                    'previousStatus' => $beforeStatus,
                ],
                $before,
                $reservation->version,
            );

            return $this->reload($reservation);
        });
    }

    /** @return array{Laboratory,LaboratoryReservation} */
    private function lockForMutation(CurrentMembershipContext $context, string $id): array
    {
        $schoolId = (string) $context->membership->school_id;

        $candidate = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->first();

        if ($candidate === null) {
            throw LaboratoryReservationException::notFound();
        }

        $laboratory = Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereKey($candidate->laboratory_id)
            ->lockForUpdate()
            ->first();

        if ($laboratory === null) {
            throw LaboratoryReservationException::stateConflict('The reservation Laboratory is no longer resolvable.');
        }

        $reservation = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->whereKey($id)
            ->lockForUpdate()
            ->first();

        if ($reservation === null) {
            throw LaboratoryReservationException::notFound();
        }

        return [$laboratory, $reservation];
    }

    private function assertVersion(LaboratoryReservation $reservation, int $expectedVersion): void
    {
        if ($reservation->version !== $expectedVersion) {
            throw LaboratoryReservationException::versionConflict();
        }
    }

    private function reload(LaboratoryReservation $reservation): LaboratoryReservation
    {
        return $reservation->refresh()->load([
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
