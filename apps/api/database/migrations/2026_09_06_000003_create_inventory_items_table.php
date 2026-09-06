<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('item_code', 32);
            $table->string('name', 255);
            $table->string('category', 120);
            $table->string('unit', 32);
            $table->decimal('minimum_stock', 15, 3)->default(0);
            $table->string('storage_location', 255)->nullable();
            $table->string('supplier_name', 255)->nullable();
            $table->decimal('unit_price_snapshot', 15, 2)->nullable();
            $table->decimal('on_hand_quantity', 15, 3)->default(0);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'item_code']);
            $table->index(['school_id', 'category']);
            $table->index(['school_id', 'name']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE inventory_items
                ADD CONSTRAINT inventory_items_version_positive CHECK (version >= 1),
                ADD CONSTRAINT inventory_items_minimum_non_negative CHECK (minimum_stock >= 0),
                ADD CONSTRAINT inventory_items_balance_non_negative CHECK (on_hand_quantity >= 0),
                ADD CONSTRAINT inventory_items_unit_price_non_negative CHECK (unit_price_snapshot IS NULL OR unit_price_snapshot >= 0),
                ADD CONSTRAINT inventory_items_code_canonical CHECK (
                    char_length(item_code) BETWEEN 3 AND 32
                    AND item_code = upper(item_code)
                    AND item_code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'
                )
            SQL);
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER inventory_items_integrity_insert BEFORE INSERT ON inventory_items
                WHEN NEW.version < 1 OR NEW.minimum_stock < 0 OR NEW.on_hand_quantity < 0
                    OR (NEW.unit_price_snapshot IS NOT NULL AND NEW.unit_price_snapshot < 0)
                BEGIN SELECT RAISE(ABORT, 'Inventory item integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER inventory_items_integrity_update BEFORE UPDATE ON inventory_items
                WHEN NEW.version < 1 OR NEW.minimum_stock < 0 OR NEW.on_hand_quantity < 0
                    OR (NEW.unit_price_snapshot IS NOT NULL AND NEW.unit_price_snapshot < 0)
                BEGIN SELECT RAISE(ABORT, 'Inventory item integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_items');
    }
};
