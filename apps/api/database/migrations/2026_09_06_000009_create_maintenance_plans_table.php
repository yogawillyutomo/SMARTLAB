<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_plans', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('plan_code', 48);
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->string('asset_code_snapshot', 64);
            $table->string('asset_name_snapshot', 255);
            $table->string('name', 255);
            $table->enum('frequency_kind', ['weekly', 'monthly', 'quarterly', 'semester', 'yearly', 'custom_interval']);
            $table->unsignedInteger('interval_days')->nullable();
            $table->jsonb('checklist_template');
            $table->string('assigned_technician_reference', 255)->nullable();
            $table->string('assigned_technician_name_snapshot', 255)->nullable();
            $table->date('next_due_date');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'plan_code']);
            $table->index(['school_id', 'status', 'next_due_date'], 'maintenance_plans_school_due_idx');
            $table->index(['school_id', 'asset_id'], 'maintenance_plans_school_asset_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE maintenance_plans
                ADD CONSTRAINT maintenance_plans_version_positive CHECK (version >= 1),
                ADD CONSTRAINT maintenance_plans_frequency_interval CHECK (
                    (frequency_kind = 'custom_interval' AND interval_days IS NOT NULL AND interval_days >= 1)
                    OR (frequency_kind <> 'custom_interval' AND interval_days IS NULL)
                ),
                ADD CONSTRAINT maintenance_plans_checklist_array CHECK (
                    jsonb_typeof(checklist_template) = 'array'
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_maintenance_plan_identity()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Maintenance plans are retained as operational history';
                    END IF;

                    IF NEW.school_id IS DISTINCT FROM OLD.school_id
                        OR NEW.plan_code IS DISTINCT FROM OLD.plan_code
                        OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
                        OR NEW.asset_code_snapshot IS DISTINCT FROM OLD.asset_code_snapshot
                        OR NEW.asset_name_snapshot IS DISTINCT FROM OLD.asset_name_snapshot
                    THEN
                        RAISE EXCEPTION 'Maintenance plan identity is immutable';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER maintenance_plans_identity_update BEFORE UPDATE ON maintenance_plans FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_plan_identity()');
            DB::statement('CREATE TRIGGER maintenance_plans_history_delete BEFORE DELETE ON maintenance_plans FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_plan_identity()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER maintenance_plans_integrity_insert BEFORE INSERT ON maintenance_plans
                WHEN NEW.version < 1
                    OR (NEW.frequency_kind = 'custom_interval' AND (NEW.interval_days IS NULL OR NEW.interval_days < 1))
                    OR (NEW.frequency_kind <> 'custom_interval' AND NEW.interval_days IS NOT NULL)
                BEGIN SELECT RAISE(ABORT, 'Maintenance plan integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER maintenance_plans_integrity_update BEFORE UPDATE ON maintenance_plans
                WHEN NEW.version < 1
                    OR (NEW.frequency_kind = 'custom_interval' AND (NEW.interval_days IS NULL OR NEW.interval_days < 1))
                    OR (NEW.frequency_kind <> 'custom_interval' AND NEW.interval_days IS NOT NULL)
                BEGIN SELECT RAISE(ABORT, 'Maintenance plan integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER maintenance_plans_identity_update BEFORE UPDATE ON maintenance_plans
                WHEN NEW.school_id IS NOT OLD.school_id
                    OR NEW.plan_code IS NOT OLD.plan_code
                    OR NEW.asset_id IS NOT OLD.asset_id
                    OR NEW.asset_code_snapshot IS NOT OLD.asset_code_snapshot
                    OR NEW.asset_name_snapshot IS NOT OLD.asset_name_snapshot
                BEGIN SELECT RAISE(ABORT, 'Maintenance plan identity is immutable'); END");
            DB::unprepared("CREATE TRIGGER maintenance_plans_history_delete BEFORE DELETE ON maintenance_plans
                BEGIN SELECT RAISE(ABORT, 'Maintenance plans are retained as operational history'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_plans');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_maintenance_plan_identity()');
        }
    }
};
