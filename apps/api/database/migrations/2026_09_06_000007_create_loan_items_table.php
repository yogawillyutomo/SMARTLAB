<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loan_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('loan_id')->constrained('loans')->restrictOnDelete();
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->string('asset_code_snapshot', 64);
            $table->string('asset_name_snapshot', 255);
            $table->enum('condition_out', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->enum('condition_return', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->nullable();
            $table->string('return_notes', 2000)->nullable();
            $table->boolean('custody_active')->default(false);
            $table->timestamps();

            $table->unique(['loan_id', 'asset_id']);
            $table->index(['school_id', 'asset_id'], 'loan_items_school_asset_idx');
        });

        DB::statement('CREATE UNIQUE INDEX loan_items_active_asset_unique ON loan_items(asset_id) WHERE custody_active = '.(DB::connection()->getDriverName() === 'pgsql' ? 'TRUE' : '1'));

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE loan_items
                ADD CONSTRAINT loan_items_custody_evidence CHECK (
                    (custody_active = TRUE AND condition_out IS NOT NULL AND condition_return IS NULL)
                    OR (custody_active = FALSE)
                ),
                ADD CONSTRAINT loan_items_return_evidence CHECK (
                    condition_return IS NULL OR custody_active = FALSE
                )
            SQL);
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER loan_items_integrity_insert BEFORE INSERT ON loan_items
                WHEN (NEW.custody_active = 1 AND (NEW.condition_out IS NULL OR NEW.condition_return IS NOT NULL))
                    OR (NEW.condition_return IS NOT NULL AND NEW.custody_active = 1)
                BEGIN SELECT RAISE(ABORT, 'Loan item custody integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER loan_items_integrity_update BEFORE UPDATE ON loan_items
                WHEN (NEW.custody_active = 1 AND (NEW.condition_out IS NULL OR NEW.condition_return IS NOT NULL))
                    OR (NEW.condition_return IS NOT NULL AND NEW.custody_active = 1)
                BEGIN SELECT RAISE(ABORT, 'Loan item custody integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('loan_items');
    }
};
