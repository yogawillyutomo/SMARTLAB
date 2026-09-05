<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_reports', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('report_number', 48);
            $table->enum('origin', ['session', 'manual_backfill']);
            $table->foreignUlid('session_id')->nullable()->constrained('laboratory_sessions')->restrictOnDelete();
            $table->foreignUlid('owner_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();
            $table->text('manual_backfill_reason')->nullable();

            $table->enum('report_type', ['practicum', 'exam', 'workshop', 'general']);
            $table->enum('status', ['draft', 'submitted', 'revision_required', 'verified']);

            $table->foreignUlid('laboratory_id')->constrained('laboratories')->restrictOnDelete();
            $table->date('occurred_on');
            $table->json('source_snapshot');
            $table->json('session_snapshot')->nullable();

            $table->foreignUlid('responsible_teacher_id')->nullable()->constrained('teachers')->restrictOnDelete();
            $table->string('responsible_name_snapshot');
            $table->foreignUlid('academic_class_id')->nullable()->constrained('academic_classes')->restrictOnDelete();
            $table->foreignUlid('subject_id')->nullable()->constrained('subjects')->restrictOnDelete();

            $table->unsignedSmallInteger('planned_participant_count')->nullable();
            $table->unsignedSmallInteger('present_count')->nullable();
            $table->unsignedSmallInteger('absent_count')->nullable();
            $table->text('attendance_notes')->nullable();
            $table->string('external_attendance_system', 128)->nullable();
            $table->string('external_attendance_reference_id', 255)->nullable();

            $table->json('common_content');
            $table->json('type_specific_content');
            $table->text('revision_reason')->nullable();

            $table->timestampTz('submitted_at')->nullable();
            $table->foreignUlid('submitted_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('submitted_by_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();
            $table->timestampTz('verified_at')->nullable();
            $table->foreignUlid('verified_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('verified_by_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();

            $table->foreignUlid('created_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('created_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'report_number'], 'activity_reports_school_number_unique');
            $table->unique('session_id', 'activity_reports_session_unique');
            $table->index(['school_id', 'occurred_on', 'status'], 'activity_reports_school_date_status_idx');
            $table->index(['school_id', 'laboratory_id', 'occurred_on'], 'activity_reports_lab_date_idx');
            $table->index(['school_id', 'owner_membership_id', 'occurred_on'], 'activity_reports_owner_date_idx');
            $table->index(['school_id', 'report_type', 'status'], 'activity_reports_type_status_idx');
        });

        Schema::create('activity_report_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('report_id')->constrained('activity_reports')->restrictOnDelete();
            $table->string('actor_user_id_snapshot', 128);
            $table->string('actor_membership_id_snapshot', 128);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'activity_report_events_school_time_idx');
            $table->index(['report_id', 'created_at'], 'activity_report_events_entity_time_idx');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE activity_reports ADD CONSTRAINT activity_reports_version_positive CHECK (version >= 1)');
            DB::statement('ALTER TABLE activity_reports ADD CONSTRAINT activity_reports_counts_nonnegative CHECK ((planned_participant_count IS NULL OR planned_participant_count >= 0) AND (present_count IS NULL OR present_count >= 0) AND (absent_count IS NULL OR absent_count >= 0))');
            DB::statement("ALTER TABLE activity_reports ADD CONSTRAINT activity_reports_origin_shape CHECK (
                (origin = 'session' AND session_id IS NOT NULL AND manual_backfill_reason IS NULL AND session_snapshot IS NOT NULL)
                OR (origin = 'manual_backfill' AND session_id IS NULL AND manual_backfill_reason IS NOT NULL AND session_snapshot IS NULL)
            )");
            DB::statement("ALTER TABLE activity_reports ADD CONSTRAINT activity_reports_status_shape CHECK (
                (status = 'draft' AND submitted_at IS NULL AND verified_at IS NULL AND revision_reason IS NULL)
                OR (status = 'submitted' AND submitted_at IS NOT NULL AND verified_at IS NULL AND revision_reason IS NULL)
                OR (status = 'revision_required' AND submitted_at IS NOT NULL AND verified_at IS NULL AND revision_reason IS NOT NULL)
                OR (status = 'verified' AND submitted_at IS NOT NULL AND verified_at IS NOT NULL AND revision_reason IS NULL)
            )");
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER activity_reports_integrity_insert BEFORE INSERT ON activity_reports WHEN NEW.version < 1 OR (NEW.planned_participant_count IS NOT NULL AND NEW.planned_participant_count < 0) OR (NEW.present_count IS NOT NULL AND NEW.present_count < 0) OR (NEW.absent_count IS NOT NULL AND NEW.absent_count < 0) OR NOT (
                (NEW.origin = 'session' AND NEW.session_id IS NOT NULL AND NEW.manual_backfill_reason IS NULL AND NEW.session_snapshot IS NOT NULL)
                OR (NEW.origin = 'manual_backfill' AND NEW.session_id IS NULL AND NEW.manual_backfill_reason IS NOT NULL AND NEW.session_snapshot IS NULL)
            ) OR NOT (
                (NEW.status = 'draft' AND NEW.submitted_at IS NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NULL)
                OR (NEW.status = 'submitted' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NULL)
                OR (NEW.status = 'revision_required' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NOT NULL)
                OR (NEW.status = 'verified' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NOT NULL AND NEW.revision_reason IS NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Activity report integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER activity_reports_integrity_update BEFORE UPDATE ON activity_reports WHEN NEW.version < 1 OR (NEW.planned_participant_count IS NOT NULL AND NEW.planned_participant_count < 0) OR (NEW.present_count IS NOT NULL AND NEW.present_count < 0) OR (NEW.absent_count IS NOT NULL AND NEW.absent_count < 0) OR NOT (
                (NEW.origin = 'session' AND NEW.session_id IS NOT NULL AND NEW.manual_backfill_reason IS NULL AND NEW.session_snapshot IS NOT NULL)
                OR (NEW.origin = 'manual_backfill' AND NEW.session_id IS NULL AND NEW.manual_backfill_reason IS NOT NULL AND NEW.session_snapshot IS NULL)
            ) OR NOT (
                (NEW.status = 'draft' AND NEW.submitted_at IS NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NULL)
                OR (NEW.status = 'submitted' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NULL)
                OR (NEW.status = 'revision_required' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NULL AND NEW.revision_reason IS NOT NULL)
                OR (NEW.status = 'verified' AND NEW.submitted_at IS NOT NULL AND NEW.verified_at IS NOT NULL AND NEW.revision_reason IS NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Activity report integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_report_events');
        Schema::dropIfExists('activity_reports');
    }
};
