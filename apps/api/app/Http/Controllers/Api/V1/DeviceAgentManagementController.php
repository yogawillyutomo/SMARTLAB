<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Identity\CurrentMembershipContext;
use App\Application\Telemetry\DeviceAgentIdentityService;
use App\Http\Controllers\Controller;
use App\Models\DeviceAgentInstallation;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeviceAgentManagementController extends Controller
{
    public function createEnrollment(Request $request, string $deviceId, DeviceAgentIdentityService $service): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();
        $result = $service->createEnrollment($this->context($request), $actor, $deviceId);
        $enrollment = $result['enrollment'];

        return response()->json([
            'data' => [
                'id' => $enrollment->id,
                'deviceId' => $enrollment->device_id,
                'status' => $enrollment->status,
                'enrollmentCode' => $result['code'],
                'expiresAt' => $enrollment->expires_at->toISOString(),
            ],
        ], 201);
    }

    public function installations(Request $request, string $deviceId, DeviceAgentIdentityService $service): JsonResponse
    {
        return response()->json([
            'data' => $service->installations($this->context($request), $deviceId)
                ->map(fn (DeviceAgentInstallation $installation): array => $this->installationData($installation))
                ->values(),
        ]);
    }

    public function revoke(Request $request, string $installationId, DeviceAgentIdentityService $service): JsonResponse
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'min:3', 'max:1000'],
        ]);
        /** @var User $actor */
        $actor = $request->user();
        $installation = $service->revoke(
            $this->context($request),
            $actor,
            $installationId,
            (string) $validated['reason'],
        );

        return response()->json(['data' => $this->installationData($installation)]);
    }

    private function context(Request $request): CurrentMembershipContext
    {
        /** @var CurrentMembershipContext $context */
        $context = $request->attributes->get(CurrentMembershipContext::class);

        return $context;
    }

    private function installationData(DeviceAgentInstallation $installation): array
    {
        return [
            'id' => $installation->id,
            'deviceId' => $installation->device_id,
            'status' => $installation->status,
            'credentialId' => $installation->credential_id,
            'credentialVersion' => $installation->credential_version,
            'enrolledAt' => $installation->enrolled_at?->toISOString(),
            'revokedAt' => $installation->revoked_at?->toISOString(),
            'revokedReason' => $installation->revoked_reason,
            'lastAuthenticatedAt' => $installation->last_authenticated_at?->toISOString(),
            'lastAgentVersion' => $installation->last_agent_version,
        ];
    }
}
