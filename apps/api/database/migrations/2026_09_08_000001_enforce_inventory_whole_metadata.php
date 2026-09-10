<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE inventory_items
                ADD CONSTRAINT inventory_items_minimum_stock_whole CHECK (minimum_stock = trunc(minimum_stock)),
                ADD CONSTRAINT inventory_items_unit_price_whole CHECK (
                    unit_price_snapshot IS NULL OR unit_price_snapshot = trunc(unit_price_snapshot)
                )
            SQL);
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER inventory_items_whole_metadata_insert BEFORE INSERT ON inventory_items
                WHEN NEW.minimum_stock <> CAST(NEW.minimum_stock AS INTEGER)
                    OR (NEW.unit_price_snapshot IS NOT NULL AND NEW.unit_price_snapshot <> CAST(NEW.unit_price_snapshot AS INTEGER))
                BEGIN SELECT RAISE(ABORT, 'Inventory minimum stock and Rupiah price must be whole numbers'); END");

            DB::unprepared("CREATE TRIGGER inventory_items_whole_metadata_update BEFORE UPDATE OF minimum_stock, unit_price_snapshot ON inventory_items
                WHEN NEW.minimum_stock <> CAST(NEW.minimum_stock AS INTEGER)
                    OR (NEW.unit_price_snapshot IS NOT NULL AND NEW.unit_price_snapshot <> CAST(NEW.unit_price_snapshot AS INTEGER))
                BEGIN SELECT RAISE(ABORT, 'Inventory minimum stock and Rupiah price must be whole numbers'); END");
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_minimum_stock_whole');
            DB::statement('ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_unit_price_whole');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared('DROP TRIGGER IF EXISTS inventory_items_whole_metadata_insert');
            DB::unprepared('DROP TRIGGER IF EXISTS inventory_items_whole_metadata_update');
        }
    }
};
