<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_executions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('execution_number', 48);
            $table->foreignUlid('maintenance_plan_id')->constrained('maintenance_plans')->restrictOnDelete();
            $table->string('plan_code_snapshot', 48);
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->string('asset_code_snapshot', 64);
            $table->string('asset_name_snapshot', 255);
            $table->date('scheduled_for');
            $table->enum('status', ['scheduled', 'in_progress', 'completed', 'cancelled'])->default('scheduled');
            $table->jsonb('checklist_snapshot');
            $table->jsonb('checklist_results')->nullable();
            $table->text('findings')->nullable();
            $table->text('action_taken')->nullable();
            $table->enum('condition_before', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->enum('condition_after', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->string('technician_reference', 255)->nullable();
            $table->string('technician_name_snapshot', 255);
            $table->unsignedBigInteger('asset_version_at_start')->nullable();
            $table->boolean('custody_active')->default(false);
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancel_reason', 1000)->nullable();
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'execution_number']);
            $table->unique(['maintenance_plan_id', 'scheduled_for'], 'maintenance_execution_plan_date_unique');
            $table->index(['school_id', 'status', 'scheduled_for'], 'maintenance_exec_school_status_date_idx');
            $table->index(['school_id', 'asset_id'], 'maintenance_exec_school_asset_idx');
        });

        DB::statement('CREATE UNIQUE INDEX maintenance_exec_active_asset_unique ON maintenance_executions(asset_id) WHERE custody_active = '.(DB::connection()->getDriverName() === 'pgsql' ? 'TRUE' : '1'));

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE maintenance_executions
                ADD CONSTRAINT maintenance_execution_version_positive CHECK (version >= 1),
                ADD CONSTRAINT maintenance_execution_checklist_array CHECK (
                    jsonb_typeof(checklist_snapshot) = 'array'
                    AND (checklist_results IS NULL OR jsonb_typeof(checklist_results) = 'array')
                ),
                ADD CONSTRAINT maintenance_execution_lifecycle CHECK (
                    (status = 'scheduled'
                        AND custody_active = FALSE
                        AND started_at IS NULL
                        AND completed_at IS NULL
                        AND cancelled_at IS NULL
                        AND cancel_reason IS NULL
                        AND condition_before IS NULL
                        AND condition_after IS NULL
                        AND asset_version_at_start IS NULL
                        AND checklist_results IS NULL
                        AND action_taken IS NULL)
                    OR
                    (status = 'in_progress'
                        AND custody_active = TRUE
                        AND started_at IS NOT NULL
                        AND completed_at IS NULL
                        AND cancelled_at IS NULL
                        AND cancel_reason IS NULL
                        AND condition_before IS NOT NULL
                        AND condition_after IS NULL
                        AND asset_version_at_start IS NOT NULL
                        AND checklist_results IS NULL
                        AND action_taken IS NULL)
                    OR
                    (status = 'completed'
                        AND custody_active = FALSE
                        AND started_at IS NOT NULL
                        AND completed_at IS NOT NULL
                        AND cancelled_at IS NULL
                        AND cancel_reason IS NULL
                        AND condition_before IS NOT NULL
                        AND condition_after IS NOT NULL
                        AND asset_version_at_start IS NOT NULL
                        AND checklist_results IS NOT NULL
                        AND action_taken IS NOT NULL)
                    OR
                    (status = 'cancelled'
                        AND custody_active = FALSE
                        AND completed_at IS NULL
                        AND cancelled_at IS NOT NULL
                        AND cancel_reason IS NOT NULL
                        AND condition_after IS NULL
                        AND checklist_results IS NULL
                        AND action_taken IS NULL
                        AND (
                            (started_at IS NULL AND condition_before IS NULL AND asset_version_at_start IS NULL)
                            OR
                            (started_at IS NOT NULL AND condition_before IS NOT NULL AND asset_version_at_start IS NOT NULL)
                        ))
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_maintenance_execution_evidence()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Maintenance executions are retained as operational history';
                    END IF;

                    IF NEW.school_id IS DISTINCT FROM OLD.school_id
                        OR NEW.execution_number IS DISTINCT FROM OLD.execution_number
                        OR NEW.maintenance_plan_id IS DISTINCT FROM OLD.maintenance_plan_id
                        OR NEW.plan_code_snapshot IS DISTINCT FROM OLD.plan_code_snapshot
                        OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
                        OR NEW.asset_code_snapshot IS DISTINCT FROM OLD.asset_code_snapshot
                        OR NEW.asset_name_snapshot IS DISTINCT FROM OLD.asset_name_snapshot
                        OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
                        OR NEW.checklist_snapshot IS DISTINCT FROM OLD.checklist_snapshot
                        OR NEW.technician_reference IS DISTINCT FROM OLD.technician_reference
                        OR NEW.technician_name_snapshot IS DISTINCT FROM OLD.technician_name_snapshot
                        OR (OLD.condition_before IS NOT NULL AND NEW.condition_before IS DISTINCT FROM OLD.condition_before)
                        OR (OLD.asset_version_at_start IS NOT NULL AND NEW.asset_version_at_start IS DISTINCT FROM OLD.asset_version_at_start)
                        OR (OLD.condition_after IS NOT NULL AND NEW.condition_after IS DISTINCT FROM OLD.condition_after)
                        OR (OLD.checklist_results IS NOT NULL AND NEW.checklist_results IS DISTINCT FROM OLD.checklist_results)
                        OR (OLD.action_taken IS NOT NULL AND NEW.action_taken IS DISTINCT FROM OLD.action_taken)
                        OR (OLD.status IN ('completed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status)
                    THEN
                        RAISE EXCEPTION 'Maintenance execution identity or captured evidence is immutable';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER maintenance_execution_evidence_update BEFORE UPDATE ON maintenance_executions FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_execution_evidence()');
            DB::statement('CREATE TRIGGER maintenance_execution_history_delete BEFORE DELETE ON maintenance_executions FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_execution_evidence()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER maintenance_execution_integrity_insert BEFORE INSERT ON maintenance_executions
                WHEN NEW.version < 1
                    OR (NEW.status = 'scheduled' AND (NEW.custody_active <> 0 OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NOT NULL OR NEW.condition_after IS NOT NULL OR NEW.asset_version_at_start IS NOT NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                    OR (NEW.status = 'in_progress' AND (NEW.custody_active <> 1 OR NEW.started_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NULL OR NEW.condition_after IS NOT NULL OR NEW.asset_version_at_start IS NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                    OR (NEW.status = 'completed' AND (NEW.custody_active <> 0 OR NEW.started_at IS NULL OR NEW.completed_at IS NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NULL OR NEW.condition_after IS NULL OR NEW.asset_version_at_start IS NULL OR NEW.checklist_results IS NULL OR NEW.action_taken IS NULL))
                    OR (NEW.status = 'cancelled' AND (NEW.custody_active <> 0 OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR NEW.condition_after IS NOT NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                BEGIN SELECT RAISE(ABORT, 'Maintenance execution integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER maintenance_execution_integrity_update BEFORE UPDATE ON maintenance_executions
                WHEN NEW.version < 1
                    OR (NEW.status = 'scheduled' AND (NEW.custody_active <> 0 OR NEW.started_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NOT NULL OR NEW.condition_after IS NOT NULL OR NEW.asset_version_at_start IS NOT NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                    OR (NEW.status = 'in_progress' AND (NEW.custody_active <> 1 OR NEW.started_at IS NULL OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NULL OR NEW.condition_after IS NOT NULL OR NEW.asset_version_at_start IS NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                    OR (NEW.status = 'completed' AND (NEW.custody_active <> 0 OR NEW.started_at IS NULL OR NEW.completed_at IS NULL OR NEW.cancelled_at IS NOT NULL OR NEW.cancel_reason IS NOT NULL OR NEW.condition_before IS NULL OR NEW.condition_after IS NULL OR NEW.asset_version_at_start IS NULL OR NEW.checklist_results IS NULL OR NEW.action_taken IS NULL))
                    OR (NEW.status = 'cancelled' AND (NEW.custody_active <> 0 OR NEW.completed_at IS NOT NULL OR NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR NEW.condition_after IS NOT NULL OR NEW.checklist_results IS NOT NULL OR NEW.action_taken IS NOT NULL))
                BEGIN SELECT RAISE(ABORT, 'Maintenance execution integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER maintenance_execution_evidence_update BEFORE UPDATE ON maintenance_executions
                WHEN NEW.school_id IS NOT OLD.school_id
                    OR NEW.execution_number IS NOT OLD.execution_number
                    OR NEW.maintenance_plan_id IS NOT OLD.maintenance_plan_id
                    OR NEW.plan_code_snapshot IS NOT OLD.plan_code_snapshot
                    OR NEW.asset_id IS NOT OLD.asset_id
                    OR NEW.asset_code_snapshot IS NOT OLD.asset_code_snapshot
                    OR NEW.asset_name_snapshot IS NOT OLD.asset_name_snapshot
                    OR NEW.scheduled_for IS NOT OLD.scheduled_for
                    OR NEW.checklist_snapshot IS NOT OLD.checklist_snapshot
                    OR NEW.technician_reference IS NOT OLD.technician_reference
                    OR NEW.technician_name_snapshot IS NOT OLD.technician_name_snapshot
                    OR (OLD.condition_before IS NOT NULL AND NEW.condition_before IS NOT OLD.condition_before)
                    OR (OLD.asset_version_at_start IS NOT NULL AND NEW.asset_version_at_start IS NOT OLD.asset_version_at_start)
                    OR (OLD.condition_after IS NOT NULL AND NEW.condition_after IS NOT OLD.condition_after)
                    OR (OLD.checklist_results IS NOT NULL AND NEW.checklist_results IS NOT OLD.checklist_results)
                    OR (OLD.action_taken IS NOT NULL AND NEW.action_taken IS NOT OLD.action_taken)
                    OR (OLD.status IN ('completed','cancelled') AND NEW.status IS NOT OLD.status)
                BEGIN SELECT RAISE(ABORT, 'Maintenance execution identity or captured evidence is immutable'); END");
            DB::unprepared("CREATE TRIGGER maintenance_execution_history_delete BEFORE DELETE ON maintenance_executions
                BEGIN SELECT RAISE(ABORT, 'Maintenance executions are retained as operational history'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_executions');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_maintenance_execution_evidence()');
        }
    }
};
