<?php

namespace App\Application\Session;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Session\LaboratorySessionDomainException;
use App\Models\LaboratoryReservation;
use App\Models\LaboratorySession;
use App\Models\PriorityEvent;
use App\Models\ScheduleOccurrence;
use Illuminate\Support\Collection;

class LaboratorySessionSourceQueryService
{
    /** @param array<string,mixed> $filters @return array<int,array<string,mixed>> */
    public function sources(CurrentMembershipContext $context, array $filters): array
    {
        $canViewAll = $context->permissions->contains('sessions.view-all');
        $scope = $filters['scope'] ?? ($canViewAll ? 'all' : 'mine');

        if ($scope === 'all' && ! $canViewAll) {
            throw LaboratorySessionDomainException::scopeForbidden();
        }

        $schoolId = (string) $context->membership->school_id;
        $membershipId = (string) $context->membership->id;
        $from = (string) $filters['from'];
        $to = (string) $filters['to'];
        $laboratoryId = $filters['laboratoryId'] ?? null;

        $sessions = $this->sessionMap($schoolId, $from, $to, $scope === 'mine' ? $membershipId : null);
        $rows = [];

        $occurrences = ScheduleOccurrence::query()
            ->where('school_id', $schoolId)
            ->whereBetween('occurs_on', [$from, $to])
            ->whereHas('publication', fn ($query) => $query->where('status', 'active'))
            ->when($scope === 'mine', fn ($query) => $query->whereHas(
                'teacher',
                fn ($teacher) => $teacher->where('membership_id', $membershipId),
            ))
            ->with([
                'publication:id,school_id,effective_from,effective_to,status',
                'entry:id,school_id,source_schedule_id',
                'teacher:id,school_id,code,name,membership_id,status',
                'academicClass:id,school_id,code,name,student_count,status',
                'subject:id,school_id,code,name,status',
                'plannedLaboratory:id,school_id,code,name,capacity,status',
                'activeException:id,school_id,occurrence_id,resolution,replacement_laboratory_id,status,version',
                'activeException.replacementLaboratory:id,school_id,code,name,capacity,status',
            ])
            ->get();

        foreach ($occurrences as $occurrence) {
            $date = $occurrence->occurs_on->format('Y-m-d');
            if ($occurrence->publication === null
                || $date < $occurrence->publication->effective_from->format('Y-m-d')
                || $date > $occurrence->publication->effective_to->format('Y-m-d')) {
                continue;
            }

            $exception = $occurrence->activeException;
            if ($exception?->resolution === 'cancel') {
                continue;
            }

            $laboratory = $exception?->resolution === 'relocate'
                ? $exception->replacementLaboratory
                : $occurrence->plannedLaboratory;

            if ($laboratory === null || $laboratory->status !== 'active') {
                continue;
            }
            if (is_string($laboratoryId) && $laboratory->id !== $laboratoryId) {
                continue;
            }

            $rows[] = [
                'sourceType' => 'schedule_occurrence',
                'sourceId' => (string) $occurrence->id,
                'sourceNumber' => (string) ($occurrence->entry?->source_schedule_id ?? $occurrence->id),
                'date' => $date,
                'startsAt' => $this->time($occurrence->start_time_snapshot),
                'endsAt' => $this->time($occurrence->end_time_snapshot),
                'activityKind' => (string) $occurrence->activity_type,
                'title' => (string) ($occurrence->subject?->name ?? 'Pelaksanaan terjadwal'),
                'subtitle' => (string) ($occurrence->academicClass?->name ?? ''),
                'laboratory' => $this->laboratory($laboratory),
                'responsibility' => [
                    'name' => (string) ($occurrence->teacher?->name ?? ''),
                    'teacherId' => $occurrence->teacher_id,
                    'academicClass' => $occurrence->academicClass === null ? null : [
                        'id' => (string) $occurrence->academicClass->id,
                        'code' => (string) $occurrence->academicClass->code,
                        'name' => (string) $occurrence->academicClass->name,
                    ],
                    'subject' => $occurrence->subject === null ? null : [
                        'id' => (string) $occurrence->subject->id,
                        'code' => (string) $occurrence->subject->code,
                        'name' => (string) $occurrence->subject->name,
                    ],
                    'plannedParticipantCount' => (int) ($occurrence->academicClass?->student_count ?? 0),
                ],
                'session' => $sessions->get('schedule_occurrence:'.$occurrence->id),
            ];
        }

        $reservations = LaboratoryReservation::query()
            ->where('school_id', $schoolId)
            ->where('status', 'approved')
            ->whereBetween('reservation_date', [$from, $to])
            ->when($scope === 'mine', fn ($query) => $query->where('requester_membership_id', $membershipId))
            ->when(is_string($laboratoryId), fn ($query) => $query->where('laboratory_id', $laboratoryId))
            ->with('laboratory:id,school_id,code,name,capacity,status')
            ->get();

        foreach ($reservations as $reservation) {
            if ($reservation->laboratory === null || $reservation->laboratory->status !== 'active') {
                continue;
            }

            $rows[] = [
                'sourceType' => 'laboratory_reservation',
                'sourceId' => (string) $reservation->id,
                'sourceNumber' => (string) $reservation->reservation_number,
                'date' => $reservation->reservation_date->format('Y-m-d'),
                'startsAt' => $this->time($reservation->starts_at),
                'endsAt' => $this->time($reservation->ends_at),
                'activityKind' => 'other',
                'title' => (string) $reservation->activity,
                'subtitle' => 'Reservasi laboratorium',
                'laboratory' => $this->laboratory($reservation->laboratory),
                'responsibility' => [
                    'name' => (string) $reservation->pic_name,
                    'teacherId' => null,
                    'academicClass' => null,
                    'subject' => null,
                    'plannedParticipantCount' => (int) $reservation->participants,
                ],
                'session' => $sessions->get('laboratory_reservation:'.$reservation->id),
            ];
        }

        $events = PriorityEvent::query()
            ->where('school_id', $schoolId)
            ->where('status', 'approved')
            ->whereBetween('event_date', [$from, $to])
            ->when($scope === 'mine', fn ($query) => $query->where('requester_membership_id', $membershipId))
            ->when(is_string($laboratoryId), fn ($query) => $query->where('laboratory_id', $laboratoryId))
            ->with('laboratory:id,school_id,code,name,capacity,status')
            ->get();

        foreach ($events as $event) {
            if ($event->laboratory === null || $event->laboratory->status !== 'active') {
                continue;
            }

            $rows[] = [
                'sourceType' => 'priority_event',
                'sourceId' => (string) $event->id,
                'sourceNumber' => (string) $event->event_number,
                'date' => $event->event_date->format('Y-m-d'),
                'startsAt' => $this->time($event->starts_at),
                'endsAt' => $this->time($event->ends_at),
                'activityKind' => $event->category === 'exam' ? 'exam' : 'other',
                'title' => (string) $event->title,
                'subtitle' => 'Kegiatan prioritas',
                'laboratory' => $this->laboratory($event->laboratory),
                'responsibility' => [
                    'name' => (string) $event->pic_name,
                    'teacherId' => null,
                    'academicClass' => null,
                    'subject' => null,
                    'plannedParticipantCount' => (int) $event->participants,
                ],
                'session' => $sessions->get('priority_event:'.$event->id),
            ];
        }

        usort($rows, fn (array $left, array $right): int => [
            $left['date'],
            $left['startsAt'],
            $left['sourceType'],
            $left['sourceId'],
        ] <=> [
            $right['date'],
            $right['startsAt'],
            $right['sourceType'],
            $right['sourceId'],
        ]);

        return $rows;
    }

