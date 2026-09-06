<?php

namespace App\Application\Inventory;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Inventory\InventoryDomainException;
use App\Models\InventoryItem;
use App\Models\InventoryItemChangeEvent;
use App\Models\InventoryTransaction;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryMutationService
{
    private const ATTRIBUTE_MAP = [
        'name' => 'name',
        'category' => 'category',
        'unit' => 'unit',
        'minimumStock' => 'minimum_stock',
        'storageLocation' => 'storage_location',
        'supplierName' => 'supplier_name',
        'unitPriceSnapshot' => 'unit_price_snapshot',
    ];

    /** @param array<string, mixed> $data */
    public function createItem(CurrentMembershipContext $context, User $actor, array $data): InventoryItem
    {
        try {
            return DB::transaction(function () use ($context, $actor, $data): InventoryItem {
                $item = InventoryItem::query()->create([
                    'school_id' => $context->membership->school_id,
                    'item_code' => $data['itemCode'],
                    'name' => $data['name'],
                    'category' => $data['category'],
                    'unit' => $data['unit'],
                    'minimum_stock' => $this->decimal3($data['minimumStock'] ?? 0),
                    'storage_location' => $data['storageLocation'] ?? null,
                    'supplier_name' => $data['supplierName'] ?? null,
                    'unit_price_snapshot' => isset($data['unitPriceSnapshot'])
                        ? $this->decimal2($data['unitPriceSnapshot'])
                        : null,
                    'on_hand_quantity' => '0.000',
                    'version' => 1,
                ]);

                $this->writeItemEvent(
                    $context,
                    $actor,
                    $item,
                    'inventory_item.created',
                    ['itemCode', 'name', 'category', 'unit'],
                    [
                        'itemCode' => ['after' => $item->item_code],
                        'name' => ['after' => $item->name],
                        'category' => ['after' => $item->category],
                        'unit' => ['after' => $item->unit],
                    ],
                );

                return $item;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'itemCode' => ['The item code has already been taken.'],
            ]);
        }
    }

    /** @param array<string, mixed> $data */
    public function updateItem(
        CurrentMembershipContext $context,
        User $actor,
        string $itemId,
        int $expectedVersion,
        array $data,
    ): InventoryItem {
        return DB::transaction(function () use ($context, $actor, $itemId, $expectedVersion, $data): InventoryItem {
            $item = $this->lockItem($context, $itemId);
            $this->assertVersion($item, $expectedVersion);

            if (array_key_exists('unit', $data)
                && $data['unit'] !== $item->unit
                && InventoryTransaction::query()->where('inventory_item_id', $item->id)->exists()) {
                throw new InventoryDomainException(
                    'Inventory unit cannot change after stock movement exists.',
                    'STOCK_UNIT_LOCKED',
                    409,
                );
            }

            $changedFields = [];
            $changes = [];

            foreach (self::ATTRIBUTE_MAP as $field => $attribute) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }

                $after = match ($field) {
                    'minimumStock' => $this->decimal3($data[$field]),
                    'unitPriceSnapshot' => $data[$field] === null ? null : $this->decimal2($data[$field]),
                    default => $data[$field],
                };

                $before = $item->getAttribute($attribute);
                if ($this->eventValue($before) === $this->eventValue($after)) {
                    continue;
                }

                $changedFields[] = $field;
                $changes[$field] = [
                    'before' => $this->eventValue($before),
                    'after' => $this->eventValue($after),
                ];
                $item->setAttribute($attribute, $after);
            }

            if ($changedFields === []) {
                return $item;
            }

            $item->version++;
            $item->save();

            $this->writeItemEvent(
                $context,
                $actor,
                $item,
                'inventory_item.updated',
                $changedFields,
                $changes,
            );

            return $item->refresh();
        });
    }

    /**
     * @param array<string, mixed> $data
     * @return array{transaction:InventoryTransaction,replayed:bool}
     */
    public function transact(CurrentMembershipContext $context, User $actor, array $data): array
    {
        $schoolId = (string) $context->membership->school_id;
        $clientMutationId = (string) $data['clientMutationId'];
        $payloadHash = $this->movementPayloadHash($data);

        try {
            return DB::transaction(function () use (
                $context,
                $actor,
                $data,
                $schoolId,
                $clientMutationId,
                $payloadHash,
            ): array {
                $existing = InventoryTransaction::query()
                    ->where('school_id', $schoolId)
                    ->where('client_mutation_id', $clientMutationId)
                    ->first();

                if ($existing !== null) {
                    return $this->replayOrReject($existing, $payloadHash);
                }

                $item = InventoryItem::query()
                    ->where('school_id', $schoolId)
                    ->whereKey((string) $data['inventoryItemId'])
                    ->lockForUpdate()
                    ->first();

                if ($item === null) {
                    throw new InventoryDomainException(
                        'Inventory item not found.',
                        'STOCK_ITEM_NOT_FOUND',
                        404,
                    );
                }

                $existing = InventoryTransaction::query()
                    ->where('school_id', $schoolId)
                    ->where('client_mutation_id', $clientMutationId)
                    ->first();

                if ($existing !== null) {
                    return $this->replayOrReject($existing, $payloadHash);
                }

                $quantityMilli = $this->toMilli($data['quantity']);
                $beforeMilli = $this->toMilli($item->on_hand_quantity);
                $kind = (string) $data['kind'];

                if ($kind === 'opening') {
                    if ($beforeMilli !== 0 || InventoryTransaction::query()
                        ->where('school_id', $schoolId)
                        ->where('inventory_item_id', $item->id)
                        ->exists()) {
                        throw new InventoryDomainException(
                            'Opening stock is only valid as the first movement on a zero-balance item.',
                            'STOCK_OPENING_CONFLICT',
                            409,
                        );
                    }
                }

                $positive = in_array($kind, ['opening', 'receipt', 'adjustment_in'], true);
                $deltaMilli = $positive ? $quantityMilli : -$quantityMilli;
                $afterMilli = $beforeMilli + $deltaMilli;

                if ($afterMilli < 0) {
                    throw new InventoryDomainException(
                        'Stock is insufficient for this movement.',
                        'STOCK_INSUFFICIENT',
                        409,
                    );
                }

                $item->on_hand_quantity = $this->fromMilli($afterMilli);
                $item->version++;
                $item->save();

                $now = now();
                $transaction = InventoryTransaction::query()->create([
                    'school_id' => $schoolId,
                    'inventory_item_id' => $item->id,
                    'client_mutation_id' => $clientMutationId,
                    'kind' => $kind,
                    'quantity' => $this->fromMilli($quantityMilli),
                    'signed_delta' => $this->fromMilli($deltaMilli),
                    'balance_before' => $this->fromMilli($beforeMilli),
                    'balance_after' => $this->fromMilli($afterMilli),
                    'item_version_after' => $item->version,
                    'reason' => trim((string) $data['reason']),
                    'source_type' => null,
                    'source_id' => null,
                    'actor_user_id' => $actor->id,
                    'actor_membership_id' => $context->membership->id,
                    'actor_user_id_snapshot' => $actor->id,
                    'actor_membership_id_snapshot' => $context->membership->id,
                    'actor_name_snapshot' => $actor->name,
                    'item_code_snapshot' => $item->item_code,
                    'item_name_snapshot' => $item->name,
                    'unit_snapshot' => $item->unit,
                    'request_sha256' => $payloadHash,
                    'occurred_at' => $now,
                    'created_at' => $now,
                ]);

                return ['transaction' => $transaction, 'replayed' => false];
            });
        } catch (UniqueConstraintViolationException $exception) {
            $existing = InventoryTransaction::query()
                ->where('school_id', $schoolId)
                ->where('client_mutation_id', $clientMutationId)
                ->first();

            if ($existing !== null) {
                return $this->replayOrReject($existing, $payloadHash);
            }

            throw $exception;
        }
    }

    private function lockItem(CurrentMembershipContext $context, string $itemId): InventoryItem
    {
        $item = InventoryItem::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($itemId)
            ->lockForUpdate()
            ->first();

        if ($item === null) {
            throw new InventoryDomainException(
                'Inventory item not found.',
                'STOCK_ITEM_NOT_FOUND',
                404,
            );
        }

        return $item;
    }

    private function assertVersion(InventoryItem $item, int $expectedVersion): void
    {
        if ($item->version !== $expectedVersion) {
            throw new InventoryDomainException(
                'Inventory item has changed since it was loaded.',
                'STOCK_ITEM_VERSION_CONFLICT',
                412,
            );
        }
    }

    /** @return array{transaction:InventoryTransaction,replayed:bool} */
    private function replayOrReject(InventoryTransaction $existing, string $payloadHash): array
    {
        if (! hash_equals((string) $existing->request_sha256, $payloadHash)) {
            throw new InventoryDomainException(
                'The client mutation ID was already used for a different stock movement.',
                'STOCK_MUTATION_REUSED',
                409,
            );
        }

        return ['transaction' => $existing, 'replayed' => true];
    }

    /** @param array<string, mixed> $data */
    private function movementPayloadHash(array $data): string
    {
        $canonical = [
            'inventoryItemId' => (string) $data['inventoryItemId'],
            'kind' => (string) $data['kind'],
            'quantity' => $this->fromMilli($this->toMilli($data['quantity'])),
            'reason' => trim((string) $data['reason']),
            'sourceType' => null,
            'sourceId' => null,
        ];

        return hash('sha256', json_encode(
            $canonical,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        ));
    }

    /** @param list<string> $changedFields @param array<string, mixed> $changes */
    private function writeItemEvent(
        CurrentMembershipContext $context,
        User $actor,
        InventoryItem $item,
        string $eventType,
        array $changedFields,
        array $changes,
    ): void {
        InventoryItemChangeEvent::query()->create([
            'school_id' => $item->school_id,
            'inventory_item_id' => $item->id,
            'actor_user_id' => $actor->id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $actor->id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'actor_name_snapshot' => $actor->name,
            'event_type' => $eventType,
            'changed_fields' => $changedFields,
            'changes' => $changes,
            'created_at' => now(),
        ]);
    }

    private function toMilli(mixed $value): int
    {
        $text = trim((string) $value);
        if (! preg_match('/^([0-9]{1,12})(?:\.([0-9]{1,3}))?$/', $text, $matches)) {
            throw new \InvalidArgumentException('Invalid inventory decimal.');
        }

        $whole = (int) $matches[1];
        $fraction = str_pad($matches[2] ?? '', 3, '0');

        return ($whole * 1000) + (int) $fraction;
    }

    private function fromMilli(int $value): string
    {
        $sign = $value < 0 ? '-' : '';
        $absolute = abs($value);

        return $sign.intdiv($absolute, 1000).'.'.str_pad((string) ($absolute % 1000), 3, '0', STR_PAD_LEFT);
    }

    private function decimal3(mixed $value): string
    {
        return $this->fromMilli($this->toMilli($value));
    }

    private function decimal2(mixed $value): string
    {
        $text = trim((string) $value);
        if (! preg_match('/^([0-9]{1,13})(?:\.([0-9]{1,2}))?$/', $text, $matches)) {
            throw new \InvalidArgumentException('Invalid inventory price decimal.');
        }

        return $matches[1].'.'.str_pad($matches[2] ?? '', 2, '0');
    }

    private function eventValue(mixed $value): mixed
    {
        if ($value === null) {
            return null;
        }

        if (is_string($value) && is_numeric($value) && str_contains($value, '.')) {
            return rtrim(rtrim($value, '0'), '.');
        }

        return $value;
    }
}
