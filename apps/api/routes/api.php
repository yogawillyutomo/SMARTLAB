<?php

use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\LaboratoryController;
use App\Http\Controllers\Api\V1\MeController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class);
    Route::get('me', MeController::class)->middleware('auth:sanctum');

    Route::middleware('auth:sanctum')->group(function (): void {
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
