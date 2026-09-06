<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->enum('entity_type', ['plan', 'execution']);
            $table->foreignUlid('maintenance_plan_id')->nullable()->constrained('maintenance_plans')->restrictOnDelete();
            $table->foreignUlid('maintenance_execution_id')->nullable()->constrained('maintenance_executions')->restrictOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 100);
            $table->string('before_status', 32)->nullable();
            $table->string('after_status', 32)->nullable();
            $table->jsonb('payload');
            $table->timestampTz('created_at');

            $table->index(['school_id', 'maintenance_plan_id', 'created_at'], 'maintenance_events_plan_time_idx');
            $table->index(['school_id', 'maintenance_execution_id', 'created_at'], 'maintenance_events_exec_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE maintenance_events
                ADD CONSTRAINT maintenance_events_target CHECK (
                    (entity_type = 'plan' AND maintenance_plan_id IS NOT NULL AND maintenance_execution_id IS NULL)
                    OR (entity_type = 'execution' AND maintenance_plan_id IS NULL AND maintenance_execution_id IS NOT NULL)
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_maintenance_event_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'Maintenance events are immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER maintenance_events_immutable_update BEFORE UPDATE OF school_id, entity_type, maintenance_plan_id, maintenance_execution_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON maintenance_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_event_mutation()');
            DB::statement('CREATE TRIGGER maintenance_events_immutable_delete BEFORE DELETE ON maintenance_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_event_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER maintenance_events_target_insert BEFORE INSERT ON maintenance_events
                WHEN (NEW.entity_type = 'plan' AND (NEW.maintenance_plan_id IS NULL OR NEW.maintenance_execution_id IS NOT NULL))
                    OR (NEW.entity_type = 'execution' AND (NEW.maintenance_plan_id IS NOT NULL OR NEW.maintenance_execution_id IS NULL))
                BEGIN SELECT RAISE(ABORT, 'Maintenance event target integrity failed'); END");
            DB::unprepared("CREATE TRIGGER maintenance_events_immutable_update BEFORE UPDATE OF school_id, entity_type, maintenance_plan_id, maintenance_execution_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON maintenance_events
                BEGIN SELECT RAISE(ABORT, 'Maintenance events are immutable'); END");
            DB::unprepared("CREATE TRIGGER maintenance_events_immutable_delete BEFORE DELETE ON maintenance_events
                BEGIN SELECT RAISE(ABORT, 'Maintenance events are immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_events');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_maintenance_event_mutation()');
        }
    }
};
