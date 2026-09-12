<?php

namespace App\Application\Telemetry;

use App\Application\Identity\CurrentMembershipContext;
use App\Domain\Device\DeviceDomainException;
use App\Models\Device;
use App\Models\DeviceAgentEnrollment;
use App\Models\DeviceAgentInstallation;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class DeviceAgentIdentityService
{
    public const ENROLLMENT_TTL_MINUTES = 10;
    public const HEARTBEAT_INTERVAL_SECONDS = 60;
    public const METRIC_INTERVAL_SECONDS = 300;
    public const MAX_OFFLINE_SECONDS = 86400;
    public const MAX_BATCH_SAMPLES = 100;

    /** @return array{enrollment:DeviceAgentEnrollment,code:string} */
    public function createEnrollment(CurrentMembershipContext $context, User $actor, string $deviceId): array
    {
        return DB::transaction(function () use ($context, $actor, $deviceId): array {
            $device = $this->lockDevice($context->membership->school_id, $deviceId, false);
            $this->assertEligible($device);

            $previous = DeviceAgentEnrollment::query()
                ->where('school_id', $device->school_id)
                ->where('device_id', $device->id)
                ->where('status', 'pending')
                ->lockForUpdate()
                ->first();

            if ($previous !== null) {
                if ($previous->expires_at->isPast()) {
                    $previous->status = 'expired';
                    $previous->save();
                } else {
                    $this->revokeEnrollment($previous, $context, $actor, 'Superseded by a newer enrollment code.');
                }
            }

            $code = bin2hex(random_bytes(16));
            $enrollment = DeviceAgentEnrollment::query()->create([
                'school_id' => $device->school_id,
                'device_id' => $device->id,
                'code_hash' => hash('sha256', $code),
                'status' => 'pending',
                'created_by_user_id' => $actor->id,
                'created_by_membership_id' => $context->membership->id,
                'created_by_user_id_snapshot' => $actor->id,
                'created_by_membership_id_snapshot' => $context->membership->id,
                'created_by_name_snapshot' => $actor->name,
                'expires_at' => now()->addMinutes(self::ENROLLMENT_TTL_MINUTES),
            ])->refresh();

            return ['enrollment' => $enrollment, 'code' => $code];
        });
    }

    /** @return Collection<int,DeviceAgentInstallation> */
    public function installations(CurrentMembershipContext $context, string $deviceId): Collection
    {
        $this->lockDevice($context->membership->school_id, $deviceId, true);

        return DeviceAgentInstallation::query()
            ->where('school_id', $context->membership->school_id)
            ->where('device_id', $deviceId)
            ->orderByDesc('enrolled_at')
            ->get();
    }

    /** @return array{installation:DeviceAgentInstallation,credential:string,device:Device} */
    public function redeem(string $code, string $agentVersion): array
    {
        $normalized = mb_strtolower(trim($code));
        if (! preg_match('/^[a-f0-9]{32}$/D', $normalized)) {
            throw $this->invalidEnrollment();
        }

        $result = DB::transaction(function () use ($normalized, $agentVersion): ?array {
            $enrollment = DeviceAgentEnrollment::query()
                ->where('code_hash', hash('sha256', $normalized))
                ->lockForUpdate()
                ->first();

            if ($enrollment === null || $enrollment->status !== 'pending') {
                return null;
            }

            if ($enrollment->expires_at->isPast()) {
                $enrollment->status = 'expired';
                $enrollment->save();

                return null;
            }

            $device = $this->lockDevice($enrollment->school_id, $enrollment->device_id, false);
            $this->assertEligible($device);

            $active = DeviceAgentInstallation::query()
                ->where('school_id', $device->school_id)
                ->where('device_id', $device->id)
                ->where('status', 'active')
                ->lockForUpdate()
                ->first();

            if ($active !== null) {
                $active->status = 'revoked';
                $active->revoked_by_user_id = $enrollment->created_by_user_id;
                $active->revoked_by_membership_id = $enrollment->created_by_membership_id;
                $active->revoked_by_user_id_snapshot = $enrollment->created_by_user_id_snapshot;
                $active->revoked_by_membership_id_snapshot = $enrollment->created_by_membership_id_snapshot;
                $active->revoked_by_name_snapshot = $enrollment->created_by_name_snapshot;
                $active->revoked_reason = 'Replaced by a newly redeemed enrollment.';
                $active->revoked_at = now();
                $active->save();
            }

            $credentialId = bin2hex(random_bytes(16));
            $secret = $this->randomBase64Url(32);
            $installation = DeviceAgentInstallation::query()->create([
                'school_id' => $device->school_id,
                'device_id' => $device->id,
                'enrollment_id' => $enrollment->id,
                'status' => 'active',
                'credential_id' => $credentialId,
                'credential_secret_hash' => hash('sha256', $secret),
                'credential_version' => 1,
                'enrolled_by_user_id' => $enrollment->created_by_user_id,
                'enrolled_by_membership_id' => $enrollment->created_by_membership_id,
                'enrolled_by_user_id_snapshot' => $enrollment->created_by_user_id_snapshot,
                'enrolled_by_membership_id_snapshot' => $enrollment->created_by_membership_id_snapshot,
                'enrolled_by_name_snapshot' => $enrollment->created_by_name_snapshot,
                'enrolled_at' => now(),
                'last_agent_version' => $agentVersion,
            ])->refresh();

            $enrollment->status = 'redeemed';
            $enrollment->redeemed_at = now();
            $enrollment->save();

            return [
                'installation' => $installation,
                'credential' => $credentialId.'.'.$secret,
                'device' => $device,
            ];
        });

        if ($result === null) {
            throw $this->invalidEnrollment();
        }

        return $result;
    }

    public function revoke(CurrentMembershipContext $context, User $actor, string $installationId, string $reason): DeviceAgentInstallation
    {
        return DB::transaction(function () use ($context, $actor, $installationId, $reason): DeviceAgentInstallation {
            $installation = DeviceAgentInstallation::query()
                ->where('school_id', $context->membership->school_id)
                ->whereKey($installationId)
                ->lockForUpdate()
                ->first();

            if ($installation === null) {
                throw new DeviceDomainException('Device agent installation not found.', 'DEVICE_AGENT_INSTALLATION_NOT_FOUND', 404);
            }

            if ($installation->status === 'revoked') {
                return $installation;
            }

            $installation->status = 'revoked';
            $installation->revoked_by_user_id = $actor->id;
            $installation->revoked_by_membership_id = $context->membership->id;
            $installation->revoked_by_user_id_snapshot = $actor->id;
            $installation->revoked_by_membership_id_snapshot = $context->membership->id;
            $installation->revoked_by_name_snapshot = $actor->name;
            $installation->revoked_reason = trim($reason);
            $installation->revoked_at = now();
            $installation->save();

            return $installation->refresh();
        });
    }

    /** @return array{heartbeatIntervalSeconds:int,metricIntervalSeconds:int,maxOfflineSeconds:int,maxBatchSamples:int,schemaVersion:string} */
    public static function policy(): array
    {
        return [
            'heartbeatIntervalSeconds' => self::HEARTBEAT_INTERVAL_SECONDS,
            'metricIntervalSeconds' => self::METRIC_INTERVAL_SECONDS,
            'maxOfflineSeconds' => self::MAX_OFFLINE_SECONDS,
            'maxBatchSamples' => self::MAX_BATCH_SAMPLES,
            'schemaVersion' => '1',
        ];
    }

    private function lockDevice(string $schoolId, string $deviceId, bool $allowAnyLifecycle): Device
    {
        $device = Device::query()
            ->where('school_id', $schoolId)
            ->whereKey($deviceId)
            ->lockForUpdate()
            ->first();

        if ($device === null) {
            throw new DeviceDomainException('Device not found.', 'DEVICE_NOT_FOUND', 404);
        }

        if (! $allowAnyLifecycle) {
            $this->assertEligible($device);
        }

        return $device;
    }

    private function assertEligible(Device $device): void
    {
        if (! in_array($device->device_type, ['desktop_pc', 'laptop', 'server'], true)
            || ! in_array($device->lifecycle_status, ['in_service', 'spare'], true)) {
            throw new DeviceDomainException(
                'Device is not eligible for PC-agent enrollment.',
                'DEVICE_AGENT_DEVICE_INELIGIBLE',
                409,
            );
        }
    }

    private function revokeEnrollment(DeviceAgentEnrollment $enrollment, CurrentMembershipContext $context, User $actor, string $reason): void
    {
        $enrollment->status = 'revoked';
        $enrollment->revoked_by_user_id = $actor->id;
        $enrollment->revoked_by_membership_id = $context->membership->id;
        $enrollment->revoked_by_user_id_snapshot = $actor->id;
        $enrollment->revoked_by_membership_id_snapshot = $context->membership->id;
        $enrollment->revoked_by_name_snapshot = $actor->name;
        $enrollment->revoked_reason = $reason;
        $enrollment->revoked_at = now();
        $enrollment->save();
    }

    private function randomBase64Url(int $bytes): string
    {
        return rtrim(strtr(base64_encode(random_bytes($bytes)), '+/', '-_'), '=');
    }

    private function invalidEnrollment(): DeviceDomainException
    {
        return new DeviceDomainException(
            'Device agent enrollment code is invalid or unavailable.',
            'DEVICE_AGENT_ENROLLMENT_INVALID',
            401,
        );
    }
}
