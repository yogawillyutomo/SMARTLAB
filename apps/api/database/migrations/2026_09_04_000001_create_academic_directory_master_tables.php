<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::connection()->getDriverName();

        Schema::create('academic_units', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->enum('type', ['department', 'program', 'concentration', 'other']);
            $table->ulid('parent_id')->nullable();
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'code']);
            $table->index(['school_id', 'status']);
            $table->index(['school_id', 'parent_id']);
        });

        if ($driver === 'pgsql') {
            Schema::table('academic_units', function (Blueprint $table) {
                $table->foreign('parent_id', 'academic_units_parent_id_foreign')
                    ->references('id')
                    ->on('academic_units')
                    ->restrictOnDelete();
            });
        }

        Schema::create('teachers', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('personnel_number', 64)->nullable();
            $table->string('name');
            $table->string('email')->nullable();
            $table->string('phone', 64)->nullable();
            $table->foreignUlid('academic_unit_id')->nullable()->constrained('academic_units')->restrictOnDelete();
            $table->foreignUlid('membership_id')->nullable()->constrained('school_memberships')->restrictOnDelete();
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'code']);
            $table->unique(['school_id', 'personnel_number']);
            $table->unique(['school_id', 'membership_id']);
            $table->index(['school_id', 'status']);
            $table->index(['school_id', 'academic_unit_id']);
        });

        Schema::create('academic_classes', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->unsignedSmallInteger('grade_level');
            $table->foreignUlid('academic_unit_id')->nullable()->constrained('academic_units')->restrictOnDelete();
            $table->foreignUlid('homeroom_teacher_id')->nullable()->constrained('teachers')->restrictOnDelete();
            $table->unsignedInteger('student_count')->default(0);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'code']);
            $table->index(['school_id', 'status']);
            $table->index(['school_id', 'academic_unit_id']);
            $table->index(['school_id', 'homeroom_teacher_id']);
        });

        Schema::create('subjects', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->string('code', 64);
            $table->string('name');
            $table->string('group_name')->nullable();
            $table->foreignUlid('academic_unit_id')->nullable()->constrained('academic_units')->restrictOnDelete();
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            $table->unique(['school_id', 'code']);
            $table->index(['school_id', 'status']);
            $table->index(['school_id', 'academic_unit_id']);
        });

        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE academic_units ADD CONSTRAINT academic_units_version_positive CHECK (version >= 1)');
            DB::statement('ALTER TABLE teachers ADD CONSTRAINT teachers_version_positive CHECK (version >= 1)');
            DB::statement('ALTER TABLE academic_classes ADD CONSTRAINT academic_classes_integrity CHECK (version >= 1 AND grade_level BETWEEN 1 AND 20 AND student_count >= 0)');
            DB::statement('ALTER TABLE subjects ADD CONSTRAINT subjects_version_positive CHECK (version >= 1)');
        }

        if ($driver === 'sqlite') {
            DB::unprepared("CREATE TRIGGER academic_units_parent_insert BEFORE INSERT ON academic_units WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_units WHERE id = NEW.parent_id) BEGIN SELECT RAISE(ABORT, 'Academic Unit parent foreign key constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_units_parent_update BEFORE UPDATE OF parent_id ON academic_units WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM academic_units WHERE id = NEW.parent_id) BEGIN SELECT RAISE(ABORT, 'Academic Unit parent foreign key constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_units_parent_delete BEFORE DELETE ON academic_units WHEN EXISTS (SELECT 1 FROM academic_units WHERE parent_id = OLD.id) BEGIN SELECT RAISE(ABORT, 'Academic Unit parent restrict delete constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_units_integrity_insert BEFORE INSERT ON academic_units WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Academic Unit integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_units_integrity_update BEFORE UPDATE ON academic_units WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Academic Unit integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER teachers_integrity_insert BEFORE INSERT ON teachers WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Teacher integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER teachers_integrity_update BEFORE UPDATE ON teachers WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Teacher integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_classes_integrity_insert BEFORE INSERT ON academic_classes WHEN NEW.version < 1 OR NEW.grade_level < 1 OR NEW.grade_level > 20 OR NEW.student_count < 0 BEGIN SELECT RAISE(ABORT, 'Academic Class integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER academic_classes_integrity_update BEFORE UPDATE ON academic_classes WHEN NEW.version < 1 OR NEW.grade_level < 1 OR NEW.grade_level > 20 OR NEW.student_count < 0 BEGIN SELECT RAISE(ABORT, 'Academic Class integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER subjects_integrity_insert BEFORE INSERT ON subjects WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Subject integrity constraint failed'); END");
            DB::unprepared("CREATE TRIGGER subjects_integrity_update BEFORE UPDATE ON subjects WHEN NEW.version < 1 BEGIN SELECT RAISE(ABORT, 'Subject integrity constraint failed'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('subjects');
        Schema::dropIfExists('academic_classes');
        Schema::dropIfExists('teachers');
        Schema::dropIfExists('academic_units');
    }
};
