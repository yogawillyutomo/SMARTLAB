<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('laboratory_sessions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('session_number', 48);

            $table->enum('source_type', ['schedule_occurrence', 'laboratory_reservation', 'priority_event']);
            $table->foreignUlid('schedule_occurrence_id')->nullable()->constrained('schedule_occurrences')->restrictOnDelete();
            $table->foreignUlid('reservation_id')->nullable()->constrained('laboratory_reservations')->restrictOnDelete();
            $table->foreignUlid('priority_event_id')->nullable()->constrained('priority_events')->restrictOnDelete();
            $table->foreignUlid('source_publication_id')->nullable()->constrained('timetable_publications')->restrictOnDelete();
            $table->unsignedInteger('source_version_evidence');
            $table->char('source_fingerprint', 64);
            $table->json('source_evidence');
            $table->foreignUlid('source_owner_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();

            $table->foreignUlid('laboratory_id')->constrained('laboratories')->restrictOnDelete();
            $table->date('source_date');
            $table->time('source_starts_at');
            $table->time('source_ends_at');
            $table->enum('activity_kind', ['practical', 'theory', 'exam', 'other']);
            $table->foreignUlid('responsible_teacher_id')->nullable()->constrained('teachers')->restrictOnDelete();
            $table->string('responsible_name_snapshot');
            $table->foreignUlid('academic_class_id')->nullable()->constrained('academic_classes')->restrictOnDelete();
            $table->foreignUlid('subject_id')->nullable()->constrained('subjects')->restrictOnDelete();
            $table->unsignedSmallInteger('planned_participant_count')->nullable();

            $table->enum('status', ['prepared', 'in_progress', 'ended', 'cancelled']);
            $table->text('opening_condition')->nullable();
            $table->text('closing_condition')->nullable();
            $table->enum('end_outcome', ['completed', 'interrupted'])->nullable();
            $table->text('operational_notes')->nullable();

            $table->foreignUlid('prepared_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('prepared_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->foreignUlid('started_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('started_by_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();
            $table->foreignUlid('ended_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('ended_by_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();

            $table->timestampTz('actual_started_at')->nullable();
            $table->timestampTz('actual_ended_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancellation_reason')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'session_number'], 'laboratory_sessions_school_number_unique');
            $table->index(['school_id', 'source_date', 'status'], 'laboratory_sessions_school_date_status_idx');
            $table->index(['school_id', 'laboratory_id', 'source_date', 'status'], 'laboratory_sessions_lab_date_status_idx');
            $table->index(['school_id', 'source_type', 'status'], 'laboratory_sessions_source_status_idx');
            $table->index(['school_id', 'source_publication_id', 'status'], 'laboratory_sessions_publication_status_idx');
            $table->index(['school_id', 'source_owner_membership_id', 'source_date'], 'laboratory_sessions_owner_date_idx');
        });

        Schema::create('laboratory_session_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('session_id')->constrained('laboratory_sessions')->restrictOnDelete();
            $table->string('actor_user_id_snapshot', 128);
            $table->string('actor_membership_id_snapshot', 128);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'laboratory_session_events_school_time_idx');
            $table->index(['session_id', 'created_at'], 'laboratory_session_events_entity_time_idx');
        });

        DB::statement("CREATE UNIQUE INDEX laboratory_sessions_schedule_source_unique ON laboratory_sessions (school_id, schedule_occurrence_id) WHERE schedule_occurrence_id IS NOT NULL AND status IN ('prepared','in_progress','ended')");
        DB::statement("CREATE UNIQUE INDEX laboratory_sessions_reservation_source_unique ON laboratory_sessions (school_id, reservation_id) WHERE reservation_id IS NOT NULL AND status IN ('prepared','in_progress','ended')");
        DB::statement("CREATE UNIQUE INDEX laboratory_sessions_priority_source_unique ON laboratory_sessions (school_id, priority_event_id) WHERE priority_event_id IS NOT NULL AND status IN ('prepared','in_progress','ended')");

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_source_version_positive CHECK (source_version_evidence >= 1)');
            DB::statement('ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_version_positive CHECK (version >= 1)');
            DB::statement('ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_source_time_range CHECK (source_starts_at < source_ends_at)');
            DB::statement('ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_participant_count_nonnegative CHECK (planned_participant_count IS NULL OR planned_participant_count >= 0)');
            DB::statement("ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_source_shape CHECK (
                (source_type = 'schedule_occurrence' AND schedule_occurrence_id IS NOT NULL AND reservation_id IS NULL AND priority_event_id IS NULL AND source_publication_id IS NOT NULL)
                OR (source_type = 'laboratory_reservation' AND schedule_occurrence_id IS NULL AND reservation_id IS NOT NULL AND priority_event_id IS NULL AND source_publication_id IS NULL)
                OR (source_type = 'priority_event' AND schedule_occurrence_id IS NULL AND reservation_id IS NULL AND priority_event_id IS NOT NULL AND source_publication_id IS NULL)
            )");
            DB::statement("ALTER TABLE laboratory_sessions ADD CONSTRAINT laboratory_sessions_status_shape CHECK (
                (status = 'prepared' AND actual_started_at IS NULL AND actual_ended_at IS NULL AND end_outcome IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
                OR (status = 'in_progress' AND actual_started_at IS NOT NULL AND actual_ended_at IS NULL AND end_outcome IS NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
                OR (status = 'ended' AND actual_started_at IS NOT NULL AND actual_ended_at IS NOT NULL AND actual_ended_at >= actual_started_at AND end_outcome IS NOT NULL AND cancelled_at IS NULL AND cancellation_reason IS NULL)
                OR (status = 'cancelled' AND actual_started_at IS NULL AND actual_ended_at IS NULL AND end_outcome IS NULL AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
            )");
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER laboratory_sessions_integrity_insert BEFORE INSERT ON laboratory_sessions WHEN NEW.source_version_evidence < 1 OR NEW.version < 1 OR NEW.source_starts_at >= NEW.source_ends_at OR (NEW.planned_participant_count IS NOT NULL AND NEW.planned_participant_count < 0) OR NOT (
                (NEW.source_type = 'schedule_occurrence' AND NEW.schedule_occurrence_id IS NOT NULL AND NEW.reservation_id IS NULL AND NEW.priority_event_id IS NULL AND NEW.source_publication_id IS NOT NULL)
                OR (NEW.source_type = 'laboratory_reservation' AND NEW.schedule_occurrence_id IS NULL AND NEW.reservation_id IS NOT NULL AND NEW.priority_event_id IS NULL AND NEW.source_publication_id IS NULL)
                OR (NEW.source_type = 'priority_event' AND NEW.schedule_occurrence_id IS NULL AND NEW.reservation_id IS NULL AND NEW.priority_event_id IS NOT NULL AND NEW.source_publication_id IS NULL)
            ) OR NOT (
                (NEW.status = 'prepared' AND NEW.actual_started_at IS NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'in_progress' AND NEW.actual_started_at IS NOT NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'ended' AND NEW.actual_started_at IS NOT NULL AND NEW.actual_ended_at IS NOT NULL AND NEW.actual_ended_at >= NEW.actual_started_at AND NEW.end_outcome IS NOT NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'cancelled' AND NEW.actual_started_at IS NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NOT NULL AND NEW.cancellation_reason IS NOT NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Laboratory session integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER laboratory_sessions_integrity_update BEFORE UPDATE ON laboratory_sessions WHEN NEW.source_version_evidence < 1 OR NEW.version < 1 OR NEW.source_starts_at >= NEW.source_ends_at OR (NEW.planned_participant_count IS NOT NULL AND NEW.planned_participant_count < 0) OR NOT (
                (NEW.source_type = 'schedule_occurrence' AND NEW.schedule_occurrence_id IS NOT NULL AND NEW.reservation_id IS NULL AND NEW.priority_event_id IS NULL AND NEW.source_publication_id IS NOT NULL)
                OR (NEW.source_type = 'laboratory_reservation' AND NEW.schedule_occurrence_id IS NULL AND NEW.reservation_id IS NOT NULL AND NEW.priority_event_id IS NULL AND NEW.source_publication_id IS NULL)
                OR (NEW.source_type = 'priority_event' AND NEW.schedule_occurrence_id IS NULL AND NEW.reservation_id IS NULL AND NEW.priority_event_id IS NOT NULL AND NEW.source_publication_id IS NULL)
            ) OR NOT (
                (NEW.status = 'prepared' AND NEW.actual_started_at IS NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'in_progress' AND NEW.actual_started_at IS NOT NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'ended' AND NEW.actual_started_at IS NOT NULL AND NEW.actual_ended_at IS NOT NULL AND NEW.actual_ended_at >= NEW.actual_started_at AND NEW.end_outcome IS NOT NULL AND NEW.cancelled_at IS NULL AND NEW.cancellation_reason IS NULL)
                OR (NEW.status = 'cancelled' AND NEW.actual_started_at IS NULL AND NEW.actual_ended_at IS NULL AND NEW.end_outcome IS NULL AND NEW.cancelled_at IS NOT NULL AND NEW.cancellation_reason IS NOT NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Laboratory session integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('laboratory_session_events');
        Schema::dropIfExists('laboratory_sessions');
    }
};
