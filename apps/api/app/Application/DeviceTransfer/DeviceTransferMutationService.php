<?php

namespace App\Application\DeviceTransfer;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceCatalog;
use App\Domain\Device\DeviceDomainException;
use App\Domain\DeviceTransfer\TransferDomainException;
use App\Models\Device;
use App\Models\DeviceChangeEvent;
use App\Models\DeviceTransfer;
use App\Models\Laboratory;
use App\Models\Layout;
use App\Models\LayoutDevicePlacement;
use Illuminate\Support\Facades\DB;

class DeviceTransferMutationService
{
    /** @param array{destinationLaboratoryId: string, reason?: string|null} $data */
    public function transfer(
        CurrentMembershipContext $context,
        string $deviceId,
        int $expectedVersion,
        array $data,
    ): DeviceTransfer {
        $schoolId = $context->membership->school_id;
        $candidate = Device::query()
            ->where('school_id', $schoolId)
            ->whereKey($deviceId)
            ->first(['id', 'home_laboratory_id']);

        if ($candidate === null) {
            throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
        }

        $destinationId = (string) $data['destinationLaboratoryId'];
        $candidateSourceId = $candidate->home_laboratory_id;

        return DB::transaction(function () use (
            $context,
            $schoolId,
            $deviceId,
            $expectedVersion,
            $destinationId,
            $candidateSourceId,
            $data,
        ): DeviceTransfer {
            $destinationCandidate = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereKey($destinationId)
                ->first();

            $laboratoryIds = array_values(array_filter([$candidateSourceId, $destinationId]));
            sort($laboratoryIds, SORT_STRING);
            $lockedLaboratories = Laboratory::query()
                ->where('school_id', $schoolId)
                ->whereIn('id', $laboratoryIds)
                ->orderBy('id')
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $lockedSourceLayouts = collect();
            if ($candidateSourceId !== null) {
                $lockedSourceLayouts = Layout::query()
                    ->where('school_id', $schoolId)
                    ->where('laboratory_id', $candidateSourceId)
                    ->whereIn('status', ['active', 'draft'])
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get();
            }

            $device = Device::query()
                ->where('school_id', $schoolId)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();

            if ($device === null) {
                throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
            }
            if ((int) $device->version !== $expectedVersion) {
                throw new DeviceDomainException('Device has changed since it was loaded.', 'DEVICE_VERSION_CONFLICT', 412);
            }
            if ($device->home_laboratory_id === null) {
                throw new TransferDomainException('The Device has no source Laboratory.', 'TRANSFER_SOURCE_UNASSIGNED', 409);
            }

            $source = $lockedLaboratories->get($device->home_laboratory_id);
            $destination = $lockedLaboratories->get($destinationId) ?? $destinationCandidate;
            if ($destination === null) {
                throw new TransferDomainException('Destination Laboratory not found.', 'LABORATORY_NOT_FOUND', 404);
            }
            if ((string) $device->home_laboratory_id === (string) $destination->id) {
                throw new TransferDomainException('The destination Laboratory is already the Device home Laboratory.', 'TRANSFER_SAME_LABORATORY', 409);
            }
            if ($source === null) {
                throw new TransferDomainException('Source Laboratory not found.', 'LABORATORY_NOT_FOUND', 404);
            }
            if ($destination->status !== 'active') {
                throw new TransferDomainException('The destination Laboratory must be active.', 'TRANSFER_DESTINATION_INELIGIBLE', 409);
            }
            if (! in_array($device->lifecycle_status, DeviceCatalog::TRANSFER_ELIGIBLE_LIFECYCLE_STATUSES, true)) {
                throw new TransferDomainException('The Device lifecycle is not eligible for transfer.', 'TRANSFER_DEVICE_NOT_ELIGIBLE', 409);
            }

            $activeLayoutIds = $lockedSourceLayouts
                ->where('status', 'active')
                ->pluck('id')
                ->all();
            $draftLayoutIds = $lockedSourceLayouts
                ->where('status', 'draft')
                ->pluck('id')
                ->all();

            if ($activeLayoutIds !== [] && LayoutDevicePlacement::query()
                ->where('school_id', $schoolId)
                ->whereIn('layout_id', $activeLayoutIds)
                ->where('device_id', $device->id)
                ->exists()) {
                throw new TransferDomainException('The Device has an active Layout placement.', 'TRANSFER_ACTIVE_PLACEMENT_EXISTS', 409);
            }
            if ($draftLayoutIds !== [] && LayoutDevicePlacement::query()
                ->where('school_id', $schoolId)
                ->whereIn('layout_id', $draftLayoutIds)
                ->where('device_id', $device->id)
                ->exists()) {
                throw new TransferDomainException('The Device is referenced by the current draft Layout.', 'TRANSFER_DRAFT_REFERENCE_EXISTS', 409);
            }

            $versionBefore = (int) $device->version;
            $versionAfter = $versionBefore + 1;
            $device->home_laboratory_id = $destination->id;
            $device->version = $versionAfter;
            $device->save();

            $context->membership->loadMissing('user');
            $actor = $context->membership->user;
            $now = now();
            $transfer = DeviceTransfer::query()->create([
                'school_id' => $schoolId,
                'device_id' => $device->id,
                'device_id_snapshot' => $device->id,
                'device_code_snapshot' => $device->device_code,
                'source_laboratory_id' => $source->id,
                'source_laboratory_id_snapshot' => $source->id,
                'source_laboratory_code_snapshot' => $source->code,
                'source_laboratory_name_snapshot' => $source->name,
                'destination_laboratory_id' => $destination->id,
                'destination_laboratory_id_snapshot' => $destination->id,
                'destination_laboratory_code_snapshot' => $destination->code,
                'destination_laboratory_name_snapshot' => $destination->name,
                'actor_user_id' => $actor->id,
                'actor_user_id_snapshot' => $actor->id,
                'actor_name_snapshot' => $actor->name,
                'reason' => $data['reason'] ?? null,
                'device_version_before' => $versionBefore,
                'device_version_after' => $versionAfter,
                'created_at' => $now,
            ]);

            DeviceChangeEvent::query()->create([
                'school_id' => $schoolId,
                'device_id' => $device->id,
                'actor_user_id' => $actor->id,
                'actor_membership_id' => $context->membership->id,
                'actor_user_id_snapshot' => $actor->id,
                'actor_membership_id_snapshot' => $context->membership->id,
                'event_type' => 'device.transferred',
                'changed_fields' => ['homeLaboratoryId'],
                'changes' => [
                    'transferId' => $transfer->id,
                    'homeLaboratoryId' => ['before' => $source->id, 'after' => $destination->id],
                    'sourceLaboratory' => ['id' => $source->id, 'code' => $source->code, 'name' => $source->name],
                    'destinationLaboratory' => ['id' => $destination->id, 'code' => $destination->code, 'name' => $destination->name],
                    'deviceVersion' => ['before' => $versionBefore, 'after' => $versionAfter],
                ],
                'created_at' => $now,
            ]);

            return $transfer;
        });
    }
}
