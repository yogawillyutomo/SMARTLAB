<?php

use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\LaboratoryController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\SpaSessionAuthController;
use App\Http\Middleware\RequireDeviceVersionPrecondition;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class);
    Route::post('auth/login', [SpaSessionAuthController::class, 'login']);
    Route::post('auth/logout', [SpaSessionAuthController::class, 'logout'])
        ->middleware('auth:sanctum');
    Route::get('me', MeController::class)->middleware('auth:sanctum');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('devices', [DeviceController::class, 'index'])
            ->middleware('permission:devices.view');
        Route::post('devices', [DeviceController::class, 'store'])
            ->middleware('permission:devices.create');
        Route::get('devices/{deviceId}', [DeviceController::class, 'show'])
            ->middleware('permission:devices.view');
        Route::patch('devices/{deviceId}', [DeviceController::class, 'update'])
            ->middleware(['permission:devices.update', RequireDeviceVersionPrecondition::class]);

        Route::get('laboratories', [LaboratoryController::class, 'index'])
            ->middleware('permission:laboratories.view');
        Route::post('laboratories', [LaboratoryController::class, 'store'])
            ->middleware('permission:laboratories.create');
        Route::get('laboratories/{laboratoryId}', [LaboratoryController::class, 'show'])
            ->middleware('permission:laboratories.view');
        Route::patch('laboratories/{laboratoryId}', [LaboratoryController::class, 'update'])
            ->middleware('permission:laboratories.update');
    });
});
