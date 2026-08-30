<?php

namespace Tests\Unit;

use App\Domain\Incident\IncidentDomainException;
use App\Domain\Incident\IncidentLifecyclePolicy;
use App\Domain\Incident\IncidentStatus;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class IncidentLifecyclePolicyTest extends TestCase
{
    #[DataProvider('validEdges')]
    public function test_every_locked_edge_resolves_to_exact_permission_and_command(
        string $from,
        string $to,
        bool $hasAssignee,
        string $permission,
        string $command,
    ): void {
        $edge = (new IncidentLifecyclePolicy)->resolve(
            IncidentStatus::from($from),
            IncidentStatus::from($to),
            $hasAssignee,
        );

        $this->assertSame($permission, $edge->permission);
        $this->assertSame($command, $edge->command);
    }

    public static function validEdges(): array
    {
        return [
            ['reported', 'triaged', false, 'incidents.approve', 'transition'],
            ['reported', 'rejected', false, 'incidents.approve', 'transition'],
            ['triaged', 'assigned', false, 'incidents.assign', 'assignment'],
            ['triaged', 'resolved', false, 'incidents.approve', 'transition'],
            ['assigned', 'in_progress', true, 'incidents.update', 'transition'],
            ['assigned', 'resolved', true, 'incidents.update', 'transition'],
            ['in_progress', 'resolved', true, 'incidents.update', 'transition'],
            ['resolved', 'verified', false, 'incidents.approve', 'transition'],
            ['resolved', 'in_progress', true, 'incidents.approve', 'transition'],
            ['resolved', 'triaged', false, 'incidents.approve', 'transition'],
            ['verified', 'closed', false, 'incidents.approve', 'transition'],
        ];
    }

    #[DataProvider('forbiddenEdges')]
    public function test_forbidden_and_path_incompatible_edges_are_rejected(string $from, string $to, bool $hasAssignee): void
    {
        try {
            (new IncidentLifecyclePolicy)->resolve(IncidentStatus::from($from), IncidentStatus::from($to), $hasAssignee);
            $this->fail('Expected an invalid-transition domain error.');
        } catch (IncidentDomainException $exception) {
            $this->assertSame('INCIDENT_INVALID_TRANSITION', $exception->errorCode);
        }
    }

    public static function forbiddenEdges(): array
    {
        return [
            ['reported', 'closed', false],
            ['resolved', 'triaged', true],
            ['resolved', 'in_progress', false],
            ['closed', 'reported', false],
            ['rejected', 'triaged', false],
        ];
    }

    public function test_closed_and_rejected_are_terminal_and_waiting_spare_part_does_not_exist(): void
    {
        $this->assertTrue(IncidentStatus::Closed->isTerminal());
        $this->assertTrue(IncidentStatus::Rejected->isTerminal());
        $this->assertFalse(IncidentStatus::Reported->isTerminal());
        $this->assertNotContains('waiting_spare_part', IncidentStatus::values());
    }
}
