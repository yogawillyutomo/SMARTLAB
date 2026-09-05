<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('operational_calendar_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->enum('scope', ['school', 'laboratory']);
            $table->foreignUlid('laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->enum('category', [
                'effective_day', 'holiday', 'exam', 'school_event', 'maintenance',
                'laboratory_closure', 'school_closure', 'workshop', 'competition', 'meeting', 'other',
            ]);
            $table->enum('availability_effect', ['informational', 'blocked']);
            $table->string('title');
            $table->text('description')->nullable();
            $table->date('starts_on');
            $table->date('ends_on');
            $table->boolean('all_day')->default(true);
            $table->time('starts_at')->nullable();
            $table->time('ends_at')->nullable();
            $table->enum('status', ['active', 'cancelled'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['school_id', 'starts_on', 'ends_on'], 'calendar_events_school_dates_idx');
            $table->index(['school_id', 'scope', 'laboratory_id', 'status'], 'calendar_events_scope_status_idx');
            $table->index(['school_id', 'availability_effect', 'status'], 'calendar_events_effect_status_idx');
        });

        Schema::create('operational_calendar_event_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('calendar_event_id')->constrained('operational_calendar_events')->restrictOnDelete();
            $table->string('actor_user_id_snapshot', 128);
            $table->string('actor_membership_id_snapshot', 128);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'calendar_event_events_school_time_idx');
            $table->index(['calendar_event_id', 'created_at'], 'calendar_event_events_entity_time_idx');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE operational_calendar_events ADD CONSTRAINT calendar_events_date_range CHECK (starts_on <= ends_on)');
            DB::statement("ALTER TABLE operational_calendar_events ADD CONSTRAINT calendar_events_scope_shape CHECK ((scope = 'school' AND laboratory_id IS NULL) OR (scope = 'laboratory' AND laboratory_id IS NOT NULL))");
            DB::statement("ALTER TABLE operational_calendar_events ADD CONSTRAINT calendar_events_time_shape CHECK ((all_day = TRUE AND starts_at IS NULL AND ends_at IS NULL) OR (all_day = FALSE AND starts_on = ends_on AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_at < ends_at))");
            DB::statement("ALTER TABLE operational_calendar_events ADD CONSTRAINT calendar_events_cancel_shape CHECK ((status = 'active' AND cancelled_at IS NULL) OR (status = 'cancelled' AND cancelled_at IS NOT NULL))");
            DB::statement('ALTER TABLE operational_calendar_events ADD CONSTRAINT calendar_events_version_positive CHECK (version >= 1)');
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER calendar_events_integrity_insert BEFORE INSERT ON operational_calendar_events WHEN NEW.starts_on > NEW.ends_on OR NOT ((NEW.scope = 'school' AND NEW.laboratory_id IS NULL) OR (NEW.scope = 'laboratory' AND NEW.laboratory_id IS NOT NULL)) OR NOT ((NEW.all_day = 1 AND NEW.starts_at IS NULL AND NEW.ends_at IS NULL) OR (NEW.all_day = 0 AND NEW.starts_on = NEW.ends_on AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.starts_at < NEW.ends_at)) OR NOT ((NEW.status = 'active' AND NEW.cancelled_at IS NULL) OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL)) OR NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Operational calendar event integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER calendar_events_integrity_update BEFORE UPDATE ON operational_calendar_events WHEN NEW.starts_on > NEW.ends_on OR NOT ((NEW.scope = 'school' AND NEW.laboratory_id IS NULL) OR (NEW.scope = 'laboratory' AND NEW.laboratory_id IS NOT NULL)) OR NOT ((NEW.all_day = 1 AND NEW.starts_at IS NULL AND NEW.ends_at IS NULL) OR (NEW.all_day = 0 AND NEW.starts_on = NEW.ends_on AND NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.starts_at < NEW.ends_at)) OR NOT ((NEW.status = 'active' AND NEW.cancelled_at IS NULL) OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL)) OR NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Operational calendar event integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('operational_calendar_event_events');
        Schema::dropIfExists('operational_calendar_events');
    }
};
