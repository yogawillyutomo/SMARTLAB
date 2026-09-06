<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('asset_code', 32);
            $table->string('name', 255);
            $table->string('category', 120);
            $table->string('brand', 255)->nullable();
            $table->string('model', 255)->nullable();
            $table->string('serial_number', 255)->nullable();
            $table->foreignUlid('home_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->enum('condition', ['good', 'minor_damage', 'moderate_damage', 'major_damage', 'unknown'])->default('unknown');
            $table->enum('lifecycle_status', ['active', 'retired', 'disposed'])->default('active');
            $table->date('acquisition_date')->nullable();
            $table->unsignedSmallInteger('acquisition_year')->nullable();
            $table->string('funding_source', 255)->nullable();
            $table->decimal('purchase_price', 15, 2)->nullable();
            $table->string('supplier_name', 255)->nullable();
            $table->date('warranty_until')->nullable();
            $table->text('notes')->nullable();
            $table->foreignUlid('linked_device_id')->nullable()->constrained('devices')->restrictOnDelete();
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'asset_code']);
            $table->unique('linked_device_id');
            $table->index(['school_id', 'home_laboratory_id']);
            $table->index(['school_id', 'condition']);
            $table->index(['school_id', 'lifecycle_status']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE assets
                ADD CONSTRAINT assets_version_positive CHECK (version >= 1),
                ADD CONSTRAINT assets_price_non_negative CHECK (purchase_price IS NULL OR purchase_price >= 0),
                ADD CONSTRAINT assets_acquisition_year_range CHECK (
                    acquisition_year IS NULL OR acquisition_year BETWEEN 1900 AND 2100
                ),
                ADD CONSTRAINT assets_code_canonical CHECK (
                    char_length(asset_code) BETWEEN 3 AND 32
                    AND asset_code = upper(asset_code)
                    AND asset_code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'
                )
            SQL);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('assets');
    }
};
