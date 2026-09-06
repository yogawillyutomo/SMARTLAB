<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_report_draft_sync_mutations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('report_id')->constrained('activity_reports')->restrictOnDelete();
            $table->uuid('client_mutation_id');
            $table->unsignedInteger('base_version');
            $table->char('payload_sha256', 64);
            $table->unsignedInteger('resulting_version');
            $table->foreignUlid('applied_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('applied_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->timestampTz('applied_at')->useCurrent();

            $table->unique(['report_id', 'client_mutation_id'], 'activity_report_draft_sync_mutations_report_client_unique');
            $table->index(['school_id', 'report_id', 'applied_at'], 'activity_report_draft_sync_mutations_report_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE activity_report_draft_sync_mutations ADD CONSTRAINT activity_report_draft_sync_versions_positive CHECK (base_version >= 1 AND resulting_version >= 2)');
            DB::statement('ALTER TABLE activity_report_draft_sync_mutations ADD CONSTRAINT activity_report_draft_sync_version_step CHECK (resulting_version = base_version + 1)');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER activity_report_draft_sync_integrity_insert BEFORE INSERT ON activity_report_draft_sync_mutations
                WHEN NEW.base_version < 1 OR NEW.resulting_version < 2 OR NEW.resulting_version <> NEW.base_version + 1
                BEGIN SELECT RAISE(ABORT, 'Activity report draft sync integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_report_draft_sync_mutations');
    }
};
