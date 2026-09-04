<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('timetable_publications', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('source_system', 32);
            $table->string('source_publication_id', 128);
            $table->unsignedInteger('source_version');
            $table->string('schema_version', 32);
            $table->string('academic_reference_source', 64);
            $table->string('source_school_id', 128);
            $table->string('source_academic_year_id', 128);
            $table->string('source_semester_id', 128);
            $table->foreignUlid('academic_year_id')->nullable()->constrained('academic_years')->restrictOnDelete();
            $table->foreignUlid('semester_id')->nullable()->constrained('semesters')->restrictOnDelete();
            $table->timestampTz('published_at');
            $table->date('effective_from');
            $table->date('effective_to');
            $table->char('payload_sha256', 64);
            $table->json('source_payload');
            $table->enum('status', ['staged', 'validated', 'active', 'superseded', 'rejected']);
            $table->json('validation_summary')->nullable();
            $table->timestampTz('validated_at')->nullable();
            $table->timestampTz('activated_at')->nullable();
            $table->timestampTz('superseded_at')->nullable();
            $table->ulid('superseded_by_id')->nullable();
            $table->timestamps();

            $table->unique(
                ['school_id', 'source_system', 'source_publication_id', 'source_version'],
                'timetable_publications_source_version_unique',
            );
            $table->index(['school_id', 'semester_id', 'status'], 'timetable_publications_semester_status_idx');
            $table->index(
                ['school_id', 'source_system', 'source_publication_id', 'source_version'],
                'timetable_publications_source_family_idx',
            );
            $table->foreign('superseded_by_id')
                ->references('id')
                ->on('timetable_publications')
                ->restrictOnDelete();
        });

        Schema::create('timetable_entries', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('publication_id')->constrained('timetable_publications')->restrictOnDelete();
            $table->string('source_schedule_id', 128);
            $table->foreignUlid('teacher_id')->constrained('teachers')->restrictOnDelete();
            $table->foreignUlid('academic_class_id')->constrained('academic_classes')->restrictOnDelete();
            $table->foreignUlid('subject_id')->constrained('subjects')->restrictOnDelete();
            $table->foreignUlid('lesson_period_set_id')->constrained('lesson_period_sets')->restrictOnDelete();
            $table->foreignUlid('start_lesson_period_id')->constrained('lesson_periods')->restrictOnDelete();
            $table->foreignUlid('end_lesson_period_id')->constrained('lesson_periods')->restrictOnDelete();
            $table->foreignUlid('planned_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->enum('activity_type', ['practical', 'theory', 'exam', 'other']);
            $table->enum('recurrence_kind', ['weekly', 'single_date']);
            $table->unsignedTinyInteger('weekday')->nullable();
            $table->date('entry_effective_from')->nullable();
            $table->date('entry_effective_to')->nullable();
            $table->date('occurs_on')->nullable();
            $table->time('start_time_snapshot');
            $table->time('end_time_snapshot');
            $table->unsignedSmallInteger('instruction_period_count');
            $table->json('source_snapshots')->nullable();
            $table->timestamps();

            $table->unique(['publication_id', 'source_schedule_id'], 'timetable_entries_source_unique');
            $table->index(['publication_id', 'recurrence_kind'], 'timetable_entries_recurrence_idx');
            $table->index(['school_id', 'planned_laboratory_id'], 'timetable_entries_lab_idx');
        });

        Schema::create('schedule_occurrences', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('publication_id')->constrained('timetable_publications')->restrictOnDelete();
            $table->foreignUlid('entry_id')->constrained('timetable_entries')->restrictOnDelete();
            $table->date('occurs_on');
            $table->foreignUlid('teacher_id')->constrained('teachers')->restrictOnDelete();
            $table->foreignUlid('academic_class_id')->constrained('academic_classes')->restrictOnDelete();
            $table->foreignUlid('subject_id')->constrained('subjects')->restrictOnDelete();
            $table->foreignUlid('planned_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->foreignUlid('lesson_period_set_id')->constrained('lesson_period_sets')->restrictOnDelete();
            $table->foreignUlid('start_lesson_period_id')->constrained('lesson_periods')->restrictOnDelete();
            $table->foreignUlid('end_lesson_period_id')->constrained('lesson_periods')->restrictOnDelete();
            $table->time('start_time_snapshot');
            $table->time('end_time_snapshot');
            $table->enum('activity_type', ['practical', 'theory', 'exam', 'other']);
            $table->timestamps();

            $table->unique(['publication_id', 'entry_id', 'occurs_on'], 'schedule_occurrences_entry_date_unique');
            $table->index(['school_id', 'occurs_on'], 'schedule_occurrences_school_date_idx');
            $table->index(['school_id', 'planned_laboratory_id', 'occurs_on'], 'schedule_occurrences_lab_date_idx');
            $table->index(['school_id', 'teacher_id', 'occurs_on'], 'schedule_occurrences_teacher_date_idx');
            $table->index(['school_id', 'academic_class_id', 'occurs_on'], 'schedule_occurrences_class_date_idx');
        });

        Schema::create('timetable_publication_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('publication_id')->constrained('timetable_publications')->restrictOnDelete();
            $table->string('source_system', 32);
            $table->string('source_publication_id', 128);
            $table->unsignedInteger('source_version');
            $table->char('payload_sha256', 64);
            $table->string('actor_type', 32)->default('user');
            $table->string('actor_id_snapshot', 128)->nullable();
            $table->string('actor_membership_id_snapshot', 128)->nullable();
            $table->string('actor_name_snapshot')->nullable();
            $table->string('event_type', 64);
            $table->json('payload');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'timetable_events_school_time_idx');
            $table->index(['publication_id', 'created_at'], 'timetable_events_publication_time_idx');
            $table->index(['school_id', 'event_type', 'created_at'], 'timetable_events_type_time_idx');
        });

        DB::statement(
            "CREATE UNIQUE INDEX timetable_publications_one_active_per_semester ".
            "ON timetable_publications (school_id, semester_id) WHERE status = 'active'"
        );

        $this->addIntegrityConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('timetable_publication_events');
        Schema::dropIfExists('schedule_occurrences');
        Schema::dropIfExists('timetable_entries');
        Schema::dropIfExists('timetable_publications');
    }

    private function addIntegrityConstraints(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE timetable_publications ADD CONSTRAINT timetable_publications_version_positive CHECK (source_version >= 1)');
            DB::statement('ALTER TABLE timetable_publications ADD CONSTRAINT timetable_publications_effective_range CHECK (effective_from <= effective_to)');
            DB::statement("ALTER TABLE timetable_publications ADD CONSTRAINT timetable_publications_resolved_when_usable CHECK (status IN ('staged', 'rejected') OR (academic_year_id IS NOT NULL AND semester_id IS NOT NULL))");
            DB::statement('ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_weekday_range CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7)');
            DB::statement('ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_time_range CHECK (start_time_snapshot < end_time_snapshot)');
            DB::statement('ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_instruction_count CHECK (instruction_period_count >= 1)');
            DB::statement("ALTER TABLE timetable_entries ADD CONSTRAINT timetable_entries_recurrence_shape CHECK ((recurrence_kind = 'weekly' AND weekday IS NOT NULL AND entry_effective_from IS NOT NULL AND entry_effective_to IS NOT NULL AND occurs_on IS NULL AND entry_effective_from <= entry_effective_to) OR (recurrence_kind = 'single_date' AND weekday IS NULL AND entry_effective_from IS NULL AND entry_effective_to IS NULL AND occurs_on IS NOT NULL))");
            DB::statement('ALTER TABLE schedule_occurrences ADD CONSTRAINT schedule_occurrences_time_range CHECK (start_time_snapshot < end_time_snapshot)');
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER timetable_publications_integrity_insert BEFORE INSERT ON timetable_publications WHEN NEW.source_version < 1 OR NEW.effective_from > NEW.effective_to OR (NEW.status NOT IN ('staged', 'rejected') AND (NEW.academic_year_id IS NULL OR NEW.semester_id IS NULL)) BEGIN SELECT RAISE(ABORT, 'Timetable publication integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER timetable_publications_integrity_update BEFORE UPDATE ON timetable_publications WHEN NEW.source_version < 1 OR NEW.effective_from > NEW.effective_to OR (NEW.status NOT IN ('staged', 'rejected') AND (NEW.academic_year_id IS NULL OR NEW.semester_id IS NULL)) BEGIN SELECT RAISE(ABORT, 'Timetable publication integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER timetable_entries_integrity_insert BEFORE INSERT ON timetable_entries WHEN (NEW.weekday IS NOT NULL AND (NEW.weekday < 1 OR NEW.weekday > 7)) OR NEW.start_time_snapshot >= NEW.end_time_snapshot OR NEW.instruction_period_count < 1 OR NOT ((NEW.recurrence_kind = 'weekly' AND NEW.weekday IS NOT NULL AND NEW.entry_effective_from IS NOT NULL AND NEW.entry_effective_to IS NOT NULL AND NEW.occurs_on IS NULL AND NEW.entry_effective_from <= NEW.entry_effective_to) OR (NEW.recurrence_kind = 'single_date' AND NEW.weekday IS NULL AND NEW.entry_effective_from IS NULL AND NEW.entry_effective_to IS NULL AND NEW.occurs_on IS NOT NULL)) BEGIN SELECT RAISE(ABORT, 'Timetable entry integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER timetable_entries_integrity_update BEFORE UPDATE ON timetable_entries WHEN (NEW.weekday IS NOT NULL AND (NEW.weekday < 1 OR NEW.weekday > 7)) OR NEW.start_time_snapshot >= NEW.end_time_snapshot OR NEW.instruction_period_count < 1 OR NOT ((NEW.recurrence_kind = 'weekly' AND NEW.weekday IS NOT NULL AND NEW.entry_effective_from IS NOT NULL AND NEW.entry_effective_to IS NOT NULL AND NEW.occurs_on IS NULL AND NEW.entry_effective_from <= NEW.entry_effective_to) OR (NEW.recurrence_kind = 'single_date' AND NEW.weekday IS NULL AND NEW.entry_effective_from IS NULL AND NEW.entry_effective_to IS NULL AND NEW.occurs_on IS NOT NULL)) BEGIN SELECT RAISE(ABORT, 'Timetable entry integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER schedule_occurrences_integrity_insert BEFORE INSERT ON schedule_occurrences WHEN NEW.start_time_snapshot >= NEW.end_time_snapshot BEGIN SELECT RAISE(ABORT, 'Schedule occurrence integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER schedule_occurrences_integrity_update BEFORE UPDATE ON schedule_occurrences WHEN NEW.start_time_snapshot >= NEW.end_time_snapshot BEGIN SELECT RAISE(ABORT, 'Schedule occurrence integrity constraint failed'); END");
        }
    }
};
