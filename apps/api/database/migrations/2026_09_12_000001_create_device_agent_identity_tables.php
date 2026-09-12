<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_agent_enrollments', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('device_id')->constrained('devices')->restrictOnDelete();
            $table->char('code_hash', 64)->unique();
            $table->enum('status', ['pending', 'redeemed', 'expired', 'revoked'])->default('pending');
            $table->foreignUlid('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('created_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('created_by_user_id_snapshot');
            $table->ulid('created_by_membership_id_snapshot');
            $table->string('created_by_name_snapshot', 255);
            $table->timestampTz('expires_at');
            $table->timestampTz('redeemed_at')->nullable();
            $table->foreignUlid('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('revoked_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('revoked_by_user_id_snapshot')->nullable();
            $table->ulid('revoked_by_membership_id_snapshot')->nullable();
            $table->string('revoked_by_name_snapshot', 255)->nullable();
            $table->string('revoked_reason', 1000)->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();

            $table->index(['school_id', 'device_id', 'status'], 'device_agent_enrollment_scope_idx');
        });

        Schema::create('device_agent_installations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('device_id')->constrained('devices')->restrictOnDelete();
            $table->foreignUlid('enrollment_id')->unique()->constrained('device_agent_enrollments')->restrictOnDelete();
            $table->enum('status', ['active', 'revoked'])->default('active');
            $table->char('credential_id', 32)->unique();
            $table->char('credential_secret_hash', 64);
            $table->unsignedInteger('credential_version')->default(1);
            $table->foreignUlid('enrolled_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('enrolled_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('enrolled_by_user_id_snapshot');
            $table->ulid('enrolled_by_membership_id_snapshot');
            $table->string('enrolled_by_name_snapshot', 255);
            $table->timestampTz('enrolled_at');
            $table->foreignUlid('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('revoked_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('revoked_by_user_id_snapshot')->nullable();
            $table->ulid('revoked_by_membership_id_snapshot')->nullable();
            $table->string('revoked_by_name_snapshot', 255)->nullable();
            $table->string('revoked_reason', 1000)->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampTz('last_authenticated_at')->nullable();
            $table->string('last_agent_version', 64)->nullable();
            $table->timestampsTz();

            $table->index(['school_id', 'device_id', 'status'], 'device_agent_installation_scope_idx');
        });

        DB::statement("CREATE UNIQUE INDEX device_agent_one_pending_enrollment_per_device ON device_agent_enrollments (device_id) WHERE status = 'pending'");
        DB::statement("CREATE UNIQUE INDEX device_agent_one_active_installation_per_device ON device_agent_installations (device_id) WHERE status = 'active'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION laras_validate_device_agent_scope()
                RETURNS trigger AS $laras$
                DECLARE device_school char(26);
                BEGIN
                    SELECT school_id INTO device_school FROM devices WHERE id = NEW.device_id;
                    IF device_school IS NULL OR device_school <> NEW.school_id THEN
                        RAISE EXCEPTION 'Device agent record must bind an exact Device in the same School';
                    END IF;
                    RETURN NEW;
                END;
                $laras$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION laras_validate_device_agent_installation_enrollment()
                RETURNS trigger AS $laras$
                DECLARE enrollment_school char(26); enrollment_device char(26);
                BEGIN
                    SELECT school_id, device_id INTO enrollment_school, enrollment_device
                    FROM device_agent_enrollments WHERE id = NEW.enrollment_id;
                    IF enrollment_school IS NULL
                        OR enrollment_school <> NEW.school_id
                        OR enrollment_device <> NEW.device_id
                    THEN
                        RAISE EXCEPTION 'Device agent installation must match its enrollment School and Device';
                    END IF;
                    RETURN NEW;
                END;
                $laras$ LANGUAGE plpgsql
            SQL);

            DB::statement('CREATE TRIGGER device_agent_enrollment_scope_guard BEFORE INSERT OR UPDATE OF school_id, device_id ON device_agent_enrollments FOR EACH ROW EXECUTE FUNCTION laras_validate_device_agent_scope()');
            DB::statement('CREATE TRIGGER device_agent_installation_scope_guard BEFORE INSERT OR UPDATE OF school_id, device_id ON device_agent_installations FOR EACH ROW EXECUTE FUNCTION laras_validate_device_agent_scope()');
            DB::statement('CREATE TRIGGER device_agent_installation_enrollment_guard BEFORE INSERT OR UPDATE OF school_id, device_id, enrollment_id ON device_agent_installations FOR EACH ROW EXECUTE FUNCTION laras_validate_device_agent_installation_enrollment()');
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP TRIGGER IF EXISTS device_agent_installation_enrollment_guard ON device_agent_installations');
            DB::statement('DROP TRIGGER IF EXISTS device_agent_installation_scope_guard ON device_agent_installations');
            DB::statement('DROP TRIGGER IF EXISTS device_agent_enrollment_scope_guard ON device_agent_enrollments');
            DB::statement('DROP FUNCTION IF EXISTS laras_validate_device_agent_installation_enrollment()');
            DB::statement('DROP FUNCTION IF EXISTS laras_validate_device_agent_scope()');
        }

        Schema::dropIfExists('device_agent_installations');
        Schema::dropIfExists('device_agent_enrollments');
    }
};
