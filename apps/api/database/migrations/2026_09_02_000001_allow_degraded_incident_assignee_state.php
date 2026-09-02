<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const POSTGRES_CONSTRAINT = 'incidents_status_assignee_valid';

    public function up(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            $this->replacePostgresConstraint(requireLiveMembership: false);

            return;
        }

        if ($driver === 'sqlite') {
            $this->recreateSqliteIncidentIntegrityTriggers(requireLiveMembership: false);

            return;
        }

        throw new RuntimeException("Unsupported database driver [{$driver}] for Incident assignee integrity migration.");
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            $this->replacePostgresConstraint(requireLiveMembership: true);

            return;
        }

        if ($driver === 'sqlite') {
            $this->recreateSqliteIncidentIntegrityTriggers(requireLiveMembership: true);

            return;
        }

        throw new RuntimeException("Unsupported database driver [{$driver}] for Incident assignee integrity rollback.");
    }

    private function replacePostgresConstraint(bool $requireLiveMembership): void
    {
        DB::statement('ALTER TABLE incidents DROP CONSTRAINT '.self::POSTGRES_CONSTRAINT);

        $assignedRequirement = $requireLiveMembership
            ? 'assignee_membership_id IS NOT NULL'
            : 'assignee_user_id_snapshot IS NOT NULL';

        DB::statement(
            'ALTER TABLE incidents ADD CONSTRAINT '.self::POSTGRES_CONSTRAINT.' CHECK ('
            ."(status IN ('reported','triaged','rejected') "
            .'AND assignee_membership_id IS NULL AND assignee_user_id_snapshot IS NULL) '
            ."OR (status IN ('assigned','in_progress') AND {$assignedRequirement}) "
            ."OR status IN ('resolved','verified','closed')"
            .')'
        );
    }

    private function recreateSqliteIncidentIntegrityTriggers(bool $requireLiveMembership): void
    {
        $assigneeViolation = $requireLiveMembership
            ? "OR (NEW.status IN ('assigned','in_progress') AND NEW.assignee_membership_id IS NULL)"
            : "OR (NEW.status IN ('assigned','in_progress') AND NEW.assignee_user_id_snapshot IS NULL)";

        foreach (['insert' => 'INSERT', 'update' => 'UPDATE'] as $suffix => $operation) {
            DB::unprepared("DROP TRIGGER IF EXISTS incidents_integrity_{$suffix}");

            DB::unprepared(<<<SQL
                CREATE TRIGGER incidents_integrity_{$suffix} BEFORE {$operation} ON incidents
                WHEN NEW.version < 1 OR NEW.ticket_year < 2000 OR NEW.ticket_year > 9999
                  OR NEW.ticket_sequence < 1 OR NEW.ticket_sequence > 999999
                  OR NEW.ticket_number <> ('INC-' || NEW.ticket_year || '-' || printf('%06d', NEW.ticket_sequence))
                  OR NEW.category NOT IN ('hardware','software','network','electrical','peripheral','facility','cleanliness','security','other')
                  OR NEW.priority NOT IN ('low','normal','high','critical')
                  OR NEW.status NOT IN ('reported','triaged','assigned','in_progress','resolved','verified','closed','rejected')
                  OR length(trim(NEW.title)) < 5 OR length(NEW.title) > 200
                  OR length(trim(NEW.description)) < 10 OR length(NEW.description) > 4000
                  OR (NEW.impact IS NOT NULL AND (length(trim(NEW.impact)) < 1 OR length(NEW.impact) > 2000))
                  OR (NEW.steps_taken IS NOT NULL AND (length(trim(NEW.steps_taken)) < 1 OR length(NEW.steps_taken) > 2000))
                  OR NOT ((NEW.device_id_snapshot IS NULL AND NEW.device_code_snapshot IS NULL AND NEW.device_type_snapshot IS NULL) OR (NEW.device_id_snapshot IS NOT NULL AND NEW.device_code_snapshot IS NOT NULL AND NEW.device_type_snapshot IS NOT NULL))
                  OR NOT ((NEW.assignee_user_id_snapshot IS NULL AND NEW.assignee_name_snapshot IS NULL) OR (NEW.assignee_user_id_snapshot IS NOT NULL AND NEW.assignee_name_snapshot IS NOT NULL))
                  OR (NEW.assignee_membership_id IS NOT NULL AND NEW.assignee_user_id_snapshot IS NULL)
                  OR (NEW.status IN ('reported','triaged','rejected') AND (NEW.assignee_membership_id IS NOT NULL OR NEW.assignee_user_id_snapshot IS NOT NULL))
                  {$assigneeViolation}
                  OR (NEW.assignee_user_id_snapshot IS NOT NULL AND NEW.assigned_at IS NULL)
                  OR (NEW.status = 'in_progress' AND NEW.started_at IS NULL)
                  OR (NEW.status = 'reported' AND (NEW.triage_summary IS NOT NULL OR NEW.triaged_at IS NOT NULL OR NEW.resolution_summary IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.verification_note IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.closed_at IS NOT NULL))
                  OR (NEW.status IN ('reported','triaged','rejected') AND (NEW.assigned_at IS NOT NULL OR NEW.started_at IS NOT NULL))
                  OR (NEW.status = 'assigned' AND NEW.started_at IS NOT NULL)
                  OR (NEW.status IN ('triaged','assigned','in_progress','resolved','verified','closed') AND (NEW.triage_summary IS NULL OR NEW.triaged_at IS NULL))
                  OR (NEW.status IN ('resolved','verified','closed') AND (NEW.resolution_summary IS NULL OR NEW.resolved_at IS NULL))
                  OR (NEW.status IN ('verified','closed') AND (NEW.verification_note IS NULL OR NEW.verified_at IS NULL))
                  OR (NEW.status = 'closed' AND NEW.closed_at IS NULL)
                  OR (NEW.status = 'rejected' AND (NEW.rejection_reason IS NULL OR NEW.rejected_at IS NULL))
                  OR (NEW.status IN ('triaged','assigned','in_progress') AND (NEW.resolution_summary IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NEW.rejection_reason IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.verification_note IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.closed_at IS NOT NULL))
                  OR (NEW.status = 'resolved' AND (NEW.rejection_reason IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.verification_note IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.closed_at IS NOT NULL))
                  OR (NEW.status = 'verified' AND (NEW.rejection_reason IS NOT NULL OR NEW.rejected_at IS NOT NULL OR NEW.closed_at IS NOT NULL))
                  OR (NEW.status = 'closed' AND (NEW.rejection_reason IS NOT NULL OR NEW.rejected_at IS NOT NULL))
                  OR (NEW.status = 'rejected' AND (NEW.triage_summary IS NOT NULL OR NEW.triaged_at IS NOT NULL OR NEW.resolution_summary IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NEW.verification_note IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.closed_at IS NOT NULL))
                  OR (NEW.triage_summary IS NOT NULL AND (length(trim(NEW.triage_summary)) < 1 OR length(NEW.triage_summary) > 2000))
                  OR (NEW.resolution_summary IS NOT NULL AND (length(trim(NEW.resolution_summary)) < 5 OR length(NEW.resolution_summary) > 4000))
                  OR (NEW.rejection_reason IS NOT NULL AND (length(trim(NEW.rejection_reason)) < 5 OR length(NEW.rejection_reason) > 1000))
                  OR (NEW.verification_note IS NOT NULL AND (length(trim(NEW.verification_note)) < 1 OR length(NEW.verification_note) > 2000))
                BEGIN SELECT RAISE(ABORT, 'Incident integrity constraint failed'); END
            SQL);
        }
    }
};
