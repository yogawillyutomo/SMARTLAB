<?php

namespace App\Application\Asset;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Asset\AssetDomainException;
use App\Models\Asset;
use App\Models\AssetChangeEvent;
use App\Models\Device;
use App\Models\Laboratory;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AssetMutationService
{
    private const ATTRIBUTE_MAP = [
        'name' => 'name',
        'category' => 'category',
        'brand' => 'brand',
        'model' => 'model',
        'serialNumber' => 'serial_number',
        'homeLaboratoryId' => 'home_laboratory_id',
        'condition' => 'condition',
        'acquisitionDate' => 'acquisition_date',
        'acquisitionYear' => 'acquisition_year',
        'fundingSource' => 'funding_source',
        'purchasePrice' => 'purchase_price',
        'supplierName' => 'supplier_name',
        'warrantyUntil' => 'warranty_until',
        'notes' => 'notes',
    ];

    /** @param array<string, mixed> $data */
    public function create(CurrentMembershipContext $context, array $data): Asset
    {
        $schoolId = $context->membership->school_id;

        try {
            return DB::transaction(function () use ($context, $data, $schoolId): Asset {
                if (($data['homeLaboratoryId'] ?? null) !== null) {
                    $this->assertActiveHomeLaboratory($schoolId, (string) $data['homeLaboratoryId']);
                }

                $asset = Asset::query()->create([
                    'school_id' => $schoolId,
                    'asset_code' => $data['assetCode'],
                    'name' => $data['name'],
                    'category' => $data['category'],
                    'brand' => $data['brand'] ?? null,
                    'model' => $data['model'] ?? null,
                    'serial_number' => $data['serialNumber'] ?? null,
                    'home_laboratory_id' => $data['homeLaboratoryId'] ?? null,
                    'condition' => $data['condition'] ?? 'unknown',
                    'lifecycle_status' => 'active',
                    'acquisition_date' => $data['acquisitionDate'] ?? null,
                    'acquisition_year' => $data['acquisitionYear'] ?? null,
                    'funding_source' => $data['fundingSource'] ?? null,
                    'purchase_price' => $data['purchasePrice'] ?? null,
                    'supplier_name' => $data['supplierName'] ?? null,
                    'warranty_until' => $data['warrantyUntil'] ?? null,
                    'notes' => $data['notes'] ?? null,
                    'linked_device_id' => null,
                    'version' => 1,
                ]);

                $this->writeEvent($context, $asset, 'asset.created', ['assetCode', 'name', 'category'], [
                    'assetCode' => ['after' => $asset->asset_code],
                    'condition' => ['after' => $asset->condition],
                    'lifecycleStatus' => ['after' => $asset->lifecycle_status],
                ]);

                return $asset;
            });
        } catch (UniqueConstraintViolationException) {
            throw ValidationException::withMessages([
                'assetCode' => ['The asset code has already been taken.'],
            ]);
        }
    }

    /** @param array<string, mixed> $data */
    public function update(
        CurrentMembershipContext $context,
        string $assetId,
        int $expectedVersion,
        array $data,
    ): Asset {
        return DB::transaction(function () use ($context, $assetId, $expectedVersion, $data): Asset {
            $asset = $this->lockAsset($context, $assetId);
            $this->assertVersion($asset, $expectedVersion);

            if ($asset->lifecycle_status === 'disposed') {
                throw new AssetDomainException('Disposed Assets cannot be edited.', 'ASSET_LIFECYCLE_LOCKED', 409);
            }

            if (array_key_exists('homeLaboratoryId', $data) && $data['homeLaboratoryId'] !== null) {
                $this->assertActiveHomeLaboratory(
                    $context->membership->school_id,
                    (string) $data['homeLaboratoryId'],
                );
            }

            if ($asset->linked_device_id !== null) {
                foreach ([
                    'homeLaboratoryId' => 'home_laboratory_id',
                    'brand' => 'brand',
                    'model' => 'model',
                    'serialNumber' => 'serial_number',
                ] as $field => $column) {
                    if (array_key_exists($field, $data) && ! $this->valuesEqual($asset->getAttribute($column), $data[$field])) {
                        throw new AssetDomainException(
                            'Linked Asset identity fields require a coordinated Device workflow.',
                            'ASSET_LINKED_IDENTITY_CHANGE_FORBIDDEN',
                            409,
                        );
                    }
                }
            }

            $changedFields = [];
            $changes = [];
            foreach (self::ATTRIBUTE_MAP as $field => $attribute) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }

                $before = $asset->getAttribute($attribute);
                $after = $data[$field];
                if ($this->valuesEqual($before, $after)) {
                    continue;
                }

                $changedFields[] = $field;
                $changes[$field] = [
                    'before' => $this->eventValue($before),
                    'after' => $this->eventValue($after),
                ];
                $asset->setAttribute($attribute, $after);
            }

            if ($changedFields === []) {
                return $asset;
            }

            $asset->version++;
            $asset->save();
            $this->writeEvent($context, $asset, 'asset.updated', $changedFields, $changes);

            return $asset->refresh();
        });
    }

    public function linkDevice(
        CurrentMembershipContext $context,
        string $assetId,
        int $expectedVersion,
        string $deviceId,
    ): Asset {
        return DB::transaction(function () use ($context, $assetId, $expectedVersion, $deviceId): Asset {
            $asset = $this->lockAsset($context, $assetId);
            $this->assertVersion($asset, $expectedVersion);

            if ($asset->lifecycle_status !== 'active') {
                throw new AssetDomainException('Only active Assets can be linked.', 'ASSET_LIFECYCLE_LOCKED', 409);
            }

            $device = Device::query()
                ->where('school_id', $context->membership->school_id)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();

            if ($device === null) {
                throw new AssetDomainException('Device not found.', 'ASSET_DEVICE_NOT_FOUND', 404);
            }

            if ($asset->linked_device_id === $device->id) {
                return $asset;
            }

            if ($asset->linked_device_id !== null) {
                throw new AssetDomainException(
                    'Asset is already linked to another Device.',
                    'ASSET_DEVICE_LINK_CONFLICT',
                    409,
                );
            }

            if ($device->lifecycle_status === 'decommissioned') {
                throw new AssetDomainException(
                    'Decommissioned Devices cannot be linked to an active Asset.',
                    'ASSET_DEVICE_LINK_CONFLICT',
                    409,
                );
            }

            $otherAsset = Asset::query()
                ->where('school_id', $context->membership->school_id)
                ->where('linked_device_id', $device->id)
                ->lockForUpdate()
                ->first();

            if ($otherAsset !== null) {
                throw new AssetDomainException(
                    'Device is already linked to another Asset.',
                    'ASSET_DEVICE_LINK_CONFLICT',
                    409,
                );
            }

            if ($asset->home_laboratory_id !== null
                && $device->home_laboratory_id !== null
                && $asset->home_laboratory_id !== $device->home_laboratory_id) {
                throw new AssetDomainException(
                    'Asset and Device home Laboratories must match before linking.',
                    'ASSET_DEVICE_LINK_CONFLICT',
                    409,
                );
            }

            $asset->linked_device_id = $device->id;
            $asset->version++;
            $asset->save();

            $this->writeEvent($context, $asset, 'asset.device_linked', ['linkedDeviceId'], [
                'linkedDeviceId' => ['before' => null, 'after' => $device->id],
            ]);

            return $asset->refresh();
        });
    }

    public function unlinkDevice(
        CurrentMembershipContext $context,
        string $assetId,
        int $expectedVersion,
        string $reason,
    ): Asset {
        return DB::transaction(function () use ($context, $assetId, $expectedVersion, $reason): Asset {
            $asset = $this->lockAsset($context, $assetId);
            $this->assertVersion($asset, $expectedVersion);

            if ($asset->linked_device_id === null) {
                return $asset;
            }

            $before = $asset->linked_device_id;
            $asset->linked_device_id = null;
            $asset->version++;
            $asset->save();

            $this->writeEvent($context, $asset, 'asset.device_unlinked', ['linkedDeviceId'], [
                'linkedDeviceId' => ['before' => $before, 'after' => null],
                'reason' => ['after' => $reason],
            ]);

            return $asset->refresh();
        });
    }

    public function retire(
        CurrentMembershipContext $context,
        string $assetId,
        int $expectedVersion,
        string $reason,
    ): Asset {
        return DB::transaction(function () use ($context, $assetId, $expectedVersion, $reason): Asset {
            $asset = $this->lockAsset($context, $assetId);
            $this->assertVersion($asset, $expectedVersion);

            if ($asset->lifecycle_status === 'retired') {
                return $asset;
            }

            if ($asset->lifecycle_status !== 'active') {
                throw new AssetDomainException(
                    'Asset cannot be retired from its current lifecycle.',
                    'ASSET_LIFECYCLE_TRANSITION_INVALID',
                    409,
                );
            }

            if ($asset->linked_device_id !== null) {
                $device = Device::query()
                    ->where('school_id', $context->membership->school_id)
                    ->whereKey($asset->linked_device_id)
                    ->lockForUpdate()
                    ->first();

                if ($device === null || ! in_array($device->lifecycle_status, ['retired', 'decommissioned'], true)) {
                    throw new AssetDomainException(
                        'Linked Device must leave active service before the Asset can be retired.',
                        'ASSET_DEVICE_LIFECYCLE_CONFLICT',
                        409,
                    );
                }
            }

            $asset->lifecycle_status = 'retired';
            $asset->version++;
            $asset->save();

            $this->writeEvent($context, $asset, 'asset.retired', ['lifecycleStatus'], [
                'lifecycleStatus' => ['before' => 'active', 'after' => 'retired'],
                'reason' => ['after' => $reason],
            ]);

            return $asset->refresh();
        });
    }

    public function dispose(
        CurrentMembershipContext $context,
        string $assetId,
        int $expectedVersion,
        string $reason,
    ): Asset {
        return DB::transaction(function () use ($context, $assetId, $expectedVersion, $reason): Asset {
            $asset = $this->lockAsset($context, $assetId);
            $this->assertVersion($asset, $expectedVersion);

            if ($asset->lifecycle_status === 'disposed') {
                return $asset;
            }

            if ($asset->lifecycle_status !== 'retired') {
                throw new AssetDomainException(
                    'Asset must be retired before disposal.',
                    'ASSET_LIFECYCLE_TRANSITION_INVALID',
                    409,
                );
            }

            if ($asset->linked_device_id !== null) {
                $device = Device::query()
                    ->where('school_id', $context->membership->school_id)
                    ->whereKey($asset->linked_device_id)
                    ->lockForUpdate()
                    ->first();

                if ($device === null || $device->lifecycle_status !== 'decommissioned') {
                    throw new AssetDomainException(
                        'Linked Device must be decommissioned before Asset disposal.',
                        'ASSET_DEVICE_LIFECYCLE_CONFLICT',
                        409,
                    );
                }
            }

            $asset->lifecycle_status = 'disposed';
            $asset->version++;
            $asset->save();

            $this->writeEvent($context, $asset, 'asset.disposed', ['lifecycleStatus'], [
                'lifecycleStatus' => ['before' => 'retired', 'after' => 'disposed'],
                'reason' => ['after' => $reason],
            ]);

            return $asset->refresh();
        });
    }

    private function lockAsset(CurrentMembershipContext $context, string $assetId): Asset
    {
        $asset = Asset::query()
            ->where('school_id', $context->membership->school_id)
            ->whereKey($assetId)
            ->lockForUpdate()
            ->first();

        if ($asset === null) {
            throw new AssetDomainException('Asset not found.', 'ASSET_NOT_FOUND', 404);
        }

        return $asset;
    }

    private function assertVersion(Asset $asset, int $expectedVersion): void
    {
        if ($asset->version !== $expectedVersion) {
            throw new AssetDomainException(
                'Asset has changed since it was loaded.',
                'ASSET_VERSION_CONFLICT',
                412,
            );
        }
    }

    private function assertActiveHomeLaboratory(string $schoolId, string $laboratoryId): void
    {
        $laboratory = Laboratory::query()
            ->where('school_id', $schoolId)
            ->whereKey($laboratoryId)
            ->where('status', 'active')
            ->sharedLock()
            ->first(['id']);

        if ($laboratory === null) {
            throw ValidationException::withMessages([
                'homeLaboratoryId' => ['The selected home laboratory is invalid.'],
            ]);
        }
    }

    /** @param list<string> $changedFields @param array<string, mixed> $changes */
    private function writeEvent(
        CurrentMembershipContext $context,
        Asset $asset,
        string $eventType,
        array $changedFields,
        array $changes,
    ): void {
        AssetChangeEvent::query()->create([
            'school_id' => $asset->school_id,
            'asset_id' => $asset->id,
            'actor_user_id' => $context->membership->user_id,
            'actor_membership_id' => $context->membership->id,
            'actor_user_id_snapshot' => $context->membership->user_id,
            'actor_membership_id_snapshot' => $context->membership->id,
            'event_type' => $eventType,
            'changed_fields' => $changedFields,
            'changes' => $changes,
            'created_at' => now(),
        ]);
    }

    private function valuesEqual(mixed $before, mixed $after): bool
    {
        return $this->eventValue($before) === $this->eventValue($after);
    }

    private function eventValue(mixed $value): mixed
    {
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        if (is_string($value) && is_numeric($value)) {
            return rtrim(rtrim(number_format((float) $value, 2, '.', ''), '0'), '.');
        }

        return $value;
    }
}
