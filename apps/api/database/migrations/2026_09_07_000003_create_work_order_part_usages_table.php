<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('work_order_part_usages', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('work_order_id')->constrained('work_orders')->restrictOnDelete();
            $table->foreignUlid('inventory_transaction_id')->constrained('inventory_transactions')->restrictOnDelete();
            $table->foreignUlid('inventory_item_id')->constrained('inventory_items')->restrictOnDelete();
            $table->uuid('client_mutation_id');

            $table->string('item_code_snapshot', 32);
            $table->string('item_name_snapshot', 255);
            $table->string('unit_snapshot', 32);
            $table->decimal('quantity', 15, 3);

            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);

            $table->timestampTz('used_at');
            $table->timestampTz('created_at');

            $table->unique('inventory_transaction_id', 'work_order_part_usages_transaction_unique');
            $table->unique(['school_id', 'client_mutation_id'], 'work_order_part_usages_school_mutation_unique');
            $table->index(['school_id', 'work_order_id', 'used_at'], 'work_order_part_usages_order_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE work_order_part_usages
                ADD CONSTRAINT work_order_part_usages_quantity_positive CHECK (quantity > 0)
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_work_order_part_usage_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'WorkOrder part usage evidence is immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::statement('CREATE TRIGGER work_order_part_usages_immutable_update BEFORE UPDATE OF school_id, work_order_id, inventory_transaction_id, inventory_item_id, client_mutation_id, item_code_snapshot, item_name_snapshot, unit_snapshot, quantity, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, used_at, created_at ON work_order_part_usages FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_work_order_part_usage_mutation()');
            DB::statement('CREATE TRIGGER work_order_part_usages_immutable_delete BEFORE DELETE ON work_order_part_usages FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_work_order_part_usage_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER work_order_part_usages_quantity_insert BEFORE INSERT ON work_order_part_usages
                WHEN NEW.quantity <= 0
                BEGIN SELECT RAISE(ABORT, 'WorkOrder part usage quantity must be positive'); END");

            DB::unprepared("CREATE TRIGGER work_order_part_usages_immutable_update BEFORE UPDATE OF school_id, work_order_id, inventory_transaction_id, inventory_item_id, client_mutation_id, item_code_snapshot, item_name_snapshot, unit_snapshot, quantity, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, used_at, created_at ON work_order_part_usages
                BEGIN SELECT RAISE(ABORT, 'WorkOrder part usage evidence is immutable'); END");

            DB::unprepared("CREATE TRIGGER work_order_part_usages_immutable_delete BEFORE DELETE ON work_order_part_usages
                BEGIN SELECT RAISE(ABORT, 'WorkOrder part usage evidence is immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('work_order_part_usages');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_work_order_part_usage_mutation()');
        }
    }
};
