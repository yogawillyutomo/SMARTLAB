<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('laboratories', function (Blueprint $table): void {
            $table->unique(['school_id', 'id'], 'laboratories_school_id_id_unique');
        });
        Schema::table('devices', function (Blueprint $table): void {
            $table->unique(['school_id', 'id'], 'devices_school_id_id_unique');
        });

        Schema::create('layouts', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->ulid('laboratory_id');
            $table->string('name');
            $table->string('template_key', 100)->nullable();
            $table->unsignedSmallInteger('rows');
            $table->unsignedSmallInteger('columns');
            $table->string('status', 16);
            $table->unsignedBigInteger('version')->default(1);
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->timestamps();

            $table->unique(['school_id', 'id'], 'layouts_school_id_id_unique');
            $table->foreign(['school_id', 'laboratory_id'], 'layouts_school_laboratory_fk')
                ->references(['school_id', 'id'])->on('laboratories')->restrictOnDelete();
            $table->index(
                ['school_id', 'laboratory_id', 'status', 'updated_at'],
                'layouts_school_lab_status_updated_idx',
            );
            $table->index(['school_id', 'status', 'updated_at'], 'layouts_school_status_updated_idx');
        });

        Schema::create('layout_structural_elements', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->ulid('school_id');
            $table->ulid('layout_id');
            $table->string('element_type', 32);
            $table->string('label', 60)->nullable();
            $table->unsignedSmallInteger('row');
            $table->unsignedSmallInteger('column');
            $table->unsignedSmallInteger('row_span');
            $table->unsignedSmallInteger('column_span');
            $table->unsignedSmallInteger('rotation')->default(0);
            $table->timestamps();

            $table->foreign(['school_id', 'layout_id'], 'layout_structure_school_layout_fk')
                ->references(['school_id', 'id'])->on('layouts')->cascadeOnDelete();
            $table->index(['school_id', 'layout_id'], 'layout_structure_school_layout_idx');
            $table->index(['layout_id', 'row', 'column'], 'layout_structure_anchor_idx');
        });

        Schema::create('layout_device_placements', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->ulid('school_id');
            $table->ulid('layout_id');
            $table->ulid('device_id');
            $table->string('role', 32)->nullable();
            $table->string('label', 60)->nullable();
            $table->unsignedSmallInteger('row');
            $table->unsignedSmallInteger('column');
            $table->unsignedSmallInteger('row_span');
            $table->unsignedSmallInteger('column_span');
            $table->unsignedSmallInteger('rotation')->default(0);
            $table->timestamps();

            $table->foreign(['school_id', 'layout_id'], 'layout_placements_school_layout_fk')
                ->references(['school_id', 'id'])->on('layouts')->cascadeOnDelete();
            $table->foreign(['school_id', 'device_id'], 'layout_placements_school_device_fk')
                ->references(['school_id', 'id'])->on('devices')->restrictOnDelete();
            $table->unique(['layout_id', 'device_id'], 'layout_placements_layout_device_unique');
            $table->index(['school_id', 'layout_id'], 'layout_placements_school_layout_idx');
            $table->index(['school_id', 'device_id'], 'layout_placements_school_device_idx');
            $table->index(['layout_id', 'row', 'column'], 'layout_placements_anchor_idx');
        });

        Schema::create('layout_change_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('layout_id')->nullable()->constrained('layouts')->nullOnDelete();
            $table->ulid('layout_id_snapshot');
            $table->ulid('laboratory_id_snapshot');
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->ulid('actor_id_snapshot')->nullable();
            $table->string('actor_name_snapshot', 255)->nullable();
            $table->string('event_type', 64);
            $table->jsonb('changed_fields');
            $table->jsonb('changes');
            $table->timestamp('created_at');

            $table->index(
                ['school_id', 'layout_id_snapshot', 'created_at'],
                'layout_events_school_layout_created_idx',
            );
            $table->index(
                ['school_id', 'laboratory_id_snapshot', 'created_at'],
                'layout_events_school_lab_created_idx',
            );
            $table->index(
                ['school_id', 'event_type', 'created_at'],
                'layout_events_school_type_created_idx',
            );
        });

        DB::statement("CREATE UNIQUE INDEX layouts_one_draft_per_laboratory ON layouts (school_id, laboratory_id) WHERE status = 'draft'");
        DB::statement("CREATE UNIQUE INDEX layouts_one_active_per_laboratory ON layouts (school_id, laboratory_id) WHERE status = 'active'");

        $this->addIntegrityConstraints();
    }

    public function down(): void
    {
        Schema::dropIfExists('layout_change_events');
        Schema::dropIfExists('layout_device_placements');
        Schema::dropIfExists('layout_structural_elements');
        Schema::dropIfExists('layouts');

        Schema::table('devices', function (Blueprint $table): void {
            $table->dropUnique('devices_school_id_id_unique');
        });
        Schema::table('laboratories', function (Blueprint $table): void {
            $table->dropUnique('laboratories_school_id_id_unique');
        });
    }

    private function addIntegrityConstraints(): void
    {
        $driver = DB::connection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE layouts
                ADD CONSTRAINT layouts_name_nonblank CHECK (char_length(btrim(name)) BETWEEN 1 AND 255),
                ADD CONSTRAINT layouts_dimensions_valid CHECK (rows BETWEEN 1 AND 50 AND columns BETWEEN 1 AND 50),
                ADD CONSTRAINT layouts_status_valid CHECK (status IN ('draft', 'active', 'archived')),
                ADD CONSTRAINT layouts_version_positive CHECK (version >= 1),
                ADD CONSTRAINT layouts_lifecycle_timestamps_valid CHECK (
                    (status = 'draft' AND activated_at IS NULL AND archived_at IS NULL)
                    OR (status = 'active' AND activated_at IS NOT NULL AND archived_at IS NULL)
                    OR (status = 'archived' AND activated_at IS NOT NULL AND archived_at IS NOT NULL)
                )
            SQL);
            DB::statement(<<<'SQL'
                ALTER TABLE layout_structural_elements
                ADD CONSTRAINT layout_structure_type_valid CHECK (element_type IN ('teacher_desk', 'door', 'window', 'wall', 'aisle', 'label')),
                ADD CONSTRAINT layout_structure_geometry_positive CHECK (row >= 1 AND "column" >= 1 AND row_span >= 1 AND column_span >= 1),
                ADD CONSTRAINT layout_structure_rotation_valid CHECK (rotation IN (0, 90, 180, 270)),
                ADD CONSTRAINT layout_structure_label_valid CHECK (
                    (element_type = 'aisle' AND label IS NULL)
                    OR (element_type = 'label' AND label IS NOT NULL AND char_length(btrim(label)) BETWEEN 1 AND 60)
                    OR (element_type NOT IN ('aisle', 'label') AND (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60))
                )
            SQL);
            DB::statement(<<<'SQL'
                ALTER TABLE layout_device_placements
                ADD CONSTRAINT layout_placements_role_valid CHECK (role IS NULL OR role IN ('student_station', 'teacher_station')),
                ADD CONSTRAINT layout_placements_geometry_positive CHECK (row >= 1 AND "column" >= 1 AND row_span >= 1 AND column_span >= 1),
                ADD CONSTRAINT layout_placements_rotation_valid CHECK (rotation IN (0, 90, 180, 270)),
                ADD CONSTRAINT layout_placements_label_valid CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 60)
            SQL);
        }

        if ($driver === 'sqlite') {
            $this->createSqliteIntegrityTriggers();
        }
    }

    private function createSqliteIntegrityTriggers(): void
    {
        foreach (['insert' => 'INSERT', 'update' => 'UPDATE'] as $suffix => $operation) {
            DB::unprepared("CREATE TRIGGER layouts_integrity_{$suffix} BEFORE {$operation} ON layouts
                WHEN length(trim(NEW.name)) < 1 OR length(NEW.name) > 255
                  OR NEW.rows < 1 OR NEW.rows > 50 OR NEW.columns < 1 OR NEW.columns > 50
                  OR NEW.status NOT IN ('draft', 'active', 'archived') OR NEW.version < 1
                  OR NOT (
                    (NEW.status = 'draft' AND NEW.activated_at IS NULL AND NEW.archived_at IS NULL)
                    OR (NEW.status = 'active' AND NEW.activated_at IS NOT NULL AND NEW.archived_at IS NULL)
                    OR (NEW.status = 'archived' AND NEW.activated_at IS NOT NULL AND NEW.archived_at IS NOT NULL)
                  )
                BEGIN SELECT RAISE(ABORT, 'Layout integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER layout_structure_integrity_{$suffix} BEFORE {$operation} ON layout_structural_elements
                WHEN NEW.element_type NOT IN ('teacher_desk', 'door', 'window', 'wall', 'aisle', 'label')
                  OR NEW.row < 1 OR NEW.column < 1 OR NEW.row_span < 1 OR NEW.column_span < 1
                  OR NEW.rotation NOT IN (0, 90, 180, 270)
                  OR (NEW.element_type = 'aisle' AND NEW.label IS NOT NULL)
                  OR (NEW.element_type = 'label' AND (NEW.label IS NULL OR length(trim(NEW.label)) < 1 OR length(NEW.label) > 60))
                  OR (NEW.element_type NOT IN ('aisle', 'label') AND NEW.label IS NOT NULL AND (length(trim(NEW.label)) < 1 OR length(NEW.label) > 60))
                BEGIN SELECT RAISE(ABORT, 'Layout structural element integrity constraint failed'); END");

            DB::unprepared("CREATE TRIGGER layout_placement_integrity_{$suffix} BEFORE {$operation} ON layout_device_placements
                WHEN (NEW.role IS NOT NULL AND NEW.role NOT IN ('student_station', 'teacher_station'))
                  OR NEW.row < 1 OR NEW.column < 1 OR NEW.row_span < 1 OR NEW.column_span < 1
                  OR NEW.rotation NOT IN (0, 90, 180, 270)
                  OR (NEW.label IS NOT NULL AND (length(trim(NEW.label)) < 1 OR length(NEW.label) > 60))
                BEGIN SELECT RAISE(ABORT, 'Layout Device placement integrity constraint failed'); END");
        }
    }
};
