<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('academic_years', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'code']);
            $table->index(['school_id', 'status']);
            $table->index(['school_id', 'starts_on', 'ends_on']);
        });

        Schema::create('semesters', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('academic_year_id')->constrained('academic_years')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['academic_year_id', 'code']);
            $table->index(['school_id', 'status']);
            $table->index(['academic_year_id', 'starts_on', 'ends_on']);
        });

        Schema::create('lesson_period_sets', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('academic_year_id')->constrained('academic_years')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['academic_year_id', 'code']);
            $table->index(['school_id', 'status']);
        });

        Schema::create('lesson_periods', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('lesson_period_set_id')->constrained('lesson_period_sets')->restrictOnDelete();
            $table->string('code', 64);
            $table->unsignedSmallInteger('sequence');
            $table->time('starts_at');
            $table->time('ends_at');
            $table->enum('kind', ['instruction', 'break']);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['lesson_period_set_id', 'code']);
            $table->unique(['lesson_period_set_id', 'sequence']);
            $table->index(['school_id', 'status']);
            $table->index(['lesson_period_set_id', 'starts_at', 'ends_at']);
        });

        Schema::create('academic_master_events', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('entity_type', 64);
            $table->string('entity_id_snapshot', 26);
            $table->string('entity_code_snapshot', 64);
            $table->string('actor_user_id_snapshot', 26);
            $table->string('actor_membership_id_snapshot', 26);
            $table->string('actor_name_snapshot');
            $table->string('event_type', 64);
            $table->json('payload');
            $table->unsignedInteger('entity_version_before');
            $table->unsignedInteger('entity_version_after');
            $table->timestamp('created_at')->useCurrent();

            $table->index(['school_id', 'created_at']);
            $table->index(['school_id', 'entity_type', 'entity_id_snapshot', 'created_at'], 'academic_master_entity_history_idx');
            $table->index(['school_id', 'event_type', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('academic_master_events');
        Schema::dropIfExists('lesson_periods');
        Schema::dropIfExists('lesson_period_sets');
        Schema::dropIfExists('semesters');
        Schema::dropIfExists('academic_years');
    }
};
