<?php

namespace App\Application\DeviceTransfer;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceDomainException;
use App\Models\Device;
use App\Models\DeviceTransfer;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;

class DeviceTransferQueryService
{
    /** @param array{page?: int, perPage?: int} $filters */
    public function history(
        CurrentMembershipContext $context,
        string $deviceId,
        array $filters,
    ): LengthAwarePaginator {
        $schoolId = $context->membership->school_id;
        if (! Device::query()->where('school_id', $schoolId)->whereKey($deviceId)->exists()) {
            throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
        }

        return DeviceTransfer::query()
            ->where('school_id', $schoolId)
            ->where('device_id_snapshot', $deviceId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($filters['perPage'] ?? 25, ['*'], 'page', $filters['page'] ?? 1);
    }
}
