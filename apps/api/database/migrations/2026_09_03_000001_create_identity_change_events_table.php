<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('identity_change_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();

            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);

            $table->foreignUlid('target_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('target_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('target_user_id_snapshot');
            $table->ulid('target_membership_id_snapshot');
            $table->string('target_name_snapshot', 255);

            $table->string('event_type', 64);
            $table->jsonb('payload');
            $table->timestamp('created_at');

            $table->index(['school_id', 'created_at', 'id'], 'identity_events_school_created_idx');
            $table->index(
                ['school_id', 'target_membership_id_snapshot', 'created_at', 'id'],
                'identity_events_target_created_idx',
            );
        });

        $this->addImmutabilityGuards();
    }

    public function down(): void
    {
        Schema::dropIfExists('identity_change_events');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS enforce_identity_change_event_immutability()');
        }
    }

    private function addImmutabilityGuards(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION enforce_identity_change_event_immutability()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'identity_change_events are immutable';
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER identity_change_events_immutable_update
                BEFORE UPDATE ON identity_change_events
                FOR EACH ROW EXECUTE FUNCTION enforce_identity_change_event_immutability();

                CREATE TRIGGER identity_change_events_immutable_delete
                BEFORE DELETE ON identity_change_events
                FOR EACH ROW EXECUTE FUNCTION enforce_identity_change_event_immutability();
            SQL);

            return;
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER identity_change_events_immutable_update
                BEFORE UPDATE ON identity_change_events
                BEGIN
                    SELECT RAISE(ABORT, 'identity_change_events are immutable');
                END;

                CREATE TRIGGER identity_change_events_immutable_delete
                BEFORE DELETE ON identity_change_events
                BEGIN
                    SELECT RAISE(ABORT, 'identity_change_events are immutable');
                END;
            SQL);
        }
    }
};
