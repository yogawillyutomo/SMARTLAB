<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('loans', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('loan_number', 48);
            $table->string('borrower_reference', 255)->nullable();
            $table->string('borrower_name_snapshot', 255);
            $table->string('borrower_unit_snapshot', 255)->nullable();
            $table->string('purpose', 2000);
            $table->timestampTz('requested_return_at');
            $table->enum('status', ['submitted', 'approved', 'rejected', 'cancelled', 'checked_out', 'returned', 'closed'])->default('submitted');
            $table->string('terminal_reason', 1000)->nullable();

            $table->foreignUlid('requested_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('requested_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('requested_by_user_id_snapshot');
            $table->ulid('requested_by_membership_id_snapshot');
            $table->string('requested_by_name_snapshot', 255);

            foreach (['approved', 'handed_over', 'returned', 'inspected'] as $action) {
                $table->timestampTz($action.'_at')->nullable();
                $table->foreignUlid($action.'_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignUlid($action.'_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
                $table->ulid($action.'_by_user_id_snapshot')->nullable();
                $table->ulid($action.'_by_membership_id_snapshot')->nullable();
                $table->string($action.'_by_name_snapshot', 255)->nullable();
            }

            $table->unsignedBigInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'loan_number']);
            $table->index(['school_id', 'status', 'requested_return_at'], 'loans_school_status_return_idx');
            $table->index(['school_id', 'requested_by_membership_id'], 'loans_school_requester_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE loans
                ADD CONSTRAINT loans_version_positive CHECK (version >= 1),
                ADD CONSTRAINT loans_terminal_reason_consistency CHECK (
                    (status IN ('rejected', 'cancelled') AND terminal_reason IS NOT NULL)
                    OR (status NOT IN ('rejected', 'cancelled') AND terminal_reason IS NULL)
                ),
                ADD CONSTRAINT loans_lifecycle_timestamps CHECK (
                    (status = 'submitted' AND approved_at IS NULL AND handed_over_at IS NULL AND returned_at IS NULL AND inspected_at IS NULL)
                    OR (status = 'approved' AND approved_at IS NOT NULL AND handed_over_at IS NULL AND returned_at IS NULL AND inspected_at IS NULL)
                    OR (status = 'checked_out' AND approved_at IS NOT NULL AND handed_over_at IS NOT NULL AND returned_at IS NULL AND inspected_at IS NULL)
                    OR (status = 'returned' AND approved_at IS NOT NULL AND handed_over_at IS NOT NULL AND returned_at IS NOT NULL AND inspected_at IS NULL)
                    OR (status = 'closed' AND approved_at IS NOT NULL AND handed_over_at IS NOT NULL AND returned_at IS NOT NULL AND inspected_at IS NOT NULL)
                    OR (status = 'rejected' AND handed_over_at IS NULL AND returned_at IS NULL AND inspected_at IS NULL)
                    OR (status = 'cancelled' AND handed_over_at IS NULL AND returned_at IS NULL AND inspected_at IS NULL)
                )
            SQL);
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::unprepared("CREATE TRIGGER loans_integrity_insert BEFORE INSERT ON loans
                WHEN NEW.version < 1
                    OR ((NEW.status IN ('rejected','cancelled')) <> (NEW.terminal_reason IS NOT NULL))
                    OR (NEW.status = 'submitted' AND (NEW.approved_at IS NOT NULL OR NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'approved' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'checked_out' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'returned' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'closed' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NULL OR NEW.inspected_at IS NULL))
                    OR (NEW.status IN ('rejected','cancelled') AND (NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                BEGIN SELECT RAISE(ABORT, 'Loan integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER loans_integrity_update BEFORE UPDATE ON loans
                WHEN NEW.version < 1
                    OR ((NEW.status IN ('rejected','cancelled')) <> (NEW.terminal_reason IS NOT NULL))
                    OR (NEW.status = 'submitted' AND (NEW.approved_at IS NOT NULL OR NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'approved' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'checked_out' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'returned' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NULL OR NEW.inspected_at IS NOT NULL))
                    OR (NEW.status = 'closed' AND (NEW.approved_at IS NULL OR NEW.handed_over_at IS NULL OR NEW.returned_at IS NULL OR NEW.inspected_at IS NULL))
                    OR (NEW.status IN ('rejected','cancelled') AND (NEW.handed_over_at IS NOT NULL OR NEW.returned_at IS NOT NULL OR NEW.inspected_at IS NOT NULL))
                BEGIN SELECT RAISE(ABORT, 'Loan integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('loans');
    }
};
