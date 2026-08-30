<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('incident_number_sequences', function (Blueprint $table): void {
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->unsignedSmallInteger('ticket_year');
            $table->unsignedInteger('last_value');
            $table->primary(['school_id', 'ticket_year']);
        });

        Schema::create('incidents', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->unsignedSmallInteger('ticket_year');
            $table->unsignedInteger('ticket_sequence');
            $table->string('ticket_number', 20);

            $table->foreignUlid('reporter_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('reporter_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('reporter_user_id_snapshot');
            $table->ulid('reporter_membership_id_snapshot');
            $table->string('reporter_name_snapshot', 255);

            $table->foreignUlid('laboratory_id')->nullable()->constrained('laboratories')->nullOnDelete();
            $table->ulid('laboratory_id_snapshot');
            $table->string('laboratory_code_snapshot', 50);
            $table->string('laboratory_name_snapshot', 255);

            $table->foreignUlid('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->ulid('device_id_snapshot')->nullable();
            $table->string('device_code_snapshot', 32)->nullable();
            $table->string('device_type_snapshot', 32)->nullable();

            $table->string('category', 24);
            $table->string('priority', 16);
            $table->string('title', 200);
            $table->text('description');
            $table->text('impact')->nullable();
            $table->boolean('blocks_laboratory_operation')->default(false);
            $table->text('steps_taken')->nullable();
            $table->timestamp('occurred_at');

            $table->string('status', 24);
            $table->text('triage_summary')->nullable();
            $table->text('resolution_summary')->nullable();
            $table->string('rejection_reason', 1000)->nullable();
            $table->text('verification_note')->nullable();

            $table->foreignUlid('assignee_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('assignee_user_id_snapshot')->nullable();
            $table->string('assignee_name_snapshot', 255)->nullable();

            $table->timestamp('reported_at');
            $table->timestamp('triaged_at')->nullable();
            $table->timestamp('assigned_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'ticket_year', 'ticket_sequence'], 'incidents_school_year_sequence_unique');
            $table->unique(['school_id', 'ticket_number'], 'incidents_school_ticket_unique');
            $table->index(['school_id', 'reported_at', 'id'], 'incidents_school_reported_idx');
            $table->index(['school_id', 'reporter_user_id_snapshot', 'reported_at', 'id'], 'incidents_reporter_scope_idx');
            $table->index(['school_id', 'status', 'reported_at', 'id'], 'incidents_school_status_idx');
            $table->index(['school_id', 'priority', 'reported_at', 'id'], 'incidents_school_priority_idx');
            $table->index(['school_id', 'category', 'reported_at', 'id'], 'incidents_school_category_idx');
            $table->index(['school_id', 'laboratory_id_snapshot', 'reported_at', 'id'], 'incidents_school_lab_idx');
            $table->index(['school_id', 'device_id_snapshot', 'reported_at', 'id'], 'incidents_school_device_idx');
            $table->index(['school_id', 'assignee_membership_id', 'reported_at', 'id'], 'incidents_school_assignee_idx');
        });

        Schema::create('incident_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('incident_id')->nullable()->constrained('incidents')->nullOnDelete();
            $table->ulid('incident_id_snapshot');
            $table->string('ticket_number_snapshot', 20);
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 40);
            $table->unsignedBigInteger('incident_version_before');
            $table->unsignedBigInteger('incident_version_after');
            $table->jsonb('payload');
            $table->timestamp('created_at');

            $table->unique(['incident_id_snapshot', 'incident_version_after'], 'incident_events_snapshot_version_unique');
            $table->index(['school_id', 'incident_id_snapshot', 'created_at', 'id'], 'incident_events_school_incident_idx');
            $table->index(['school_id', 'event_type', 'created_at', 'id'], 'incident_events_school_type_idx');
        });

        Schema::create('incident_submissions', function (Blueprint $table): void {
            $table->ulid('school_id');
            $table->ulid('reporter_user_id_snapshot');
            $table->uuid('submission_id');
            $table->char('payload_fingerprint', 64);
            $table->unsignedSmallInteger('payload_fingerprint_version');
            $table->foreignUlid('incident_id')->nullable()->constrained('incidents')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->foreign('school_id')->references('id')->on('schools')->restrictOnDelete();
            $table->unique(
                ['school_id', 'reporter_user_id_snapshot', 'submission_id'],
                'incident_submissions_reporter_key_unique',
            );
            $table->unique('incident_id', 'incident_submissions_incident_unique');
            $table->index(['school_id', 'reporter_user_id_snapshot', 'created_at'], 'incident_submissions_reporter_idx');
        });

        $this->addIntegrityConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('incident_submissions');
        Schema::dropIfExists('incident_events');
        Schema::dropIfExists('incidents');
        Schema::dropIfExists('incident_number_sequences');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS enforce_incident_event_immutability()');
            DB::statement('DROP FUNCTION IF EXISTS enforce_incident_submission_immutability()');
            DB::statement('DROP FUNCTION IF EXISTS enforce_incident_submission_mapping()');
            DB::statement('DROP FUNCTION IF EXISTS prevent_incident_delete()');
        }
    }

    private function addIntegrityConstraints(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->addPostgresConstraints();
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->addSqliteTriggers();
        }
    }

    private function addPostgresConstraints(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE incident_number_sequences
            ADD CONSTRAINT incident_sequences_year_valid CHECK (ticket_year BETWEEN 2000 AND 9999),
            ADD CONSTRAINT incident_sequences_value_valid CHECK (last_value BETWEEN 1 AND 999999)
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE incidents
            ADD CONSTRAINT incidents_version_positive CHECK (version >= 1),
            ADD CONSTRAINT incidents_ticket_values_valid CHECK (
                ticket_year BETWEEN 2000 AND 9999
                AND ticket_sequence BETWEEN 1 AND 999999
                AND ticket_number = 'INC-' || ticket_year::text || '-' || lpad(ticket_sequence::text, 6, '0')
            ),
            ADD CONSTRAINT incidents_category_valid CHECK (category IN ('hardware','software','network','electrical','peripheral','facility','cleanliness','security','other')),
            ADD CONSTRAINT incidents_priority_valid CHECK (priority IN ('low','normal','high','critical')),
            ADD CONSTRAINT incidents_status_valid CHECK (status IN ('reported','triaged','assigned','in_progress','resolved','verified','closed','rejected')),
            ADD CONSTRAINT incidents_report_text_valid CHECK (
                char_length(btrim(title)) BETWEEN 5 AND 200
                AND char_length(btrim(description)) BETWEEN 10 AND 4000
                AND (impact IS NULL OR char_length(btrim(impact)) BETWEEN 1 AND 2000)
                AND (steps_taken IS NULL OR char_length(btrim(steps_taken)) BETWEEN 1 AND 2000)
            ),
            ADD CONSTRAINT incidents_snapshot_text_valid CHECK (
                char_length(btrim(reporter_name_snapshot)) BETWEEN 1 AND 255
                AND char_length(btrim(laboratory_code_snapshot)) BETWEEN 1 AND 50
                AND char_length(btrim(laboratory_name_snapshot)) BETWEEN 1 AND 255
            ),
            ADD CONSTRAINT incidents_device_snapshot_complete CHECK (
                (device_id_snapshot IS NULL AND device_code_snapshot IS NULL AND device_type_snapshot IS NULL)
                OR (device_id_snapshot IS NOT NULL AND device_code_snapshot IS NOT NULL AND device_type_snapshot IS NOT NULL)
            ),
            ADD CONSTRAINT incidents_assignee_snapshot_complete CHECK (
                ((assignee_user_id_snapshot IS NULL AND assignee_name_snapshot IS NULL)
                    OR (assignee_user_id_snapshot IS NOT NULL AND assignee_name_snapshot IS NOT NULL))
                AND (assignee_membership_id IS NULL OR assignee_user_id_snapshot IS NOT NULL)
            ),
            ADD CONSTRAINT incidents_status_assignee_valid CHECK (
                (status IN ('reported','triaged','rejected') AND assignee_membership_id IS NULL AND assignee_user_id_snapshot IS NULL)
                OR (status IN ('assigned','in_progress') AND assignee_membership_id IS NOT NULL)
                OR status IN ('resolved','verified','closed')
            ),
            ADD CONSTRAINT incidents_assignment_time_valid CHECK (
                assignee_user_id_snapshot IS NULL OR assigned_at IS NOT NULL
            ),
            ADD CONSTRAINT incidents_state_evidence_valid CHECK (
                (status = 'reported' AND triage_summary IS NULL AND triaged_at IS NULL AND assigned_at IS NULL AND started_at IS NULL AND resolution_summary IS NULL AND resolved_at IS NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
                OR (status = 'triaged' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND assigned_at IS NULL AND started_at IS NULL AND resolution_summary IS NULL AND resolved_at IS NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
                OR (status = 'assigned' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND assigned_at IS NOT NULL AND started_at IS NULL AND resolution_summary IS NULL AND resolved_at IS NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
                OR (status = 'in_progress' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND assigned_at IS NOT NULL AND started_at IS NOT NULL AND resolution_summary IS NULL AND resolved_at IS NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
                OR (status = 'resolved' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND resolution_summary IS NOT NULL AND resolved_at IS NOT NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
                OR (status = 'verified' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND resolution_summary IS NOT NULL AND resolved_at IS NOT NULL AND verification_note IS NOT NULL AND verified_at IS NOT NULL AND rejection_reason IS NULL AND rejected_at IS NULL AND closed_at IS NULL)
                OR (status = 'closed' AND triage_summary IS NOT NULL AND triaged_at IS NOT NULL AND resolution_summary IS NOT NULL AND resolved_at IS NOT NULL AND verification_note IS NOT NULL AND verified_at IS NOT NULL AND closed_at IS NOT NULL AND rejection_reason IS NULL AND rejected_at IS NULL)
                OR (status = 'rejected' AND rejection_reason IS NOT NULL AND rejected_at IS NOT NULL AND triage_summary IS NULL AND triaged_at IS NULL AND assigned_at IS NULL AND started_at IS NULL AND resolution_summary IS NULL AND resolved_at IS NULL AND verification_note IS NULL AND verified_at IS NULL AND closed_at IS NULL)
            ),
            ADD CONSTRAINT incidents_lifecycle_text_valid CHECK (
                (triage_summary IS NULL OR char_length(btrim(triage_summary)) BETWEEN 1 AND 2000)
                AND (resolution_summary IS NULL OR char_length(btrim(resolution_summary)) BETWEEN 5 AND 4000)
                AND (rejection_reason IS NULL OR char_length(btrim(rejection_reason)) BETWEEN 5 AND 1000)
                AND (verification_note IS NULL OR char_length(btrim(verification_note)) BETWEEN 1 AND 2000)
            )
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE incident_events
            ADD CONSTRAINT incident_events_type_valid CHECK (event_type IN ('incident.reported','incident.updated','incident.triaged','incident.assigned','incident.reassigned','incident.started','incident.resolved','incident.reopened','incident.verified','incident.closed','incident.rejected','incident.comment_added')),
            ADD CONSTRAINT incident_events_versions_valid CHECK (
                incident_version_after = incident_version_before + 1
                AND ((event_type = 'incident.reported' AND incident_version_before = 0 AND incident_version_after = 1)
                    OR (event_type <> 'incident.reported' AND incident_version_before >= 1))
            ),
            ADD CONSTRAINT incident_events_payload_object CHECK (jsonb_typeof(payload) = 'object'),
            ADD CONSTRAINT incident_events_actor_name_valid CHECK (char_length(btrim(actor_name_snapshot)) BETWEEN 1 AND 255)
        SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE incident_submissions
            ADD CONSTRAINT incident_submissions_fingerprint_valid CHECK (payload_fingerprint ~ '^[0-9a-f]{64}$'),
            ADD CONSTRAINT incident_submissions_version_positive CHECK (payload_fingerprint_version >= 1)
        SQL);
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION enforce_incident_event_immutability() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Incident events are immutable';
                END IF;

                IF NEW.id IS NOT DISTINCT FROM OLD.id
                    AND NEW.school_id IS NOT DISTINCT FROM OLD.school_id
                    AND NEW.incident_id_snapshot IS NOT DISTINCT FROM OLD.incident_id_snapshot
                    AND NEW.ticket_number_snapshot IS NOT DISTINCT FROM OLD.ticket_number_snapshot
                    AND NEW.actor_user_id_snapshot IS NOT DISTINCT FROM OLD.actor_user_id_snapshot
                    AND NEW.actor_membership_id_snapshot IS NOT DISTINCT FROM OLD.actor_membership_id_snapshot
                    AND NEW.actor_name_snapshot IS NOT DISTINCT FROM OLD.actor_name_snapshot
                    AND NEW.event_type IS NOT DISTINCT FROM OLD.event_type
                    AND NEW.incident_version_before IS NOT DISTINCT FROM OLD.incident_version_before
                    AND NEW.incident_version_after IS NOT DISTINCT FROM OLD.incident_version_after
                    AND NEW.payload IS NOT DISTINCT FROM OLD.payload
                    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
                    AND (NEW.incident_id IS NOT DISTINCT FROM OLD.incident_id OR (OLD.incident_id IS NOT NULL AND NEW.incident_id IS NULL))
                    AND (NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id OR (OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL))
                    AND (NEW.actor_membership_id IS NOT DISTINCT FROM OLD.actor_membership_id OR (OLD.actor_membership_id IS NOT NULL AND NEW.actor_membership_id IS NULL)) THEN
                    RETURN NEW;
                END IF;

                RAISE EXCEPTION 'Incident events are immutable except nullable live foreign keys';
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER incident_events_immutable
            BEFORE UPDATE OR DELETE ON incident_events
            FOR EACH ROW EXECUTE FUNCTION enforce_incident_event_immutability();

            CREATE OR REPLACE FUNCTION enforce_incident_submission_immutability() RETURNS trigger AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    RAISE EXCEPTION 'Incident submissions are immutable';
                END IF;
                IF OLD.incident_id IS NOT NULL
                    OR NEW.incident_id IS NULL
                    OR NEW.school_id <> OLD.school_id
                    OR NEW.reporter_user_id_snapshot <> OLD.reporter_user_id_snapshot
                    OR NEW.submission_id <> OLD.submission_id
                    OR NEW.payload_fingerprint <> OLD.payload_fingerprint
                    OR NEW.payload_fingerprint_version <> OLD.payload_fingerprint_version
                    OR NEW.created_at <> OLD.created_at THEN
                    RAISE EXCEPTION 'Incident submissions are immutable after mapping';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER incident_submissions_immutable
            BEFORE UPDATE OR DELETE ON incident_submissions
            FOR EACH ROW EXECUTE FUNCTION enforce_incident_submission_immutability();

            CREATE OR REPLACE FUNCTION enforce_incident_submission_mapping() RETURNS trigger AS $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM incident_submissions
                    WHERE school_id = NEW.school_id
                      AND reporter_user_id_snapshot = NEW.reporter_user_id_snapshot
                      AND submission_id = NEW.submission_id
                      AND incident_id IS NOT NULL
                ) THEN
                    RAISE EXCEPTION 'Committed Incident submission requires an Incident mapping';
                END IF;
                RETURN NULL;
            END;
            $$ LANGUAGE plpgsql;

            CREATE CONSTRAINT TRIGGER incident_submissions_mapping_required
            AFTER INSERT OR UPDATE ON incident_submissions
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION enforce_incident_submission_mapping();

            CREATE OR REPLACE FUNCTION prevent_incident_delete() RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'Incidents cannot be deleted in v1';
            END;
            $$ LANGUAGE plpgsql;

            CREATE TRIGGER incidents_no_delete
            BEFORE DELETE ON incidents
            FOR EACH ROW EXECUTE FUNCTION prevent_incident_delete();
        SQL);
    }

    private function addSqliteTriggers(): void
    {
        foreach (['insert' => 'INSERT', 'update' => 'UPDATE'] as $suffix => $operation) {
            DB::unprepared("CREATE TRIGGER incident_sequences_integrity_{$suffix} BEFORE {$operation} ON incident_number_sequences
                WHEN NEW.ticket_year < 2000 OR NEW.ticket_year > 9999 OR NEW.last_value < 1 OR NEW.last_value > 999999
                BEGIN SELECT RAISE(ABORT, 'Incident sequence integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER incident_submissions_integrity_{$suffix} BEFORE {$operation} ON incident_submissions
                WHEN NEW.payload_fingerprint_version < 1 OR length(NEW.payload_fingerprint) <> 64
                  OR NEW.payload_fingerprint <> lower(NEW.payload_fingerprint)
                  OR NEW.payload_fingerprint GLOB '*[^0-9a-f]*'
                BEGIN SELECT RAISE(ABORT, 'Incident submission integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER incident_events_integrity_{$suffix} BEFORE {$operation} ON incident_events
                WHEN NEW.event_type NOT IN ('incident.reported','incident.updated','incident.triaged','incident.assigned','incident.reassigned','incident.started','incident.resolved','incident.reopened','incident.verified','incident.closed','incident.rejected','incident.comment_added')
                  OR NEW.incident_version_after <> NEW.incident_version_before + 1
                  OR (NEW.event_type = 'incident.reported' AND (NEW.incident_version_before <> 0 OR NEW.incident_version_after <> 1))
                  OR (NEW.event_type <> 'incident.reported' AND NEW.incident_version_before < 1)
                  OR json_valid(NEW.payload) = 0 OR json_type(NEW.payload) <> 'object'
                  OR length(trim(NEW.actor_name_snapshot)) < 1 OR length(NEW.actor_name_snapshot) > 255
                BEGIN SELECT RAISE(ABORT, 'Incident event integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER incidents_integrity_{$suffix} BEFORE {$operation} ON incidents
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
                  OR (NEW.status IN ('assigned','in_progress') AND NEW.assignee_membership_id IS NULL)
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
                BEGIN SELECT RAISE(ABORT, 'Incident integrity constraint failed'); END");
        }

        // SQLite has no deferred constraint triggers. The application transaction owns the
        // create-only submission mapping invariant; PostgreSQL enforces it at commit above.
        DB::unprepared("CREATE TRIGGER incident_events_immutable_update BEFORE UPDATE ON incident_events
            WHEN NOT (
                NEW.id IS OLD.id
                AND NEW.school_id IS OLD.school_id
                AND NEW.incident_id_snapshot IS OLD.incident_id_snapshot
                AND NEW.ticket_number_snapshot IS OLD.ticket_number_snapshot
                AND NEW.actor_user_id_snapshot IS OLD.actor_user_id_snapshot
                AND NEW.actor_membership_id_snapshot IS OLD.actor_membership_id_snapshot
                AND NEW.actor_name_snapshot IS OLD.actor_name_snapshot
                AND NEW.event_type IS OLD.event_type
                AND NEW.incident_version_before IS OLD.incident_version_before
                AND NEW.incident_version_after IS OLD.incident_version_after
                AND NEW.payload IS OLD.payload
                AND NEW.created_at IS OLD.created_at
                AND (NEW.incident_id IS OLD.incident_id OR (OLD.incident_id IS NOT NULL AND NEW.incident_id IS NULL))
                AND (NEW.actor_user_id IS OLD.actor_user_id OR (OLD.actor_user_id IS NOT NULL AND NEW.actor_user_id IS NULL))
                AND (NEW.actor_membership_id IS OLD.actor_membership_id OR (OLD.actor_membership_id IS NOT NULL AND NEW.actor_membership_id IS NULL))
            )
            BEGIN SELECT RAISE(ABORT, 'Incident events are immutable except nullable live foreign keys'); END");
        DB::unprepared("CREATE TRIGGER incident_events_immutable_delete BEFORE DELETE ON incident_events
            BEGIN SELECT RAISE(ABORT, 'Incident events are immutable'); END");
        DB::unprepared("CREATE TRIGGER incident_submissions_immutable_update BEFORE UPDATE ON incident_submissions
            WHEN OLD.incident_id IS NOT NULL OR NEW.incident_id IS NULL
              OR NEW.school_id <> OLD.school_id
              OR NEW.reporter_user_id_snapshot <> OLD.reporter_user_id_snapshot
              OR NEW.submission_id <> OLD.submission_id
              OR NEW.payload_fingerprint <> OLD.payload_fingerprint
              OR NEW.payload_fingerprint_version <> OLD.payload_fingerprint_version
              OR NEW.created_at <> OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'Incident submissions are immutable after mapping'); END");
        DB::unprepared("CREATE TRIGGER incident_submissions_immutable_delete BEFORE DELETE ON incident_submissions
            BEGIN SELECT RAISE(ABORT, 'Incident submissions are immutable'); END");
        DB::unprepared("CREATE TRIGGER incidents_no_delete BEFORE DELETE ON incidents
            BEGIN SELECT RAISE(ABORT, 'Incidents cannot be deleted in v1'); END");
    }
};
