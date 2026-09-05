<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('priority_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('event_number', 40);
            $table->foreignUlid('laboratory_id')->constrained('laboratories')->restrictOnDelete();
            $table->foreignUlid('requester_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('requester_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->string('requester_name_snapshot');
            $table->string('requester_email_snapshot');
            $table->date('event_date');
            $table->time('starts_at');
            $table->time('ends_at');
            $table->enum('category', ['school_event', 'exam', 'competition', 'official_visit', 'emergency', 'other']);
            $table->string('title');
            $table->unsignedSmallInteger('participants');
            $table->text('description')->nullable();
            $table->string('pic_name');
            $table->enum('status', ['submitted', 'approved', 'rejected', 'cancelled'])->default('submitted');
            $table->text('rejection_reason')->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'event_number'], 'priority_events_school_number_unique');
            $table->index(['school_id', 'event_date', 'status'], 'priority_events_school_date_status_idx');
            $table->index(['school_id', 'laboratory_id', 'event_date', 'status'], 'priority_events_lab_date_status_idx');
            $table->index(['school_id', 'requester_membership_id', 'event_date'], 'priority_events_requester_date_idx');
        });

        Schema::create('priority_event_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('priority_event_id')->constrained('priority_events')->restrictOnDelete();
            $table->string('actor_user_id_snapshot', 128);
            $table->string('actor_membership_id_snapshot', 128);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'created_at'], 'priority_event_events_school_time_idx');
            $table->index(['priority_event_id', 'created_at'], 'priority_event_events_entity_time_idx');
        });

        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE priority_events ADD CONSTRAINT priority_events_time_range CHECK (starts_at < ends_at)');
            DB::statement('ALTER TABLE priority_events ADD CONSTRAINT priority_events_participants_positive CHECK (participants >= 1)');
            DB::statement('ALTER TABLE priority_events ADD CONSTRAINT priority_events_version_positive CHECK (version >= 1)');
            DB::statement("ALTER TABLE priority_events ADD CONSTRAINT priority_events_status_shape CHECK (
                (status = 'submitted' AND rejection_reason IS NULL AND decided_at IS NULL AND cancelled_at IS NULL)
                OR (status = 'approved' AND rejection_reason IS NULL AND decided_at IS NOT NULL AND cancelled_at IS NULL)
                OR (status = 'rejected' AND rejection_reason IS NOT NULL AND decided_at IS NOT NULL AND cancelled_at IS NULL)
                OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
            )");
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER priority_events_integrity_insert BEFORE INSERT ON priority_events WHEN NEW.starts_at >= NEW.ends_at OR NEW.participants < 1 OR NEW.version < 1 OR NOT (
                (NEW.status = 'submitted' AND NEW.rejection_reason IS NULL AND NEW.decided_at IS NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'approved' AND NEW.rejection_reason IS NULL AND NEW.decided_at IS NOT NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'rejected' AND NEW.rejection_reason IS NOT NULL AND NEW.decided_at IS NOT NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Priority event integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER priority_events_integrity_update BEFORE UPDATE ON priority_events WHEN NEW.starts_at >= NEW.ends_at OR NEW.participants < 1 OR NEW.version < 1 OR NOT (
                (NEW.status = 'submitted' AND NEW.rejection_reason IS NULL AND NEW.decided_at IS NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'approved' AND NEW.rejection_reason IS NULL AND NEW.decided_at IS NOT NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'rejected' AND NEW.rejection_reason IS NOT NULL AND NEW.decided_at IS NOT NULL AND NEW.cancelled_at IS NULL)
                OR (NEW.status = 'cancelled' AND NEW.cancelled_at IS NOT NULL)
            ) BEGIN SELECT RAISE(ABORT, 'Priority event integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('priority_event_events');
        Schema::dropIfExists('priority_events');
    }
};
