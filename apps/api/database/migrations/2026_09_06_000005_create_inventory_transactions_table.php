<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_transactions', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('inventory_item_id')->constrained('inventory_items')->restrictOnDelete();
            $table->uuid('client_mutation_id');
            $table->enum('kind', ['opening', 'receipt', 'issue', 'adjustment_in', 'adjustment_out']);
            $table->decimal('quantity', 15, 3);
            $table->decimal('signed_delta', 15, 3);
            $table->decimal('balance_before', 15, 3);
            $table->decimal('balance_after', 15, 3);
            $table->unsignedBigInteger('item_version_after');
            $table->string('reason', 1000);
            $table->string('source_type', 64)->nullable();
            $table->ulid('source_id')->nullable();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('item_code_snapshot', 32);
            $table->string('item_name_snapshot', 255);
            $table->string('unit_snapshot', 32);
            $table->char('request_sha256', 64);
            $table->timestampTz('occurred_at');
            $table->timestampTz('created_at');

            $table->unique(['school_id', 'client_mutation_id'], 'inventory_transactions_school_mutation_unique');
            $table->index(['school_id', 'inventory_item_id', 'occurred_at'], 'inventory_transactions_item_time_idx');
            $table->index(['school_id', 'kind', 'occurred_at'], 'inventory_transactions_kind_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE inventory_transactions
                ADD CONSTRAINT inventory_transactions_quantity_positive CHECK (quantity > 0),
                ADD CONSTRAINT inventory_transactions_balances_non_negative CHECK (balance_before >= 0 AND balance_after >= 0),
                ADD CONSTRAINT inventory_transactions_item_version_positive CHECK (item_version_after >= 2),
                ADD CONSTRAINT inventory_transactions_delta_matches_quantity CHECK (ABS(signed_delta) = quantity),
                ADD CONSTRAINT inventory_transactions_balance_math CHECK (balance_after = balance_before + signed_delta),
                ADD CONSTRAINT inventory_transactions_kind_sign CHECK (
                    (kind IN ('opening', 'receipt', 'adjustment_in') AND signed_delta > 0)
                    OR (kind IN ('issue', 'adjustment_out') AND signed_delta < 0)
                ),
                ADD CONSTRAINT inventory_transactions_source_pair CHECK (
                    (source_type IS NULL AND source_id IS NULL)
                    OR (source_type IS NOT NULL AND source_id IS NOT NULL)
                )
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_inventory_transaction_mutation()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'Inventory transactions are immutable';
                END;
                $$ LANGUAGE plpgsql
            SQL);
            DB::statement('CREATE TRIGGER inventory_transactions_immutable_update BEFORE UPDATE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_inventory_transaction_mutation()');
            DB::statement('CREATE TRIGGER inventory_transactions_immutable_delete BEFORE DELETE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_inventory_transaction_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER inventory_transactions_integrity_insert BEFORE INSERT ON inventory_transactions
                WHEN NEW.quantity <= 0 OR NEW.balance_before < 0 OR NEW.balance_after < 0
                    OR NEW.item_version_after < 2
                    OR ABS(NEW.signed_delta) <> NEW.quantity
                    OR NEW.balance_after <> NEW.balance_before + NEW.signed_delta
                    OR ((NEW.kind IN ('opening', 'receipt', 'adjustment_in')) AND NEW.signed_delta <= 0)
                    OR ((NEW.kind IN ('issue', 'adjustment_out')) AND NEW.signed_delta >= 0)
                    OR ((NEW.source_type IS NULL) <> (NEW.source_id IS NULL))
                BEGIN SELECT RAISE(ABORT, 'Inventory transaction integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER inventory_transactions_immutable_update BEFORE UPDATE ON inventory_transactions
                BEGIN SELECT RAISE(ABORT, 'Inventory transactions are immutable'); END");
            DB::unprepared("CREATE TRIGGER inventory_transactions_immutable_delete BEFORE DELETE ON inventory_transactions
                BEGIN SELECT RAISE(ABORT, 'Inventory transactions are immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_transactions');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_inventory_transaction_mutation()');
        }
    }
};
