<?php

use App\Http\Controllers\Api\V1\AssetQrLabelBatchController;
use Illuminate\Support\Facades\Route;

Route::prefix('api/v1')
    ->middleware('api')
    ->group(function (): void {
        Route::middleware('auth:sanctum')->group(function (): void {
            Route::get('asset-qr-label-candidates', [AssetQrLabelBatchController::class, 'candidates'])
                ->middleware(['permission:assets.generate-labels', 'permission:assets.view']);

            Route::get('asset-qr-label-batches', [AssetQrLabelBatchController::class, 'index'])
                ->middleware('permission:assets.generate-labels');
            Route::post('asset-qr-label-batches', [AssetQrLabelBatchController::class, 'store'])
                ->middleware(['permission:assets.generate-labels', 'permission:assets.manage-qr', 'permission:assets.view']);
            Route::get('asset-qr-label-batches/{batchId}', [AssetQrLabelBatchController::class, 'show'])
                ->middleware('permission:assets.generate-labels');
            Route::post('asset-qr-label-batches/{batchId}/reprint', [AssetQrLabelBatchController::class, 'reprint'])
                ->middleware('permission:assets.generate-labels');
        });
    });
