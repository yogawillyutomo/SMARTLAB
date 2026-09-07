<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('maintenance_executions', function (Blueprint $table): void {
            $table->jsonb('checklist_progress')->nullable()->after('checklist_results');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE maintenance_executions
                ADD CONSTRAINT maintenance_execution_checklist_progress_array CHECK (
                    checklist_progress IS NULL OR jsonb_typeof(checklist_progress) = 'array'
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_maintenance_execution_progress()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF NEW.status = 'scheduled' AND NEW.checklist_progress IS NOT NULL THEN
                        RAISE EXCEPTION 'Scheduled Maintenance execution cannot carry checklist progress';
                    END IF;

                    IF OLD.status IN ('completed', 'cancelled')
                        AND NEW.checklist_progress IS DISTINCT FROM OLD.checklist_progress
                    THEN
                        RAISE EXCEPTION 'Terminal Maintenance checklist progress is immutable';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::statement('CREATE TRIGGER maintenance_execution_progress_update BEFORE UPDATE ON maintenance_executions FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_execution_progress()');
            DB::statement('CREATE TRIGGER maintenance_execution_progress_insert BEFORE INSERT ON maintenance_executions FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_execution_progress()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER maintenance_execution_progress_insert BEFORE INSERT ON maintenance_executions
                WHEN NEW.status = 'scheduled' AND NEW.checklist_progress IS NOT NULL
                BEGIN SELECT RAISE(ABORT, 'Scheduled Maintenance execution cannot carry checklist progress'); END");

            DB::unprepared("CREATE TRIGGER maintenance_execution_progress_update BEFORE UPDATE ON maintenance_executions
                WHEN (NEW.status = 'scheduled' AND NEW.checklist_progress IS NOT NULL)
                    OR (OLD.status IN ('completed','cancelled') AND NEW.checklist_progress IS NOT OLD.checklist_progress)
                BEGIN SELECT RAISE(ABORT, 'Maintenance checklist progress integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP TRIGGER IF EXISTS maintenance_execution_progress_update ON maintenance_executions');
            DB::statement('DROP TRIGGER IF EXISTS maintenance_execution_progress_insert ON maintenance_executions');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_maintenance_execution_progress()');
            DB::statement('ALTER TABLE maintenance_executions DROP CONSTRAINT IF EXISTS maintenance_execution_checklist_progress_array');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared('DROP TRIGGER IF EXISTS maintenance_execution_progress_update');
            DB::unprepared('DROP TRIGGER IF EXISTS maintenance_execution_progress_insert');
        }

        Schema::table('maintenance_executions', function (Blueprint $table): void {
            $table->dropColumn('checklist_progress');
        });
    }
};
