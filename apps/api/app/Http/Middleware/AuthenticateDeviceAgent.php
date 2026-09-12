<?php

namespace App\Http\Middleware;

use App\Domain\Device\DeviceDomainException;
use App\Models\DeviceAgentInstallation;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateDeviceAgent
{
    public const ATTRIBUTE = 'deviceAgentInstallation';

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if (! is_string($token) || ! str_contains($token, '.')) {
            throw $this->unauthenticated();
        }

        [$credentialId, $secret] = explode('.', $token, 2);
        if (! preg_match('/^[a-f0-9]{32}$/D', $credentialId)
            || ! preg_match('/^[A-Za-z0-9_-]{43}$/D', $secret)) {
            throw $this->unauthenticated();
        }

        $installation = DB::transaction(function () use ($credentialId, $secret): DeviceAgentInstallation {
            $installation = DeviceAgentInstallation::query()
                ->where('credential_id', $credentialId)
                ->with('device')
                ->lockForUpdate()
                ->first();

            if ($installation === null
                || $installation->status !== 'active'
                || ! hash_equals($installation->credential_secret_hash, hash('sha256', $secret))
                || $installation->device === null
                || $installation->device->school_id !== $installation->school_id
                || ! in_array($installation->device->device_type, ['desktop_pc', 'laptop', 'server'], true)
                || ! in_array($installation->device->lifecycle_status, ['in_service', 'spare'], true)) {
                throw $this->unauthenticated();
            }

            $installation->last_authenticated_at = now();
            $installation->save();

            return $installation->refresh()->load('device');
        });

        $request->attributes->set(self::ATTRIBUTE, $installation);

        return $next($request);
    }

    private function unauthenticated(): DeviceDomainException
    {
        return new DeviceDomainException(
            'Device agent authentication failed.',
            'DEVICE_AGENT_UNAUTHENTICATED',
            401,
        );
    }
}
