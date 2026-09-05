<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('schedule_exceptions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('occurrence_id')->constrained('schedule_occurrences')->restrictOnDelete();
            $table->foreignUlid('publication_id')->constrained('timetable_publications')->restrictOnDelete();
            $table->foreignUlid('entry_id')->constrained('timetable_entries')->restrictOnDelete();
            $table->date('occurs_on');
            $table->string('source_publication_id_snapshot', 128);
            $table->unsignedInteger('source_version_snapshot');
            $table->string('source_schedule_id_snapshot', 128);
            $table->enum('resolution', ['cancel', 'relocate']);
            $table->foreignUlid('original_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->foreignUlid('replacement_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->text('reason');
            $table->enum('status', ['active', 'cancelled'])->default('active');
            $table->foreignUlid('approved_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('approved_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->string('approved_by_name_snapshot');
            $table->timestampTz('cancelled_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->index(['school_id', 'occurs_on', 'status'], 'schedule_exceptions_school_date_status_idx');
            $table->index(['school_id', 'replacement_laboratory_id', 'occurs_on', 'status'], 'schedule_exceptions_replacement_date_idx');
            $table->index(['school_id', 'occurrence_id'], 'schedule_exceptions_occurrence_idx');
        });

        DB::statement(
            "CREATE UNIQUE INDEX schedule_exceptions_one_active_per_occurrence ".
            "ON schedule_exceptions (occurrence_id) WHERE status = 'active'"
        );

        Schema::create('schedule_exception_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('schedule_exception_id')->constrained('schedule_exceptions')->restrictOnDelete();
            $table->string('actor_user_id_snapshot', 128);
            $table->string('actor_membership_id_snapshot', 128);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'schedule_exception_events_school_time_idx');
            $table->index(['schedule_exception_id', 'created_at'], 'schedule_exception_events_entity_time_idx');
        });

        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_source_version_positive CHECK (source_version_snapshot >= 1)');
            DB::statement('ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_version_positive CHECK (version >= 1)');
            DB::statement("ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_resolution_shape CHECK (
                (resolution = 'cancel' AND replacement_laboratory_id IS NULL)
                OR (resolution = 'relocate' AND replacement_laboratory_id IS NOT NULL)
            )");
            DB::statement("ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_status_shape CHECK (
                (status = 'active' AND cancelled_at IS NULL)
                OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
            )");
            DB::statement('ALTER TABLE schedule_exceptions ADD CONSTRAINT schedule_exceptions_relocation_distinct CHECK (replacement_laboratory_id IS NULL OR replacement_laboratory_id <> original_laboratory_id)');
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER schedule_exceptions_integrity_insert BEFORE INSERT ON schedule_exceptions WHEN
                NEW.source_version_snapshot < 1 OR NEW.version < 1
                OR NOT ((NEW.resolution = 'cancel' AND NEW.replacement_laboratory_id IS NULL) OR (NEW.resolution = 'relocate' AND NEW.replacement_laboratory_id IS NOT NULL))
                OR NOT ((NEW.status = 'active' AND NEW.cancelled_at IS NULL) OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL))
                OR (NEW.replacement_laboratory_id IS NOT NULL AND NEW.replacement_laboratory_id = NEW.original_laboratory_id)
                BEGIN SELECT RAISE(ABORT, 'Schedule exception integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER schedule_exceptions_integrity_update BEFORE UPDATE ON schedule_exceptions WHEN
                NEW.source_version_snapshot < 1 OR NEW.version < 1
                OR NOT ((NEW.resolution = 'cancel' AND NEW.replacement_laboratory_id IS NULL) OR (NEW.resolution = 'relocate' AND NEW.replacement_laboratory_id IS NOT NULL))
                OR NOT ((NEW.status = 'active' AND NEW.cancelled_at IS NULL) OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL))
                OR (NEW.replacement_laboratory_id IS NOT NULL AND NEW.replacement_laboratory_id = NEW.original_laboratory_id)
                BEGIN SELECT RAISE(ABORT, 'Schedule exception integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('schedule_exception_events');
        Schema::dropIfExists('schedule_exceptions');
    }
};
