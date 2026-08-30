<?php

namespace App\Domain\Incident;

final class IncidentLifecyclePolicy
{
    /** @return list<IncidentTransitionEdge> */
    public function edges(): array
    {
        return [
            $this->edge('reported', 'triaged', 'incidents.approve', 'transition', 'incident.triaged'),
            $this->edge('reported', 'rejected', 'incidents.approve', 'transition', 'incident.rejected'),
            $this->edge('triaged', 'assigned', 'incidents.assign', 'assignment', 'incident.assigned'),
            $this->edge('triaged', 'resolved', 'incidents.approve', 'transition', 'incident.resolved'),
            $this->edge('assigned', 'in_progress', 'incidents.update', 'transition', 'incident.started'),
            $this->edge('assigned', 'resolved', 'incidents.update', 'transition', 'incident.resolved'),
            $this->edge('in_progress', 'resolved', 'incidents.update', 'transition', 'incident.resolved'),
            $this->edge('resolved', 'verified', 'incidents.approve', 'transition', 'incident.verified'),
            $this->edge('resolved', 'in_progress', 'incidents.approve', 'transition', 'incident.reopened'),
            $this->edge('resolved', 'triaged', 'incidents.approve', 'transition', 'incident.reopened'),
            $this->edge('verified', 'closed', 'incidents.approve', 'transition', 'incident.closed'),
        ];
    }

    public function resolve(IncidentStatus $from, IncidentStatus $to, bool $hasAssignee): IncidentTransitionEdge
    {
        if ($from === IncidentStatus::Resolved) {
            if (($hasAssignee && $to === IncidentStatus::Triaged)
                || (! $hasAssignee && $to === IncidentStatus::InProgress)) {
                throw IncidentDomainException::invalidTransition();
            }
        }

        foreach ($this->edges() as $edge) {
            if ($edge->from === $from && $edge->to === $to) {
                return $edge;
            }
        }

        throw IncidentDomainException::invalidTransition();
    }

    private function edge(string $from, string $to, string $permission, string $command, string $event): IncidentTransitionEdge
    {
        return new IncidentTransitionEdge(
            IncidentStatus::from($from),
            IncidentStatus::from($to),
            $permission,
            $command,
            IncidentEventType::from($event),
        );
    }
}
