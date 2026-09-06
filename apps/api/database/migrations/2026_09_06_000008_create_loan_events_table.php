<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loan_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('loan_id')->constrained('loans')->restrictOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 80);
            $table->string('before_status', 32)->nullable();
            $table->string('after_status', 32);
            $table->jsonb('payload');
            $table->timestampTz('created_at');

            $table->index(['school_id', 'loan_id', 'created_at'], 'loan_events_loan_time_idx');
        });

        $immutableColumns = 'school_id, loan_id, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, event_type, before_status, after_status, payload, created_at';

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_loan_event_mutation()
                RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'Loan events are immutable';
                END;
                $$ LANGUAGE plpgsql
            SQL);
            DB::statement("CREATE TRIGGER loan_events_immutable_update BEFORE UPDATE OF {$immutableColumns} ON loan_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_loan_event_mutation()");
            DB::statement('CREATE TRIGGER loan_events_immutable_delete BEFORE DELETE ON loan_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_loan_event_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER loan_events_immutable_update BEFORE UPDATE OF {$immutableColumns} ON loan_events
                BEGIN SELECT RAISE(ABORT, 'Loan events are immutable'); END");
            DB::unprepared("CREATE TRIGGER loan_events_immutable_delete BEFORE DELETE ON loan_events
                BEGIN SELECT RAISE(ABORT, 'Loan events are immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('loan_events');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_loan_event_mutation()');
        }
    }
};
