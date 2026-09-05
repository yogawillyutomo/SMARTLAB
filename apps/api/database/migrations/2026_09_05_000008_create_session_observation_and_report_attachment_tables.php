<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('session_issue_observations', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('session_id')->constrained('laboratory_sessions')->restrictOnDelete();
            $table->enum('subject_type', ['device', 'asset', 'facility', 'other']);
            $table->string('reference_id', 128)->nullable();
            $table->string('reference_code_snapshot', 255)->nullable();
            $table->text('summary');
            $table->enum('severity', ['low', 'medium', 'high', 'critical']);
            $table->timestampTz('observed_at');
            $table->foreignUlid('observed_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('observed_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->string('observed_by_name_snapshot');
            $table->uuid('promotion_submission_id')->unique();
            $table->foreignUlid('incident_id')->nullable()->constrained('incidents')->restrictOnDelete();
            $table->timestampTz('incident_linked_at')->nullable();
            $table->foreignUlid('incident_linked_by_user_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->foreignUlid('incident_linked_by_membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();
            $table->unsignedInteger('version')->default(1);
            $table->timestampTz('created_at')->useCurrent();

            $table->index(['school_id', 'session_id', 'observed_at'], 'session_issue_observations_session_time_idx');
            $table->index(['school_id', 'incident_id'], 'session_issue_observations_incident_idx');
            $table->index(['school_id', 'subject_type', 'severity'], 'session_issue_observations_subject_severity_idx');
        });

        Schema::create('activity_report_attachments', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('report_id')->constrained('activity_reports')->restrictOnDelete();
            $table->string('storage_provider', 64);
            $table->string('storage_key', 1024);
            $table->string('file_name', 255);
            $table->string('media_type', 128);
            $table->unsignedBigInteger('size_bytes');
            $table->char('sha256', 64);
            $table->foreignUlid('uploaded_by_user_id')->constrained('users')->restrictOnDelete();
            $table->foreignUlid('uploaded_by_membership_id')->constrained('school_memberships')->restrictOnDelete();
            $table->string('uploaded_by_name_snapshot');
            $table->timestampTz('created_at')->useCurrent();

            $table->unique(['storage_provider', 'storage_key'], 'activity_report_attachments_storage_unique');
            $table->index(['school_id', 'report_id', 'created_at'], 'activity_report_attachments_report_time_idx');
            $table->index(['school_id', 'sha256'], 'activity_report_attachments_sha_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE session_issue_observations ADD CONSTRAINT session_issue_observations_version_positive CHECK (version >= 1)');
            DB::statement("ALTER TABLE session_issue_observations ADD CONSTRAINT session_issue_observations_subject_reference_shape CHECK (
                (subject_type = 'device' AND reference_id IS NOT NULL AND reference_code_snapshot IS NOT NULL)
                OR (subject_type IN ('asset','facility','other') AND reference_id IS NULL)
            )");
            DB::statement("ALTER TABLE session_issue_observations ADD CONSTRAINT session_issue_observations_incident_link_shape CHECK (
                (incident_id IS NULL AND incident_linked_at IS NULL AND incident_linked_by_user_id IS NULL AND incident_linked_by_membership_id IS NULL AND version = 1)
                OR (incident_id IS NOT NULL AND incident_linked_at IS NOT NULL AND incident_linked_by_user_id IS NOT NULL AND incident_linked_by_membership_id IS NOT NULL AND version >= 2)
            )");
            DB::statement("ALTER TABLE activity_report_attachments ADD CONSTRAINT activity_report_attachments_size_positive CHECK (size_bytes > 0)");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_report_attachments');
        Schema::dropIfExists('session_issue_observations');
    }
};
