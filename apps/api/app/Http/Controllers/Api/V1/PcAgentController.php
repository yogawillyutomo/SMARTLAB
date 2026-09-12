<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Telemetry\DeviceAgentIdentityService;
use App\Domain\Device\DeviceDomainException;
use App\Http\Controllers\Controller;
use App\Http\Middleware\AuthenticateDeviceAgent;
use App\Models\DeviceAgentInstallation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PcAgentController extends Controller
{
    public function enroll(Request $request, DeviceAgentIdentityService $service): JsonResponse
    {
        $allowed = ['enrollmentCode', 'agentVersion'];
        if (array_diff(array_keys($request->all()), $allowed) !== []) {
            throw new DeviceDomainException('Unexpected field in device-agent enrollment payload.', 'DEVICE_AGENT_PAYLOAD_INVALID', 422);
        }

        $validated = $request->validate([
            'enrollmentCode' => ['required', 'string', 'size:32', 'regex:/^[A-Fa-f0-9]+$/'],
            'agentVersion' => ['required', 'string', 'min:1', 'max:64'],
        ]);
        $result = $service->redeem((string) $validated['enrollmentCode'], (string) $validated['agentVersion']);
        $installation = $result['installation'];
        $device = $result['device'];

        return response()->json([
            'data' => [
                'installationId' => $installation->id,
                'deviceId' => $device->id,
                'deviceCode' => $device->device_code,
                'credential' => $result['credential'],
                'policy' => DeviceAgentIdentityService::policy(),
            ],
        ], 201);
    }

    public function config(Request $request): JsonResponse
    {
        /** @var DeviceAgentInstallation $installation */
        $installation = $request->attributes->get(AuthenticateDeviceAgent::ATTRIBUTE);

        return response()->json([
            'data' => [
                'installationId' => $installation->id,
                'deviceId' => $installation->device_id,
                'policy' => DeviceAgentIdentityService::policy(),
            ],
        ]);
    }
}
