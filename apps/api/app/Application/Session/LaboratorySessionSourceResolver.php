<?php

namespace App\Application\Session;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Session\LaboratorySessionDomainException;
use App\Models\Laboratory;
use App\Models\LaboratoryReservation;
use App\Models\PriorityEvent;
use App\Models\ScheduleOccurrence;

class LaboratorySessionSourceResolver
{
    /** @return array<string,mixed> */
    public function resolve(CurrentMembershipContext $context, string $sourceType, string $sourceId): array
    {
        return match ($sourceType) {
            'schedule_occurrence' => $this->scheduleOccurrence($context, $sourceId),
            'laboratory_reservation' => $this->reservation($context, $sourceId),
            'priority_event' => $this->priorityEvent($context, $sourceId),
            default => throw LaboratorySessionDomainException::sourceNotFound(),
        };
    }

    /** @return array<string,mixed> */
    private function scheduleOccurrence(CurrentMembershipContext $context, string $sourceId): array
    {
        $schoolId = (string) $context->membership->school_id;
        $occurrence = ScheduleOccurrence::query()
            ->where('school_id', $schoolId)
            ->whereKey($sourceId)
            ->with([
                'publication:id,school_id,source_publication_id,source_version,effective_from,effective_to,status',
                'entry:id,school_id,publication_id,source_schedule_id,source_snapshots',
                'teacher:id,school_id,code,name,membership_id,status',
                'academicClass:id,school_id,code,name,student_count,status',
                'subject:id,school_id,code,name,status',
                'plannedLaboratory:id,school_id,code,name,capacity,status',
                'activeException:id,school_id,occurrence_id,resolution,replacement_laboratory_id,status,version',
                'activeException.replacementLaboratory:id,school_id,code,name,capacity,status',
            ])
            ->first();

        if ($occurrence === null || $occurrence->publication?->status !== 'active') {
            throw LaboratorySessionDomainException::sourceNotFound();
        }

        $date = $occurrence->occurs_on->format('Y-m-d');
        if ($date < $occurrence->publication->effective_from->format('Y-m-d')
            || $date > $occurrence->publication->effective_to->format('Y-m-d')) {
            throw LaboratorySessionDomainException::sourceIneligible('The Schedule Occurrence is outside the active publication window.');
        }

        $exception = $occurrence->activeException;
        if ($exception?->resolution === 'cancel') {
            throw LaboratorySessionDomainException::sourceIneligible(
                'The Schedule Occurrence is cancelled for this date.',
                ['scheduleExceptionId' => (string) $exception->id],
            );
        }

        /** @var Laboratory|null $laboratory */
        $laboratory = $exception?->resolution === 'relocate'
            ? $exception->replacementLaboratory
            : $occurrence->plannedLaboratory;

        if ($laboratory === null || $laboratory->status !== 'active') {
            throw LaboratorySessionDomainException::sourceIneligible(
                'The operational Laboratory for the Schedule Occurrence is not active.',
            );
        }

        $ownerMembershipId = $occurrence->teacher?->membership_id;
        $this->assertExecutionScope($context, is_string($ownerMembershipId) ? $ownerMembershipId : null);

        $evidence = [
            'sourceType' => 'schedule_occurrence',
            'occurrenceId' => (string) $occurrence->id,
            'publicationId' => (string) $occurrence->publication_id,
            'sourcePublicationId' => (string) $occurrence->publication?->source_publication_id,
            'sourceVersion' => (int) $occurrence->publication?->source_version,
            'sourceScheduleId' => (string) $occurrence->entry?->source_schedule_id,
            'date' => $date,
            'startsAt' => $this->time($occurrence->start_time_snapshot),
            'endsAt' => $this->time($occurrence->end_time_snapshot),
            'plannedLaboratoryId' => $occurrence->planned_laboratory_id,
            'effectiveLaboratoryId' => (string) $laboratory->id,
            'scheduleException' => $exception === null ? null : [
                'id' => (string) $exception->id,
                'version' => (int) $exception->version,
                'resolution' => (string) $exception->resolution,
                'replacementLaboratoryId' => $exception->replacement_laboratory_id,
            ],
            'teacherId' => (string) $occurrence->teacher_id,
            'teacherMembershipId' => $ownerMembershipId,
            'academicClassId' => (string) $occurrence->academic_class_id,
            'subjectId' => (string) $occurrence->subject_id,
            'activityType' => (string) $occurrence->activity_type,
        ];

        return [
            'sourceType' => 'schedule_occurrence',
            'sourceId' => (string) $occurrence->id,
            'sourceVersionEvidence' => (int) $occurrence->publication?->source_version,
            'sourcePublicationId' => (string) $occurrence->publication_id,
            'scheduleOccurrenceId' => (string) $occurrence->id,
            'reservationId' => null,
            'priorityEventId' => null,
            'sourceOwnerMembershipId' => $ownerMembershipId,
            'laboratory' => $laboratory,
            'sourceDate' => $date,
            'sourceStartsAt' => $this->time($occurrence->start_time_snapshot),
            'sourceEndsAt' => $this->time($occurrence->end_time_snapshot),
            'activityKind' => (string) $occurrence->activity_type,
            'responsibleTeacherId' => (string) $occurrence->teacher_id,
            'responsibleNameSnapshot' => (string) $occurrence->teacher?->name,
            'academicClassId' => (string) $occurrence->academic_class_id,
            'subjectId' => (string) $occurrence->subject_id,
            'plannedParticipantCount' => (int) ($occurrence->academicClass?->student_count ?? 0),
            'sourceEvidence' => $evidence,
            'sourceFingerprint' => $this->fingerprint($evidence),
            'availabilityExclusions' => [
                'reservationId' => null,
                'scheduleExceptionId' => $exception?->resolution === 'relocate' ? (string) $exception->id : null,
                'scheduleOccurrenceId' => $exception === null ? (string) $occurrence->id : null,
                'priorityEventId' => null,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function reservation(CurrentMembershipContext $context, string $sourceId): array
    {
        $schoolId = (string) $context->membership->school_id;
        $reservation = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->whereKey($sourceId)
            ->with('laboratory:id,school_id,code,name,capacity,status')
            ->first();

        if ($reservation === null) {
            throw LaboratorySessionDomainException::sourceNotFound();
        }
        if ($reservation->status !== 'approved') {
            throw LaboratorySessionDomainException::sourceIneligible('Only approved Laboratory Reservations may be executed.');
        }
        if ($reservation->laboratory === null || $reservation->laboratory->status !== 'active') {
            throw LaboratorySessionDomainException::sourceIneligible('The Reservation Laboratory is not active.');
        }

        $ownerMembershipId = (string) $reservation->requester_membership_id;
        $this->assertExecutionScope($context, $ownerMembershipId);

        $evidence = [
            'sourceType' => 'laboratory_reservation',
            'reservationId' => (string) $reservation->id,
            'reservationNumber' => (string) $reservation->reservation_number,
            'version' => (int) $reservation->version,
            'date' => $reservation->reservation_date->format('Y-m-d'),
            'startsAt' => $this->time($reservation->starts_at),
            'endsAt' => $this->time($reservation->ends_at),
            'laboratoryId' => (string) $reservation->laboratory_id,
            'requesterMembershipId' => $ownerMembershipId,
            'requesterName' => (string) $reservation->requester_name_snapshot,
            'picName' => (string) $reservation->pic_name,
            'activity' => (string) $reservation->activity,
            'participants' => (int) $reservation->participants,
        ];

        return [
            'sourceType' => 'laboratory_reservation',
            'sourceId' => (string) $reservation->id,
            'sourceVersionEvidence' => (int) $reservation->version,
            'sourcePublicationId' => null,
            'scheduleOccurrenceId' => null,
            'reservationId' => (string) $reservation->id,
            'priorityEventId' => null,
            'sourceOwnerMembershipId' => $ownerMembershipId,
            'laboratory' => $reservation->laboratory,
            'sourceDate' => $reservation->reservation_date->format('Y-m-d'),
            'sourceStartsAt' => $this->time($reservation->starts_at),
            'sourceEndsAt' => $this->time($reservation->ends_at),
            'activityKind' => 'other',
            'responsibleTeacherId' => null,
            'responsibleNameSnapshot' => (string) $reservation->pic_name,
            'academicClassId' => null,
            'subjectId' => null,
            'plannedParticipantCount' => (int) $reservation->participants,
            'sourceEvidence' => $evidence,
            'sourceFingerprint' => $this->fingerprint($evidence),
            'availabilityExclusions' => [
                'reservationId' => (string) $reservation->id,
                'scheduleExceptionId' => null,
                'scheduleOccurrenceId' => null,
                'priorityEventId' => null,
            ],
        ];
    }

    /** @return array<string,mixed> */
    private function priorityEvent(CurrentMembershipContext $context, string $sourceId): array
    {
        $schoolId = (string) $context->membership->school_id;
        $event = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->whereKey($sourceId)
            ->with('laboratory:id,school_id,code,name,capacity,status')
            ->first();

        if ($event === null) {
            throw LaboratorySessionDomainException::sourceNotFound();
        }
        if ($event->status !== 'approved') {
            throw LaboratorySessionDomainException::sourceIneligible('Only approved Priority Events may be executed.');
        }
        if ($event->laboratory === null || $event->laboratory->status !== 'active') {
            throw LaboratorySessionDomainException::sourceIneligible('The Priority Event Laboratory is not active.');
        }

        $ownerMembershipId = (string) $event->requester_membership_id;
        $this->assertExecutionScope($context, $ownerMembershipId);

        $evidence = [
            'sourceType' => 'priority_event',
            'priorityEventId' => (string) $event->id,
            'eventNumber' => (string) $event->event_number,
            'version' => (int) $event->version,
            'date' => $event->event_date->format('Y-m-d'),
            'startsAt' => $this->time($event->starts_at),
            'endsAt' => $this->time($event->ends_at),
            'laboratoryId' => (string) $event->laboratory_id,
            'category' => (string) $event->category,
            'title' => (string) $event->title,
            'requesterMembershipId' => $ownerMembershipId,
            'requesterName' => (string) $event->requester_name_snapshot,
            'picName' => (string) $event->pic_name,
            'participants' => (int) $event->participants,
        ];

        return [
            'sourceType' => 'priority_event',
            'sourceId' => (string) $event->id,
            'sourceVersionEvidence' => (int) $event->version,
            'sourcePublicationId' => null,
            'scheduleOccurrenceId' => null,
            'reservationId' => null,
            'priorityEventId' => (string) $event->id,
            'sourceOwnerMembershipId' => $ownerMembershipId,
            'laboratory' => $event->laboratory,
            'sourceDate' => $event->event_date->format('Y-m-d'),
            'sourceStartsAt' => $this->time($event->starts_at),
            'sourceEndsAt' => $this->time($event->ends_at),
            'activityKind' => $event->category === 'exam' ? 'exam' : 'other',
            'responsibleTeacherId' => null,
            'responsibleNameSnapshot' => (string) $event->pic_name,
            'academicClassId' => null,
            'subjectId' => null,
            'plannedParticipantCount' => (int) $event->participants,
            'sourceEvidence' => $evidence,
            'sourceFingerprint' => $this->fingerprint($evidence),
            'availabilityExclusions' => [
                'reservationId' => null,
                'scheduleExceptionId' => null,
                'scheduleOccurrenceId' => null,
                'priorityEventId' => (string) $event->id,
            ],
        ];
    }

    private function assertExecutionScope(CurrentMembershipContext $context, ?string $ownerMembershipId): void
    {
        if ($context->permissions->contains('sessions.view-all')) {
            return;
        }

        if ($ownerMembershipId === null || $ownerMembershipId !== (string) $context->membership->id) {
            throw LaboratorySessionDomainException::sourceNotFound();
        }
    }

    private function time(mixed $value): string
    {
        return substr((string) $value, 0, 8);
    }

    /** @param array<string,mixed> $evidence */
    private function fingerprint(array $evidence): string
    {
        $canonical = $this->canonicalize($evidence);

        return hash('sha256', json_encode($canonical, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }

        ksort($value);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }
}
