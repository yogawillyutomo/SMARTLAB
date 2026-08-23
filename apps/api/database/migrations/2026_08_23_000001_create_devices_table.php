<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('devices', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('device_code', 32);
            $table->string('qr_public_id', 27)->unique();
            $table->enum('device_type', [
                'desktop_pc', 'laptop', 'server', 'network_switch', 'router',
                'access_point', 'printer', 'projector', 'ups', 'other',
            ]);
            $table->enum('lifecycle_status', ['in_service', 'spare', 'retired', 'decommissioned'])
                ->default('in_service');
            $table->foreignUlid('home_laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->string('serial_number', 255)->nullable();
            $table->string('hostname', 255)->nullable();
            $table->string('brand', 255)->nullable();
            $table->string('model', 255)->nullable();
            $table->unsignedInteger('technical_profile_version')->default(1);
            $table->jsonb('technical_profile')->default('{}');
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'device_code']);
            $table->index(['school_id', 'home_laboratory_id']);
            $table->index(['school_id', 'device_type']);
            $table->index(['school_id', 'lifecycle_status']);
        });

        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE devices
                ADD CONSTRAINT devices_versions_positive CHECK (version >= 1 AND technical_profile_version >= 1),
                ADD CONSTRAINT devices_profile_object CHECK (jsonb_typeof(technical_profile) = 'object'),
                ADD CONSTRAINT devices_code_canonical CHECK (
                    char_length(device_code) BETWEEN 3 AND 32
                    AND device_code = upper(device_code)
                    AND device_code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'
                )
            SQL);
        }

        if ($driver === 'sqlite') {
            foreach (['insert' => 'NEW', 'update' => 'NEW'] as $operation => $row) {
                DB::unprepared("CREATE TRIGGER devices_integrity_{$operation} BEFORE ".strtoupper($operation)." ON devices
                    WHEN {$row}.version < 1
                      OR {$row}.technical_profile_version < 1
                      OR json_valid({$row}.technical_profile) = 0
                      OR json_type({$row}.technical_profile) <> 'object'
                      OR length({$row}.device_code) < 3
                      OR length({$row}.device_code) > 32
                      OR {$row}.device_code <> upper({$row}.device_code)
                      OR {$row}.device_code GLOB '*[^A-Z0-9-]*'
                      OR substr({$row}.device_code, 1, 1) GLOB '[^A-Z0-9]'
                    BEGIN SELECT RAISE(ABORT, 'Device integrity constraint failed'); END");
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('devices');
    }
};
