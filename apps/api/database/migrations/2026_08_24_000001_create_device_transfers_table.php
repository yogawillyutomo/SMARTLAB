<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_transfers', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('device_id')->nullable()->constrained('devices')->nullOnDelete();
            $table->ulid('device_id_snapshot');
            $table->string('device_code_snapshot', 32);
            $table->foreignUlid('source_laboratory_id')->nullable()->constrained('laboratories')->nullOnDelete();
            $table->ulid('source_laboratory_id_snapshot');
            $table->string('source_laboratory_code_snapshot', 50);
            $table->string('source_laboratory_name_snapshot', 255);
            $table->foreignUlid('destination_laboratory_id')->nullable()->constrained('laboratories')->nullOnDelete();
            $table->ulid('destination_laboratory_id_snapshot');
            $table->string('destination_laboratory_code_snapshot', 50);
            $table->string('destination_laboratory_name_snapshot', 255);
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('reason', 500)->nullable();
            $table->unsignedBigInteger('device_version_before');
            $table->unsignedBigInteger('device_version_after');
            $table->timestamp('created_at');

            $table->index(['school_id', 'device_id_snapshot', 'created_at', 'id'], 'device_transfers_school_device_created_idx');
            $table->index(['school_id', 'source_laboratory_id_snapshot', 'created_at', 'id'], 'device_transfers_school_source_created_idx');
            $table->index(['school_id', 'destination_laboratory_id_snapshot', 'created_at', 'id'], 'device_transfers_school_destination_created_idx');
        });

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE device_transfers
                ADD CONSTRAINT device_transfers_versions_valid CHECK (
                    device_version_before >= 1 AND device_version_after = device_version_before + 1
                ),
                ADD CONSTRAINT device_transfers_snapshot_values_valid CHECK (
                    char_length(btrim(device_code_snapshot)) BETWEEN 3 AND 32
                    AND char_length(btrim(source_laboratory_code_snapshot)) BETWEEN 1 AND 50
                    AND char_length(btrim(source_laboratory_name_snapshot)) BETWEEN 1 AND 255
                    AND char_length(btrim(destination_laboratory_code_snapshot)) BETWEEN 1 AND 50
                    AND char_length(btrim(destination_laboratory_name_snapshot)) BETWEEN 1 AND 255
                    AND char_length(btrim(actor_name_snapshot)) BETWEEN 1 AND 255
                ),
                ADD CONSTRAINT device_transfers_reason_valid CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
            SQL);
        }
        if ($driver === 'sqlite') {
            foreach (['insert' => 'INSERT', 'update' => 'UPDATE'] as $suffix => $operation) {
                DB::unprepared("CREATE TRIGGER device_transfers_integrity_{$suffix} BEFORE {$operation} ON device_transfers
                    WHEN NEW.device_version_before < 1 OR NEW.device_version_after <> NEW.device_version_before + 1
                      OR length(trim(NEW.device_code_snapshot)) < 3 OR length(trim(NEW.device_code_snapshot)) > 32
                      OR length(trim(NEW.source_laboratory_code_snapshot)) < 1 OR length(trim(NEW.source_laboratory_code_snapshot)) > 50
                      OR length(trim(NEW.source_laboratory_name_snapshot)) < 1 OR length(trim(NEW.source_laboratory_name_snapshot)) > 255
                      OR length(trim(NEW.destination_laboratory_code_snapshot)) < 1 OR length(trim(NEW.destination_laboratory_code_snapshot)) > 50
                      OR length(trim(NEW.destination_laboratory_name_snapshot)) < 1 OR length(trim(NEW.destination_laboratory_name_snapshot)) > 255
                      OR length(trim(NEW.actor_name_snapshot)) < 1 OR length(trim(NEW.actor_name_snapshot)) > 255
                      OR (NEW.reason IS NOT NULL AND (length(trim(NEW.reason)) < 1 OR length(trim(NEW.reason)) > 500))
                    BEGIN SELECT RAISE(ABORT, 'Device transfer integrity constraint failed'); END");
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('device_transfers');
    }
};