    /** @return Collection<string,array<string,mixed>> */
    private function sessionMap(string $schoolId, string $from, string $to, ?string $membershipId): Collection
    {
        $sessions = LaboratorySession::query()
            ->where('school_id', $schoolId)
            ->whereBetween('source_date', [$from, $to])
            ->when($membershipId !== null, fn ($query) => $query->where('source_owner_membership_id', $membershipId))
            ->with('activityReport:id,school_id,session_id,report_number,report_type,status,version')
            ->orderByDesc('created_at')
            ->get();

        $grouped = $sessions->groupBy(fn (LaboratorySession $session): string => $session->source_type.':'.$session->sourceId());

        return $grouped->map(function (Collection $items): array {
            /** @var LaboratorySession $session */
            $session = $items->first(fn (LaboratorySession $candidate): bool => $candidate->status !== 'cancelled')
                ?? $items->first();

            return [
                'id' => (string) $session->id,
                'sessionNumber' => (string) $session->session_number,
                'status' => (string) $session->status,
                'version' => (int) $session->version,
                'actualStartedAt' => $session->actual_started_at?->toISOString(),
                'actualEndedAt' => $session->actual_ended_at?->toISOString(),
                'activityReport' => $session->activityReport === null ? null : [
                    'id' => (string) $session->activityReport->id,
                    'reportNumber' => (string) $session->activityReport->report_number,
                    'reportType' => (string) $session->activityReport->report_type,
                    'status' => (string) $session->activityReport->status,
                    'version' => (int) $session->activityReport->version,
                ],
            ];
        });
    }

    /** @return array<string,mixed> */
    private function laboratory(mixed $laboratory): array
    {
        return [
            'id' => (string) $laboratory->id,
            'code' => (string) $laboratory->code,
            'name' => (string) $laboratory->name,
            'capacity' => (int) $laboratory->capacity,
            'status' => (string) $laboratory->status,
        ];
    }

    private function time(mixed $value): string
    {
        return substr((string) $value, 0, 8);
    }
}
