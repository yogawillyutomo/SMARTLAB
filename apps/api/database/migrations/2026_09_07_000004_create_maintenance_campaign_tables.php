<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('maintenance_campaigns', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('campaign_code', 48);
            $table->foreignUlid('laboratory_id')->constrained('laboratories')->restrictOnDelete();
            $table->string('laboratory_code_snapshot', 50);
            $table->string('laboratory_name_snapshot', 255);
            $table->string('name', 180);
            $table->text('description')->nullable();
            $table->enum('frequency_kind', ['weekly', 'monthly', 'quarterly', 'semester', 'yearly', 'custom_interval']);
            $table->unsignedInteger('interval_days')->nullable();
            $table->jsonb('checklist_template');
            $table->string('assigned_technician_reference', 255)->nullable();
            $table->string('assigned_technician_name_snapshot', 255)->nullable();
            $table->date('next_due_date');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'campaign_code']);
            $table->index(['school_id', 'laboratory_id', 'status'], 'maintenance_campaign_school_lab_status_idx');
        });

        Schema::create('maintenance_campaign_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('maintenance_campaign_id')->constrained('maintenance_campaigns')->restrictOnDelete();
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->string('asset_code_snapshot', 64);
            $table->string('asset_name_snapshot', 255);
            $table->foreignUlid('maintenance_plan_id')->constrained('maintenance_plans')->restrictOnDelete();
            $table->string('plan_code_snapshot', 48);
            $table->timestampTz('created_at');

            $table->unique(['maintenance_campaign_id', 'asset_id'], 'maintenance_campaign_item_asset_unique');
            $table->unique('maintenance_plan_id', 'maintenance_campaign_item_plan_unique');
            $table->index(['school_id', 'maintenance_campaign_id', 'asset_id'], 'maintenance_campaign_items_scope_idx');
        });

        Schema::create('maintenance_campaign_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('maintenance_campaign_id')->constrained('maintenance_campaigns')->restrictOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 120);
            $table->string('before_status', 32)->nullable();
            $table->string('after_status', 32)->nullable();
            $table->jsonb('payload');
            $table->timestampTz('created_at');

            $table->index(['school_id', 'maintenance_campaign_id', 'created_at'], 'maintenance_campaign_events_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE maintenance_campaigns
                ADD CONSTRAINT maintenance_campaign_version_positive CHECK (version >= 1),
                ADD CONSTRAINT maintenance_campaign_frequency_interval CHECK (
                    (frequency_kind = 'custom_interval' AND interval_days IS NOT NULL AND interval_days >= 1)
                    OR (frequency_kind <> 'custom_interval' AND interval_days IS NULL)
                ),
                ADD CONSTRAINT maintenance_campaign_checklist_array CHECK (
                    jsonb_typeof(checklist_template) = 'array'
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_validate_maintenance_campaign()
                RETURNS trigger AS $smartlab$
                DECLARE
                    lab_school char(26);
                    lab_code varchar(50);
                    lab_name varchar(255);
                BEGIN
                    SELECT school_id, code, name
                    INTO lab_school, lab_code, lab_name
                    FROM laboratories
                    WHERE id = NEW.laboratory_id;

                    IF lab_school IS NULL
                        OR lab_school <> NEW.school_id
                        OR lab_code <> NEW.laboratory_code_snapshot
                        OR lab_name <> NEW.laboratory_name_snapshot
                    THEN
                        RAISE EXCEPTION 'MaintenanceCampaign laboratory scope/snapshot mismatch';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_maintenance_campaign()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Maintenance campaigns are retained as orchestration history';
                    END IF;

                    IF NEW.school_id IS DISTINCT FROM OLD.school_id
                        OR NEW.campaign_code IS DISTINCT FROM OLD.campaign_code
                        OR NEW.laboratory_id IS DISTINCT FROM OLD.laboratory_id
                        OR NEW.laboratory_code_snapshot IS DISTINCT FROM OLD.laboratory_code_snapshot
                        OR NEW.laboratory_name_snapshot IS DISTINCT FROM OLD.laboratory_name_snapshot
                        OR NEW.name IS DISTINCT FROM OLD.name
                        OR NEW.description IS DISTINCT FROM OLD.description
                        OR NEW.frequency_kind IS DISTINCT FROM OLD.frequency_kind
                        OR NEW.interval_days IS DISTINCT FROM OLD.interval_days
                        OR NEW.checklist_template IS DISTINCT FROM OLD.checklist_template
                        OR NEW.assigned_technician_reference IS DISTINCT FROM OLD.assigned_technician_reference
                        OR NEW.assigned_technician_name_snapshot IS DISTINCT FROM OLD.assigned_technician_name_snapshot
                        OR NEW.next_due_date IS DISTINCT FROM OLD.next_due_date
                    THEN
                        RAISE EXCEPTION 'MaintenanceCampaign configuration is immutable; create a new campaign for a new policy';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_validate_maintenance_campaign_item()
                RETURNS trigger AS $smartlab$
                DECLARE
                    campaign_school char(26);
                    campaign_lab char(26);
                    asset_school char(26);
                    asset_lab char(26);
                    asset_code_value varchar(32);
                    asset_name_value varchar(255);
                    plan_school char(26);
                    plan_asset char(26);
                    plan_code_value varchar(48);
                BEGIN
                    SELECT school_id, laboratory_id
                    INTO campaign_school, campaign_lab
                    FROM maintenance_campaigns
                    WHERE id = NEW.maintenance_campaign_id;

                    SELECT school_id, home_laboratory_id, assets.asset_code, assets.name
                    INTO asset_school, asset_lab, asset_code_value, asset_name_value
                    FROM assets
                    WHERE id = NEW.asset_id;

                    SELECT school_id, asset_id, maintenance_plans.plan_code
                    INTO plan_school, plan_asset, plan_code_value
                    FROM maintenance_plans
                    WHERE id = NEW.maintenance_plan_id;

                    IF campaign_school IS NULL
                        OR campaign_school <> NEW.school_id
                        OR asset_school IS NULL
                        OR asset_school <> NEW.school_id
                        OR asset_lab IS DISTINCT FROM campaign_lab
                        OR asset_code_value <> NEW.asset_code_snapshot
                        OR asset_name_value <> NEW.asset_name_snapshot
                        OR plan_school IS NULL
                        OR plan_school <> NEW.school_id
                        OR plan_asset <> NEW.asset_id
                        OR plan_code_value <> NEW.plan_code_snapshot
                    THEN
                        RAISE EXCEPTION 'MaintenanceCampaignItem must bind one exact same-Lab Asset to one exact MaintenancePlan';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_maintenance_campaign_item_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'MaintenanceCampaign items are immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_maintenance_campaign_event_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'MaintenanceCampaign events are immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::statement('CREATE TRIGGER maintenance_campaign_validate_insert BEFORE INSERT ON maintenance_campaigns FOR EACH ROW EXECUTE FUNCTION smartlab_validate_maintenance_campaign()');
            DB::statement('CREATE TRIGGER maintenance_campaign_protect_update BEFORE UPDATE ON maintenance_campaigns FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_campaign()');
            DB::statement('CREATE TRIGGER maintenance_campaign_protect_delete BEFORE DELETE ON maintenance_campaigns FOR EACH ROW EXECUTE FUNCTION smartlab_protect_maintenance_campaign()');

            DB::statement('CREATE TRIGGER maintenance_campaign_item_validate_insert BEFORE INSERT ON maintenance_campaign_items FOR EACH ROW EXECUTE FUNCTION smartlab_validate_maintenance_campaign_item()');
            DB::statement('CREATE TRIGGER maintenance_campaign_item_immutable_update BEFORE UPDATE ON maintenance_campaign_items FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_campaign_item_mutation()');
            DB::statement('CREATE TRIGGER maintenance_campaign_item_immutable_delete BEFORE DELETE ON maintenance_campaign_items FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_campaign_item_mutation()');

            DB::statement('CREATE TRIGGER maintenance_campaign_event_immutable_update BEFORE UPDATE OF school_id, maintenance_campaign_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON maintenance_campaign_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_campaign_event_mutation()');
            DB::statement('CREATE TRIGGER maintenance_campaign_event_immutable_delete BEFORE DELETE ON maintenance_campaign_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_maintenance_campaign_event_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER maintenance_campaign_integrity_insert BEFORE INSERT ON maintenance_campaigns
                WHEN NEW.version < 1
                    OR (NEW.frequency_kind = 'custom_interval' AND (NEW.interval_days IS NULL OR NEW.interval_days < 1))
                    OR (NEW.frequency_kind <> 'custom_interval' AND NEW.interval_days IS NOT NULL)
                    OR NOT EXISTS (
                        SELECT 1 FROM laboratories l
                        WHERE l.id = NEW.laboratory_id
                          AND l.school_id = NEW.school_id
                          AND l.code = NEW.laboratory_code_snapshot
                          AND l.name = NEW.laboratory_name_snapshot
                    )
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign integrity failed'); END");

            DB::unprepared("CREATE TRIGGER maintenance_campaign_protect_update BEFORE UPDATE ON maintenance_campaigns
                WHEN NEW.school_id IS NOT OLD.school_id
                    OR NEW.campaign_code IS NOT OLD.campaign_code
                    OR NEW.laboratory_id IS NOT OLD.laboratory_id
                    OR NEW.laboratory_code_snapshot IS NOT OLD.laboratory_code_snapshot
                    OR NEW.laboratory_name_snapshot IS NOT OLD.laboratory_name_snapshot
                    OR NEW.name IS NOT OLD.name
                    OR NEW.description IS NOT OLD.description
                    OR NEW.frequency_kind IS NOT OLD.frequency_kind
                    OR NEW.interval_days IS NOT OLD.interval_days
                    OR NEW.checklist_template IS NOT OLD.checklist_template
                    OR NEW.assigned_technician_reference IS NOT OLD.assigned_technician_reference
                    OR NEW.assigned_technician_name_snapshot IS NOT OLD.assigned_technician_name_snapshot
                    OR NEW.next_due_date IS NOT OLD.next_due_date
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign configuration is immutable'); END");

            DB::unprepared("CREATE TRIGGER maintenance_campaign_protect_delete BEFORE DELETE ON maintenance_campaigns
                BEGIN SELECT RAISE(ABORT, 'Maintenance campaigns are retained as orchestration history'); END");

            DB::unprepared("CREATE TRIGGER maintenance_campaign_item_validate_insert BEFORE INSERT ON maintenance_campaign_items
                WHEN NOT EXISTS (
                    SELECT 1
                    FROM maintenance_campaigns c
                    JOIN assets a ON a.id = NEW.asset_id
                    JOIN maintenance_plans p ON p.id = NEW.maintenance_plan_id
                    WHERE c.id = NEW.maintenance_campaign_id
                      AND c.school_id = NEW.school_id
                      AND a.school_id = NEW.school_id
                      AND a.home_laboratory_id = c.laboratory_id
                      AND a.asset_code = NEW.asset_code_snapshot
                      AND a.name = NEW.asset_name_snapshot
                      AND p.school_id = NEW.school_id
                      AND p.asset_id = NEW.asset_id
                      AND p.plan_code = NEW.plan_code_snapshot
                )
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaignItem exact binding failed'); END");

            DB::unprepared("CREATE TRIGGER maintenance_campaign_item_immutable_update BEFORE UPDATE ON maintenance_campaign_items
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign items are immutable'); END");
            DB::unprepared("CREATE TRIGGER maintenance_campaign_item_immutable_delete BEFORE DELETE ON maintenance_campaign_items
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign items are immutable'); END");

            DB::unprepared("CREATE TRIGGER maintenance_campaign_event_immutable_update BEFORE UPDATE OF school_id, maintenance_campaign_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at ON maintenance_campaign_events
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign events are immutable'); END");
            DB::unprepared("CREATE TRIGGER maintenance_campaign_event_immutable_delete BEFORE DELETE ON maintenance_campaign_events
                BEGIN SELECT RAISE(ABORT, 'MaintenanceCampaign events are immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('maintenance_campaign_events');
        Schema::dropIfExists('maintenance_campaign_items');
        Schema::dropIfExists('maintenance_campaigns');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_maintenance_campaign_event_mutation()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_maintenance_campaign_item_mutation()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_validate_maintenance_campaign_item()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_maintenance_campaign()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_validate_maintenance_campaign()');
        }
    }
};
