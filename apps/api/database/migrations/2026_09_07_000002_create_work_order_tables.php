<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_order_sequences', function (Blueprint $table): void {
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_value')->default(0);
            $table->primary(['school_id', 'year']);
        });

        Schema::create('work_orders', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('work_order_number', 48);
            $table->foreignUlid('incident_id')->nullable()->constrained('incidents')->restrictOnDelete();
            $table->string('incident_ticket_snapshot', 48)->nullable();
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->string('asset_code_snapshot', 64);
            $table->string('asset_name_snapshot', 255);
            $table->foreignUlid('laboratory_id')->constrained('laboratories')->restrictOnDelete();
            $table->string('laboratory_code_snapshot', 64);
            $table->string('laboratory_name_snapshot', 255);
            $table->string('problem_summary', 2000);
            $table->enum('priority', ['low', 'normal', 'high', 'critical'])->default('normal');
            $table->date('scheduled_for')->nullable();
            $table->string('notes', 2000)->nullable();
            $table->enum('status', ['draft', 'assigned', 'in_progress', 'on_hold', 'waiting_part', 'completed', 'verified', 'cancelled'])->default('draft');
            $table->foreignUlid('assignee_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('assignee_user_id_snapshot')->nullable();
            $table->ulid('assignee_membership_id_snapshot')->nullable();
            $table->string('assignee_name_snapshot', 255)->nullable();
            $table->string('diagnosis', 2000)->nullable();
            $table->string('action_taken', 2000)->nullable();
            $table->string('test_result', 2000)->nullable();
            $table->enum('condition_before', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->enum('condition_after', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->unsignedBigInteger('asset_version_at_start')->nullable();
            $table->boolean('custody_active')->default(false);
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('verified_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancel_reason', 1000)->nullable();
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'work_order_number']);
            $table->index(['school_id', 'status', 'created_at'], 'work_orders_school_status_idx');
            $table->index(['school_id', 'asset_id'], 'work_orders_school_asset_idx');
            $table->index(['school_id', 'incident_id'], 'work_orders_school_incident_idx');
            $table->index(['school_id', 'assignee_membership_id'], 'work_orders_school_assignee_idx');
        });

        DB::statement('CREATE UNIQUE INDEX work_orders_active_asset_unique ON work_orders(asset_id) WHERE custody_active = '.(DB::connection()->getDriverName() === 'pgsql' ? 'TRUE' : '1'));

        Schema::create('work_order_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 80);
            $table->string('before_status', 32)->nullable();
            $table->string('after_status', 32);
            $table->jsonb('payload');
            $table->timestampTz('created_at');
            $table->index(['school_id', 'work_order_id', 'created_at'], 'work_order_events_order_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE work_orders
                ADD CONSTRAINT work_orders_version_positive CHECK (version >= 1),
                ADD CONSTRAINT work_orders_incident_snapshot_pair CHECK (
                    (incident_id IS NULL AND incident_ticket_snapshot IS NULL)
                    OR (incident_id IS NOT NULL AND incident_ticket_snapshot IS NOT NULL)
                ),
                ADD CONSTRAINT work_orders_assignee_snapshot_consistency CHECK (
                    (assignee_membership_id_snapshot IS NULL AND assignee_user_id_snapshot IS NULL AND assignee_name_snapshot IS NULL)
                    OR (assignee_membership_id_snapshot IS NOT NULL AND assignee_user_id_snapshot IS NOT NULL AND assignee_name_snapshot IS NOT NULL)
                ),
                ADD CONSTRAINT work_orders_custody_status CHECK (
                    custody_active = (status IN ('in_progress', 'on_hold', 'waiting_part', 'completed'))
                ),
                ADD CONSTRAINT work_orders_start_evidence CHECK (
                    (status IN ('draft', 'assigned') AND started_at IS NULL AND condition_before IS NULL AND asset_version_at_start IS NULL)
                    OR (status IN ('in_progress', 'on_hold', 'waiting_part', 'completed', 'verified') AND started_at IS NOT NULL AND condition_before IS NOT NULL AND asset_version_at_start IS NOT NULL)
                    OR (status = 'cancelled')
                ),
                ADD CONSTRAINT work_orders_completion_evidence CHECK (
                    (status IN ('completed', 'verified') AND completed_at IS NOT NULL AND diagnosis IS NOT NULL AND action_taken IS NOT NULL AND condition_after IS NOT NULL)
                    OR (status NOT IN ('completed', 'verified') AND completed_at IS NULL AND condition_after IS NULL)
                ),
                ADD CONSTRAINT work_orders_verified_evidence CHECK (
                    (status = 'verified' AND verified_at IS NOT NULL AND custody_active = FALSE)
                    OR (status <> 'verified' AND verified_at IS NULL)
                ),
                ADD CONSTRAINT work_orders_cancel_evidence CHECK (
                    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND custody_active = FALSE)
                    OR (status <> 'cancelled' AND cancelled_at IS NULL AND cancel_reason IS NULL)
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_work_order_identity()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'WorkOrder evidence cannot be deleted';
                    END IF;
                    IF NEW.school_id IS DISTINCT FROM OLD.school_id
                        OR NEW.work_order_number IS DISTINCT FROM OLD.work_order_number
                        OR NEW.incident_id IS DISTINCT FROM OLD.incident_id
                        OR NEW.incident_ticket_snapshot IS DISTINCT FROM OLD.incident_ticket_snapshot
                        OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
                        OR NEW.asset_code_snapshot IS DISTINCT FROM OLD.asset_code_snapshot
                        OR NEW.asset_name_snapshot IS DISTINCT FROM OLD.asset_name_snapshot
                        OR NEW.laboratory_id IS DISTINCT FROM OLD.laboratory_id
                        OR NEW.laboratory_code_snapshot IS DISTINCT FROM OLD.laboratory_code_snapshot
                        OR NEW.laboratory_name_snapshot IS DISTINCT FROM OLD.laboratory_name_snapshot
                    THEN
                        RAISE EXCEPTION 'WorkOrder identity is immutable';
                    END IF;
                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER work_orders_identity_update BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION smartlab_protect_work_order_identity()');
            DB::statement('CREATE TRIGGER work_orders_identity_delete BEFORE DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION smartlab_protect_work_order_identity()');

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_work_order_event_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'WorkOrder events are immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER work_order_events_immutable_update BEFORE UPDATE OF school_id, work_order_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON work_order_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_work_order_event_mutation()');
            DB::statement('CREATE TRIGGER work_order_events_immutable_delete BEFORE DELETE ON work_order_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_work_order_event_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            $integrity = "(NEW.version < 1)
                OR ((NEW.incident_id IS NULL) <> (NEW.incident_ticket_snapshot IS NULL))
                OR ((NEW.assignee_membership_id_snapshot IS NULL) <> (NEW.assignee_user_id_snapshot IS NULL))
                OR ((NEW.assignee_user_id_snapshot IS NULL) <> (NEW.assignee_name_snapshot IS NULL))
                OR (NEW.custody_active <> CASE WHEN NEW.status IN ('in_progress','on_hold','waiting_part','completed') THEN 1 ELSE 0 END)
                OR (NEW.status IN ('draft','assigned') AND (NEW.started_at IS NOT NULL OR NEW.condition_before IS NOT NULL OR NEW.asset_version_at_start IS NOT NULL))
                OR (NEW.status IN ('in_progress','on_hold','waiting_part','completed','verified') AND (NEW.started_at IS NULL OR NEW.condition_before IS NULL OR NEW.asset_version_at_start IS NULL))
                OR (NEW.status IN ('completed','verified') AND (NEW.completed_at IS NULL OR NEW.diagnosis IS NULL OR NEW.action_taken IS NULL OR NEW.condition_after IS NULL))
                OR (NEW.status NOT IN ('completed','verified') AND (NEW.completed_at IS NOT NULL OR NEW.condition_after IS NOT NULL))
                OR (NEW.status = 'verified' AND (NEW.verified_at IS NULL OR NEW.custody_active <> 0))
                OR (NEW.status <> 'verified' AND NEW.verified_at IS NOT NULL)
                OR (NEW.status = 'cancelled' AND (NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR NEW.custody_active <> 0))
                OR (NEW.status <> 'cancelled' AND (NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL))";

            DB::unprepared("CREATE TRIGGER work_orders_integrity_insert BEFORE INSERT ON work_orders WHEN {$integrity}
                BEGIN SELECT RAISE(ABORT, 'WorkOrder integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER work_orders_integrity_update BEFORE UPDATE ON work_orders WHEN {$integrity}
                BEGIN SELECT RAISE(ABORT, 'WorkOrder integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER work_orders_identity_update BEFORE UPDATE ON work_orders
                WHEN NEW.school_id IS NOT OLD.school_id
                    OR NEW.work_order_number IS NOT OLD.work_order_number
                    OR NEW.incident_id IS NOT OLD.incident_id
                    OR NEW.incident_ticket_snapshot IS NOT OLD.incident_ticket_snapshot
                    OR NEW.asset_id IS NOT OLD.asset_id
                    OR NEW.asset_code_snapshot IS NOT OLD.asset_code_snapshot
                    OR NEW.asset_name_snapshot IS NOT OLD.asset_name_snapshot
                    OR NEW.laboratory_id IS NOT OLD.laboratory_id
                    OR NEW.laboratory_code_snapshot IS NOT OLD.laboratory_code_snapshot
                    OR NEW.laboratory_name_snapshot IS NOT OLD.laboratory_name_snapshot
                BEGIN SELECT RAISE(ABORT, 'WorkOrder identity is immutable'); END");
            DB::unprepared("CREATE TRIGGER work_orders_identity_delete BEFORE DELETE ON work_orders
                BEGIN SELECT RAISE(ABORT, 'WorkOrder evidence cannot be deleted'); END");
            DB::unprepared("CREATE TRIGGER work_order_events_immutable_update BEFORE UPDATE OF school_id, work_order_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON work_order_events
                BEGIN SELECT RAISE(ABORT, 'WorkOrder events are immutable'); END");
            DB::unprepared("CREATE TRIGGER work_order_events_immutable_delete BEFORE DELETE ON work_order_events
                BEGIN SELECT RAISE(ABORT, 'WorkOrder events are immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('work_order_events');
        Schema::dropIfExists('work_orders');
        Schema::dropIfExists('work_order_sequences');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_work_order_identity()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_work_order_event_mutation()');
        }
    }
};
