<?php

use App\Http\Controllers\Api\V1\DeviceAgentManagementController;
use App\Http\Controllers\Api\V1\PcAgentController;
use App\Http\Middleware\AuthenticateDeviceAgent;
use Illuminate\Support\Facades\Route;

Route::prefix('api/v1')
    ->middleware('api')
    ->group(function (): void {
        Route::post('pc-agent/v1/enroll', [PcAgentController::class, 'enroll'])
            ->middleware('throttle:10,1');
        Route::get('pc-agent/v1/config', [PcAgentController::class, 'config'])
            ->middleware([AuthenticateDeviceAgent::class, 'throttle:120,1']);

        Route::middleware('auth:sanctum')->group(function (): void {
            Route::post('devices/{deviceId}/agent-enrollments', [DeviceAgentManagementController::class, 'createEnrollment'])
                ->middleware('permission:devices.manage-agent');
            Route::get('devices/{deviceId}/agent-installations', [DeviceAgentManagementController::class, 'installations'])
                ->middleware('permission:devices.manage-agent');
            Route::post('device-agent-installations/{installationId}/revoke', [DeviceAgentManagementController::class, 'revoke'])
                ->middleware('permission:devices.manage-agent');
        });
    });
