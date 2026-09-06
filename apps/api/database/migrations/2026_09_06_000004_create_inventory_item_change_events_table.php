<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_item_change_events', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->foreignUlid('school_id')->constrained('schools')->restrictOnDelete();
            $table->foreignUlid('inventory_item_id')->constrained('inventory_items')->restrictOnDelete();
            $table->foreignUlid('actor_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUlid('actor_membership_id')->nullable()->constrained('school_memberships')->nullOnDelete();
            $table->ulid('actor_user_id_snapshot');
            $table->ulid('actor_membership_id_snapshot');
            $table->string('actor_name_snapshot', 255);
            $table->string('event_type', 80);
            $table->jsonb('changed_fields');
            $table->jsonb('changes');
            $table->timestampTz('created_at');

            $table->index(['school_id', 'inventory_item_id', 'created_at'], 'inventory_item_change_events_item_time_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_item_change_events');
    }
};
