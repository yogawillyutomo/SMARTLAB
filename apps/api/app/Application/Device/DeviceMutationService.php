<?php

namespace App\Application\Device;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceDomainException;
use App\Domain\Device\DeviceTechnicalProfileValidator;
use App\Models\Device;
use App\Models\DeviceChangeEvent;
use App\Models\Laboratory;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class DeviceMutationService
{
    private const ATTRIBUTE_MAP = [
        'homeLaboratoryId' => 'home_laboratory_id',
        'lifecycleStatus' => 'lifecycle_status',
        'serialNumber' => 'serial_number',
        'hostname' => 'hostname',
        'brand' => 'brand',
        'model' => 'model',
        'technicalProfile' => 'technical_profile',
    ];

    public function __construct(
        private readonly DeviceTechnicalProfileValidator $profileValidator,
    ) {}

    /** @param array<string, mixed> $data */
    public function create(CurrentMembershipContext $context, array $data): Device
    {
        $schoolId = $context->membership->school_id;
        for ($attempt = 0; $attempt < 3; $attempt++) {
            try {
                return DB::transaction(function () use ($context, $data, $schoolId): Device {
                    if (($data['homeLaboratoryId'] ?? null) !== null) {
                        $this->assertActiveHomeLaboratory($schoolId, (string) $data['homeLaboratoryId']);
                    }

                    $device = Device::query()->create([
                        'school_id' => $schoolId,
                        'device_code' => $data['deviceCode'],
                        'qr_public_id' => $this->generateQrPublicId(),
                        'device_type' => $data['deviceType'],
                        'lifecycle_status' => $data['lifecycleStatus'] ?? 'in_service',
                        'home_laboratory_id' => $data['homeLaboratoryId'] ?? null,
                        'serial_number' => $data['serialNumber'] ?? null,
                        'hostname' => $data['hostname'] ?? null,
                        'brand' => $data['brand'] ?? null,
                        'model' => $data['model'] ?? null,
                        'technical_profile_version' => 1,
                        'technical_profile' => $this->profileValidator->normalize($data['technicalProfile'] ?? []),
                        'version' => 1,
                    ]);

                    $createdFields = ['deviceCode', 'deviceType', 'lifecycleStatus'];
                    foreach (['homeLaboratoryId', 'serialNumber', 'hostname', 'brand', 'model', 'technicalProfile'] as $field) {
                        if (array_key_exists($field, $data)) {
                            $createdFields[] = $field;
                        }
                    }
                    $this->writeEvent($context, $device, 'device.created', $createdFields, [
                        'deviceCode' => ['after' => $device->device_code],
                        'deviceType' => ['after' => $device->device_type],
                        'lifecycleStatus' => ['after' => $device->lifecycle_status],
                        'technicalProfile' => ['afterHash' => $this->profileHash($device->technical_profile)],
                    ]);

                    return $device;
                });
            } catch (UniqueConstraintViolationException $exception) {
                if (Device::query()->where('school_id', $schoolId)->where('device_code', $data['deviceCode'])->exists()) {
                    throw ValidationException::withMessages([
                        'deviceCode' => ['The device code has already been taken.'],
                    ]);
                }
                if ($attempt === 2) {
                    throw $exception;
                }
            }
        }

        throw new \LogicException('Device creation retry loop exhausted.');
    }

    /** @param array<string, mixed> $data */
    public function update(
        CurrentMembershipContext $context,
        string $deviceId,
        int $expectedVersion,
        array $data,
    ): Device {
        return DB::transaction(function () use ($context, $deviceId, $expectedVersion, $data): Device {
            $device = Device::query()
                ->where('school_id', $context->membership->school_id)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();

            if ($device === null) {
                throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
            }
            if ($device->version !== $expectedVersion) {
                throw new DeviceDomainException(
                    'Device has changed since it was loaded.',
                    'DEVICE_VERSION_CONFLICT',
                    412,
                );
            }

            if (array_key_exists('lifecycleStatus', $data)
                && in_array($device->lifecycle_status, ['retired', 'decommissioned'], true)) {
                throw new DeviceDomainException(
                    'The requested Device lifecycle transition is invalid.',
                    'DEVICE_LIFECYCLE_TRANSITION_INVALID',
                    409,
                );
            }

            if (array_key_exists('homeLaboratoryId', $data)) {
                $this->assertHomeChangeAllowed($device, $context, $data['homeLaboratoryId']);
            }

            if (array_key_exists('technicalProfile', $data)) {
                $data['technicalProfile'] = $this->profileValidator->normalize($data['technicalProfile']);
            }

            $changedFields = [];
            $changes = [];
            foreach (self::ATTRIBUTE_MAP as $field => $attribute) {
                if (! array_key_exists($field, $data)) {
                    continue;
                }
                $before = $device->getAttribute($attribute);
                $after = $data[$field];
                if ($this->effectiveValuesEqual($field, $before, $after)) {
                    continue;
                }

                $changedFields[] = $field;
                $changes[$field] = $field === 'technicalProfile'
                    ? ['beforeHash' => $this->profileHash($before), 'afterHash' => $this->profileHash($after)]
                    : ['before' => $before, 'after' => $after];
                $device->setAttribute($attribute, $after);
            }

            if ($changedFields === []) {
                return $device;
            }

            $device->version++;
            $device->save();

            $this->writeEvent(
                $context,
                $device,
                $this->eventType($changedFields),
                $changedFields,
                $changes,
            );

            return $device->refresh();
        });
    }

    private function assertHomeChangeAllowed(Device $device, CurrentMembershipContext $context, mixed $requestedHome): void
    {
        if ($device->home_laboratory_id !== null) {
            if ($requestedHome === $device->home_laboratory_id) {
                return;
            }

            throw new DeviceDomainException(
                'Established Device home Laboratory changes require the Device Transfer domain.',
                'DEVICE_HOME_LABORATORY_TRANSFER_REQUIRED',
                409,
            );
        }

        if ($requestedHome === null) {
            return;
        }

        $this->assertActiveHomeLaboratory($context->membership->school_id, (string) $requestedHome);
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
        Device $device,
        string $eventType,
        array $changedFields,
        array $changes,
    ): void {
        DeviceChangeEvent::query()->create([
            'school_id' => $device->school_id,
            'device_id' => $device->id,
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

    /** @param list<string> $changedFields */
    private function eventType(array $changedFields): string
    {
        if (in_array('homeLaboratoryId', $changedFields, true)) {
            return 'device.home_assigned';
        }
        if (in_array('lifecycleStatus', $changedFields, true)) {
            return 'device.lifecycle_changed';
        }
        if (in_array('technicalProfile', $changedFields, true)) {
            return 'device.technical_profile_replaced';
        }

        return 'device.metadata_updated';
    }

    private function profileHash(mixed $profile): string
    {
        return hash('sha256', json_encode($profile, JSON_THROW_ON_ERROR));
    }

    private function effectiveValuesEqual(string $field, mixed $before, mixed $after): bool
    {
        if ($field !== 'technicalProfile') {
            return $before === $after;
        }

        return $this->canonicalizeJsonValue($before) === $this->canonicalizeJsonValue($after);
    }

    private function canonicalizeJsonValue(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (array_is_list($value)) {
            return array_map($this->canonicalizeJsonValue(...), $value);
        }

        ksort($value, SORT_STRING);

        return array_map($this->canonicalizeJsonValue(...), $value);
    }

    private function generateQrPublicId(): string
    {
        return 'devq_'.rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
    }
}
