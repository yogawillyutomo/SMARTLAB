<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('asset_qr_identities', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->uuid('public_id')->unique();
            $table->unsignedInteger('token_version');
            $table->enum('status', ['active', 'revoked'])->default('active');

            $table->foreignUlid('issued_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('issued_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('issued_by_user_id_snapshot');
            $table->ulid('issued_by_membership_id_snapshot');
            $table->string('issued_by_name_snapshot', 255);
            $table->timestampTz('issued_at');

            $table->foreignUlid('revoked_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('revoked_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('revoked_by_user_id_snapshot')->nullable();
            $table->ulid('revoked_by_membership_id_snapshot')->nullable();
            $table->string('revoked_by_name_snapshot', 255)->nullable();
            $table->string('revoked_reason', 1000)->nullable();
            $table->timestampTz('revoked_at')->nullable();

            $table->unique(['asset_id', 'token_version'], 'asset_qr_identity_asset_version_unique');
            $table->index(['school_id', 'asset_id', 'status'], 'asset_qr_identity_scope_idx');
        });

        Schema::create('asset_qr_label_batches', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('laboratory_id')->nullable()->constrained('laboratories')->restrictOnDelete();
            $table->string('laboratory_code_snapshot', 50)->nullable();
            $table->string('laboratory_name_snapshot', 255)->nullable();
            $table->enum('template_key', ['40x25', '50x30', '70x40']);
            $table->jsonb('filters');
            $table->unsignedInteger('asset_count');
            $table->foreignUlid('generated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('generated_by_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('generated_by_user_id_snapshot');
            $table->ulid('generated_by_membership_id_snapshot');
            $table->string('generated_by_name_snapshot', 255);
            $table->timestampTz('generated_at');

            $table->index(['school_id', 'laboratory_id', 'generated_at'], 'asset_qr_label_batches_scope_idx');
        });

        Schema::create('asset_qr_label_batch_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('asset_qr_label_batch_id')->constrained('asset_qr_label_batches')->restrictOnDelete();
            $table->foreignUlid('asset_id')->constrained('assets')->restrictOnDelete();
            $table->foreignUlid('asset_qr_identity_id')->constrained('asset_qr_identities')->restrictOnDelete();
            $table->unsignedInteger('ordinal');
            $table->string('asset_code_snapshot', 32);
            $table->string('asset_name_snapshot', 255);
            $table->ulid('laboratory_id_snapshot')->nullable();
            $table->string('laboratory_code_snapshot', 50)->nullable();
            $table->string('laboratory_name_snapshot', 255)->nullable();
            $table->uuid('public_id_snapshot');
            $table->unsignedInteger('token_version_snapshot');
            $table->timestampTz('created_at');

            $table->unique(['asset_qr_label_batch_id', 'asset_id'], 'asset_qr_label_item_asset_unique');
            $table->unique(['asset_qr_label_batch_id', 'ordinal'], 'asset_qr_label_item_ordinal_unique');
            $table->index(['school_id', 'asset_id', 'created_at'], 'asset_qr_label_items_asset_idx');
        });

        Schema::create('asset_qr_label_batch_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('asset_qr_label_batch_id')->constrained('asset_qr_label_batches')->restrictOnDelete();
            $table->enum('event_type', ['generated', 'reprinted']);
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->jsonb('payload');
            $table->timestampTz('created_at');

            $table->index(['school_id', 'asset_qr_label_batch_id', 'created_at'], 'asset_qr_label_events_time_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("CREATE UNIQUE INDEX asset_qr_identity_one_active_per_asset ON asset_qr_identities (asset_id) WHERE status = 'active'");
            DB::statement(<<<'SQL'
                ALTER TABLE asset_qr_identities
                ADD CONSTRAINT asset_qr_identity_token_version_positive CHECK (token_version >= 1),
                ADD CONSTRAINT asset_qr_identity_revocation_state CHECK (
                    (status = 'active'
                        AND revoked_by_user_id_snapshot IS NULL
                        AND revoked_by_membership_id_snapshot IS NULL
                        AND revoked_by_name_snapshot IS NULL
                        AND revoked_reason IS NULL
                        AND revoked_at IS NULL)
                    OR
                    (status = 'revoked'
                        AND revoked_by_user_id_snapshot IS NOT NULL
                        AND revoked_by_membership_id_snapshot IS NOT NULL
                        AND revoked_by_name_snapshot IS NOT NULL
                        AND revoked_reason IS NOT NULL
                        AND char_length(trim(revoked_reason)) >= 3
                        AND revoked_at IS NOT NULL)
                )
            SQL);
            DB::statement(<<<'SQL'
                ALTER TABLE asset_qr_label_batches
                ADD CONSTRAINT asset_qr_label_batch_asset_count_positive CHECK (asset_count >= 1),
                ADD CONSTRAINT asset_qr_label_batch_filters_object CHECK (jsonb_typeof(filters) = 'object'),
                ADD CONSTRAINT asset_qr_label_batch_lab_snapshot_pair CHECK (
                    (laboratory_id IS NULL AND laboratory_code_snapshot IS NULL AND laboratory_name_snapshot IS NULL)
                    OR
                    (laboratory_id IS NOT NULL AND laboratory_code_snapshot IS NOT NULL AND laboratory_name_snapshot IS NOT NULL)
                )
            SQL);
            DB::statement(<<<'SQL'
                ALTER TABLE asset_qr_label_batch_items
                ADD CONSTRAINT asset_qr_label_item_ordinal_positive CHECK (ordinal >= 1),
                ADD CONSTRAINT asset_qr_label_item_token_version_positive CHECK (token_version_snapshot >= 1),
                ADD CONSTRAINT asset_qr_label_item_lab_snapshot_pair CHECK (
                    (laboratory_id_snapshot IS NULL AND laboratory_code_snapshot IS NULL AND laboratory_name_snapshot IS NULL)
                    OR
                    (laboratory_id_snapshot IS NOT NULL AND laboratory_code_snapshot IS NOT NULL AND laboratory_name_snapshot IS NOT NULL)
                )
            SQL);
            DB::statement("ALTER TABLE asset_qr_label_batch_events ADD CONSTRAINT asset_qr_label_event_payload_object CHECK (jsonb_typeof(payload) = 'object')");

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_validate_asset_qr_identity()
                RETURNS trigger AS $smartlab$
                DECLARE asset_school char(26);
                BEGIN
                    SELECT school_id INTO asset_school FROM assets WHERE id = NEW.asset_id;
                    IF asset_school IS NULL OR asset_school <> NEW.school_id THEN
                        RAISE EXCEPTION 'Asset QR identity must bind one exact Asset in the same School';
                    END IF;
                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_protect_asset_qr_identity()
                RETURNS trigger AS $smartlab$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Asset QR identities are retained as history';
                    END IF;

                    IF NEW.school_id IS DISTINCT FROM OLD.school_id
                        OR NEW.asset_id IS DISTINCT FROM OLD.asset_id
                        OR NEW.public_id IS DISTINCT FROM OLD.public_id
                        OR NEW.token_version IS DISTINCT FROM OLD.token_version
                        OR NEW.issued_by_user_id_snapshot IS DISTINCT FROM OLD.issued_by_user_id_snapshot
                        OR NEW.issued_by_membership_id_snapshot IS DISTINCT FROM OLD.issued_by_membership_id_snapshot
                        OR NEW.issued_by_name_snapshot IS DISTINCT FROM OLD.issued_by_name_snapshot
                        OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
                    THEN
                        RAISE EXCEPTION 'Asset QR identity issue evidence is immutable';
                    END IF;

                    IF NEW.issued_by_user_id IS DISTINCT FROM OLD.issued_by_user_id AND NEW.issued_by_user_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Asset QR identity live issuer link may only be nulled';
                    END IF;
                    IF NEW.issued_by_membership_id IS DISTINCT FROM OLD.issued_by_membership_id AND NEW.issued_by_membership_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Asset QR identity live issuer membership link may only be nulled';
                    END IF;
                    IF NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id AND OLD.revoked_by_user_id IS NOT NULL AND NEW.revoked_by_user_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Asset QR identity live revoker link may only be nulled';
                    END IF;
                    IF NEW.revoked_by_membership_id IS DISTINCT FROM OLD.revoked_by_membership_id AND OLD.revoked_by_membership_id IS NOT NULL AND NEW.revoked_by_membership_id IS NOT NULL THEN
                        RAISE EXCEPTION 'Asset QR identity live revoker membership link may only be nulled';
                    END IF;

                    IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
                        RETURN NEW;
                    END IF;

                    IF NEW.status IS DISTINCT FROM OLD.status
                        OR NEW.revoked_by_user_id_snapshot IS DISTINCT FROM OLD.revoked_by_user_id_snapshot
                        OR NEW.revoked_by_membership_id_snapshot IS DISTINCT FROM OLD.revoked_by_membership_id_snapshot
                        OR NEW.revoked_by_name_snapshot IS DISTINCT FROM OLD.revoked_by_name_snapshot
                        OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason
                        OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
                    THEN
                        RAISE EXCEPTION 'Asset QR identity permits only one active-to-revoked transition';
                    END IF;

                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_validate_asset_qr_label_batch()
                RETURNS trigger AS $smartlab$
                DECLARE lab_school char(26); lab_code varchar(50); lab_name varchar(255);
                BEGIN
                    IF NEW.laboratory_id IS NOT NULL THEN
                        SELECT school_id, code, name INTO lab_school, lab_code, lab_name
                        FROM laboratories WHERE id = NEW.laboratory_id;
                        IF lab_school IS NULL OR lab_school <> NEW.school_id
                            OR lab_code <> NEW.laboratory_code_snapshot
                            OR lab_name <> NEW.laboratory_name_snapshot
                        THEN
                            RAISE EXCEPTION 'Asset QR label batch Laboratory snapshot mismatch';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_validate_asset_qr_label_item()
                RETURNS trigger AS $smartlab$
                DECLARE
                    batch_school char(26);
                    asset_school char(26);
                    asset_code_value varchar(32);
                    asset_name_value varchar(255);
                    asset_lab char(26);
                    qr_school char(26);
                    qr_asset char(26);
                    qr_public uuid;
                    qr_version integer;
                    lab_code_value varchar(50);
                    lab_name_value varchar(255);
                BEGIN
                    SELECT school_id INTO batch_school FROM asset_qr_label_batches WHERE id = NEW.asset_qr_label_batch_id;
                    SELECT school_id, asset_code, name, home_laboratory_id
                    INTO asset_school, asset_code_value, asset_name_value, asset_lab
                    FROM assets WHERE id = NEW.asset_id;
                    SELECT school_id, asset_id, public_id, token_version
                    INTO qr_school, qr_asset, qr_public, qr_version
                    FROM asset_qr_identities WHERE id = NEW.asset_qr_identity_id;

                    IF NEW.laboratory_id_snapshot IS NOT NULL THEN
                        SELECT code, name INTO lab_code_value, lab_name_value
                        FROM laboratories
                        WHERE id = NEW.laboratory_id_snapshot AND school_id = NEW.school_id;
                    END IF;

                    IF batch_school IS NULL OR batch_school <> NEW.school_id
                        OR asset_school IS NULL OR asset_school <> NEW.school_id
                        OR qr_school IS NULL OR qr_school <> NEW.school_id OR qr_asset <> NEW.asset_id
                        OR asset_code_value <> NEW.asset_code_snapshot OR asset_name_value <> NEW.asset_name_snapshot
                        OR qr_public <> NEW.public_id_snapshot OR qr_version <> NEW.token_version_snapshot
                        OR asset_lab IS DISTINCT FROM NEW.laboratory_id_snapshot
                        OR (NEW.laboratory_id_snapshot IS NOT NULL AND (
                            lab_code_value IS NULL OR lab_code_value <> NEW.laboratory_code_snapshot OR lab_name_value <> NEW.laboratory_name_snapshot
                        ))
                    THEN
                        RAISE EXCEPTION 'Asset QR label item must exactly match Batch, Asset, QR identity, and Laboratory snapshots';
                    END IF;
                    RETURN NEW;
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()
                RETURNS trigger AS $smartlab$
                BEGIN
                    RAISE EXCEPTION 'Asset QR label evidence is immutable';
                END;
                $smartlab$ LANGUAGE plpgsql
            SQL);

            DB::statement('CREATE TRIGGER asset_qr_identity_validate_insert BEFORE INSERT ON asset_qr_identities FOR EACH ROW EXECUTE FUNCTION smartlab_validate_asset_qr_identity()');
            DB::statement('CREATE TRIGGER asset_qr_identity_protect_update BEFORE UPDATE ON asset_qr_identities FOR EACH ROW EXECUTE FUNCTION smartlab_protect_asset_qr_identity()');
            DB::statement('CREATE TRIGGER asset_qr_identity_protect_delete BEFORE DELETE ON asset_qr_identities FOR EACH ROW EXECUTE FUNCTION smartlab_protect_asset_qr_identity()');
            DB::statement('CREATE TRIGGER asset_qr_label_batch_validate_insert BEFORE INSERT ON asset_qr_label_batches FOR EACH ROW EXECUTE FUNCTION smartlab_validate_asset_qr_label_batch()');
            DB::statement('CREATE TRIGGER asset_qr_label_batch_immutable_update BEFORE UPDATE OF school_id, laboratory_id, laboratory_code_snapshot, laboratory_name_snapshot, template_key, filters, asset_count, generated_by_user_id_snapshot, generated_by_membership_id_snapshot, generated_by_name_snapshot, generated_at ON asset_qr_label_batches FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('CREATE TRIGGER asset_qr_label_batch_immutable_delete BEFORE DELETE ON asset_qr_label_batches FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('CREATE TRIGGER asset_qr_label_item_validate_insert BEFORE INSERT ON asset_qr_label_batch_items FOR EACH ROW EXECUTE FUNCTION smartlab_validate_asset_qr_label_item()');
            DB::statement('CREATE TRIGGER asset_qr_label_item_immutable_update BEFORE UPDATE ON asset_qr_label_batch_items FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('CREATE TRIGGER asset_qr_label_item_immutable_delete BEFORE DELETE ON asset_qr_label_batch_items FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('CREATE TRIGGER asset_qr_label_event_immutable_update BEFORE UPDATE OF school_id, asset_qr_label_batch_id, event_type, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, payload, created_at ON asset_qr_label_batch_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('CREATE TRIGGER asset_qr_label_event_immutable_delete BEFORE DELETE ON asset_qr_label_batch_events FOR EACH ROW EXECUTE FUNCTION smartlab_prevent_asset_qr_label_evidence_mutation()');
        }

        if (DB::connection()->getDriverName() === 'sqlite') {
            DB::statement("CREATE UNIQUE INDEX asset_qr_identity_one_active_per_asset ON asset_qr_identities (asset_id) WHERE status = 'active'");

            DB::unprepared("CREATE TRIGGER asset_qr_identity_validate_insert BEFORE INSERT ON asset_qr_identities
                WHEN NEW.token_version < 1
                    OR NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = NEW.asset_id AND a.school_id = NEW.school_id)
                    OR (NEW.status = 'active' AND (NEW.revoked_by_user_id_snapshot IS NOT NULL OR NEW.revoked_by_membership_id_snapshot IS NOT NULL OR NEW.revoked_by_name_snapshot IS NOT NULL OR NEW.revoked_reason IS NOT NULL OR NEW.revoked_at IS NOT NULL))
                    OR (NEW.status = 'revoked' AND (NEW.revoked_by_user_id_snapshot IS NULL OR NEW.revoked_by_membership_id_snapshot IS NULL OR NEW.revoked_by_name_snapshot IS NULL OR NEW.revoked_reason IS NULL OR length(trim(NEW.revoked_reason)) < 3 OR NEW.revoked_at IS NULL))
                BEGIN SELECT RAISE(ABORT, 'Asset QR identity integrity failed'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_identity_protect_update BEFORE UPDATE ON asset_qr_identities
                WHEN NEW.school_id IS NOT OLD.school_id
                    OR NEW.asset_id IS NOT OLD.asset_id
                    OR NEW.public_id IS NOT OLD.public_id
                    OR NEW.token_version IS NOT OLD.token_version
                    OR NEW.issued_by_user_id_snapshot IS NOT OLD.issued_by_user_id_snapshot
                    OR NEW.issued_by_membership_id_snapshot IS NOT OLD.issued_by_membership_id_snapshot
                    OR NEW.issued_by_name_snapshot IS NOT OLD.issued_by_name_snapshot
                    OR NEW.issued_at IS NOT OLD.issued_at
                    OR (NEW.issued_by_user_id IS NOT OLD.issued_by_user_id AND NEW.issued_by_user_id IS NOT NULL)
                    OR (NEW.issued_by_membership_id IS NOT OLD.issued_by_membership_id AND NEW.issued_by_membership_id IS NOT NULL)
                    OR (NEW.revoked_by_user_id IS NOT OLD.revoked_by_user_id AND OLD.revoked_by_user_id IS NOT NULL AND NEW.revoked_by_user_id IS NOT NULL)
                    OR (NEW.revoked_by_membership_id IS NOT OLD.revoked_by_membership_id AND OLD.revoked_by_membership_id IS NOT NULL AND NEW.revoked_by_membership_id IS NOT NULL)
                    OR NOT (
                        (OLD.status = 'active' AND NEW.status = 'revoked')
                        OR (
                            NEW.status IS OLD.status
                            AND NEW.revoked_by_user_id_snapshot IS OLD.revoked_by_user_id_snapshot
                            AND NEW.revoked_by_membership_id_snapshot IS OLD.revoked_by_membership_id_snapshot
                            AND NEW.revoked_by_name_snapshot IS OLD.revoked_by_name_snapshot
                            AND NEW.revoked_reason IS OLD.revoked_reason
                            AND NEW.revoked_at IS OLD.revoked_at
                        )
                    )
                BEGIN SELECT RAISE(ABORT, 'Asset QR identity mutation is not permitted'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_identity_validate_update BEFORE UPDATE ON asset_qr_identities
                WHEN (NEW.status = 'active' AND (NEW.revoked_by_user_id_snapshot IS NOT NULL OR NEW.revoked_by_membership_id_snapshot IS NOT NULL OR NEW.revoked_by_name_snapshot IS NOT NULL OR NEW.revoked_reason IS NOT NULL OR NEW.revoked_at IS NOT NULL))
                    OR (NEW.status = 'revoked' AND (NEW.revoked_by_user_id_snapshot IS NULL OR NEW.revoked_by_membership_id_snapshot IS NULL OR NEW.revoked_by_name_snapshot IS NULL OR NEW.revoked_reason IS NULL OR length(trim(NEW.revoked_reason)) < 3 OR NEW.revoked_at IS NULL))
                BEGIN SELECT RAISE(ABORT, 'Asset QR identity state evidence invalid'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_identity_protect_delete BEFORE DELETE ON asset_qr_identities
                BEGIN SELECT RAISE(ABORT, 'Asset QR identities are retained as history'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_label_batch_validate_insert BEFORE INSERT ON asset_qr_label_batches
                WHEN NEW.asset_count < 1
                    OR json_type(NEW.filters) <> 'object'
                    OR ((NEW.laboratory_id IS NULL) <> (NEW.laboratory_code_snapshot IS NULL))
                    OR ((NEW.laboratory_id IS NULL) <> (NEW.laboratory_name_snapshot IS NULL))
                    OR (NEW.laboratory_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM laboratories l
                        WHERE l.id = NEW.laboratory_id AND l.school_id = NEW.school_id
                          AND l.code = NEW.laboratory_code_snapshot AND l.name = NEW.laboratory_name_snapshot
                    ))
                BEGIN SELECT RAISE(ABORT, 'Asset QR label batch integrity failed'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_label_batch_immutable_update BEFORE UPDATE OF school_id, laboratory_id, laboratory_code_snapshot, laboratory_name_snapshot, template_key, filters, asset_count, generated_by_user_id_snapshot, generated_by_membership_id_snapshot, generated_by_name_snapshot, generated_at ON asset_qr_label_batches
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");
            DB::unprepared("CREATE TRIGGER asset_qr_label_batch_immutable_delete BEFORE DELETE ON asset_qr_label_batches
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_label_item_validate_insert BEFORE INSERT ON asset_qr_label_batch_items
                WHEN NEW.ordinal < 1 OR NEW.token_version_snapshot < 1
                    OR ((NEW.laboratory_id_snapshot IS NULL) <> (NEW.laboratory_code_snapshot IS NULL))
                    OR ((NEW.laboratory_id_snapshot IS NULL) <> (NEW.laboratory_name_snapshot IS NULL))
                    OR NOT EXISTS (
                        SELECT 1
                        FROM asset_qr_label_batches b
                        JOIN assets a ON a.id = NEW.asset_id
                        JOIN asset_qr_identities q ON q.id = NEW.asset_qr_identity_id
                        LEFT JOIN laboratories l ON l.id = NEW.laboratory_id_snapshot
                        WHERE b.id = NEW.asset_qr_label_batch_id
                          AND b.school_id = NEW.school_id
                          AND a.school_id = NEW.school_id
                          AND q.school_id = NEW.school_id
                          AND q.asset_id = NEW.asset_id
                          AND a.asset_code = NEW.asset_code_snapshot
                          AND a.name = NEW.asset_name_snapshot
                          AND q.public_id = NEW.public_id_snapshot
                          AND q.token_version = NEW.token_version_snapshot
                          AND a.home_laboratory_id IS NEW.laboratory_id_snapshot
                          AND (
                              NEW.laboratory_id_snapshot IS NULL
                              OR (l.school_id = NEW.school_id AND l.code = NEW.laboratory_code_snapshot AND l.name = NEW.laboratory_name_snapshot)
                          )
                    )
                BEGIN SELECT RAISE(ABORT, 'Asset QR label item exact snapshot binding failed'); END");

            DB::unprepared("CREATE TRIGGER asset_qr_label_item_immutable_update BEFORE UPDATE ON asset_qr_label_batch_items
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");
            DB::unprepared("CREATE TRIGGER asset_qr_label_item_immutable_delete BEFORE DELETE ON asset_qr_label_batch_items
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");
            DB::unprepared("CREATE TRIGGER asset_qr_label_event_validate_insert BEFORE INSERT ON asset_qr_label_batch_events
                WHEN json_type(NEW.payload) <> 'object'
                    OR NOT EXISTS (
                        SELECT 1 FROM asset_qr_label_batches b
                        WHERE b.id = NEW.asset_qr_label_batch_id AND b.school_id = NEW.school_id
                    )
                BEGIN SELECT RAISE(ABORT, 'Asset QR label event integrity failed'); END");
            DB::unprepared("CREATE TRIGGER asset_qr_label_event_immutable_update BEFORE UPDATE OF school_id, asset_qr_label_batch_id, event_type, actor_user_id_snapshot, actor_membership_id_snapshot, actor_name_snapshot, payload, created_at ON asset_qr_label_batch_events
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");
            DB::unprepared("CREATE TRIGGER asset_qr_label_event_immutable_delete BEFORE DELETE ON asset_qr_label_batch_events
                BEGIN SELECT RAISE(ABORT, 'Asset QR label evidence is immutable'); END");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('asset_qr_label_batch_events');
        Schema::dropIfExists('asset_qr_label_batch_items');
        Schema::dropIfExists('asset_qr_label_batches');
        Schema::dropIfExists('asset_qr_identities');

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS smartlab_prevent_asset_qr_label_evidence_mutation()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_validate_asset_qr_label_item()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_validate_asset_qr_label_batch()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_protect_asset_qr_identity()');
            DB::statement('DROP FUNCTION IF EXISTS smartlab_validate_asset_qr_identity()');
        }
    }
};
