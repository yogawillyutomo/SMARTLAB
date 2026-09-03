<?php

use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\DeviceTransferController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\IdentityAdministrationController;
use App\Http\Controllers\Api\V1\IncidentController;
use App\Http\Controllers\Api\V1\IncidentEventController;
use App\Http\Controllers\Api\V1\LaboratoryController;
use App\Http\Controllers\Api\V1\LayoutController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\SpaSessionAuthController;
use App\Http\Middleware\RequireDeviceVersionPrecondition;
use App\Http\Middleware\RequireIncidentVersionPrecondition;
use App\Http\Middleware\RequireLayoutVersionPrecondition;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class);
    Route::post('auth/login', [SpaSessionAuthController::class, 'login']);
    Route::post('auth/logout', [SpaSessionAuthController::class, 'logout'])
        ->middleware('auth:sanctum');
    Route::get('me', MeController::class)->middleware('auth:sanctum');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('identity/memberships', [IdentityAdministrationController::class, 'index'])
            ->middleware('permission:users.view');
        Route::post('identity/memberships', [IdentityAdministrationController::class, 'store'])
            ->middleware('permission:users.create');
        Route::get('identity/memberships/{membershipId}', [IdentityAdministrationController::class, 'show'])
            ->middleware('permission:users.view');
        Route::patch('identity/memberships/{membershipId}', [IdentityAdministrationController::class, 'update'])
            ->middleware('permission:users.update');
        Route::get('identity/roles', [IdentityAdministrationController::class, 'roles'])
            ->middleware('permission:roles.view');

        Route::get('devices', [DeviceController::class, 'index'])
            ->middleware('permission:devices.view');
        Route::post('devices', [DeviceController::class, 'store'])
            ->middleware('permission:devices.create');
        Route::get('devices/{deviceId}', [DeviceController::class, 'show'])
            ->middleware('permission:devices.view');
        Route::patch('devices/{deviceId}', [DeviceController::class, 'update'])
            ->middleware(['permission:devices.update', RequireDeviceVersionPrecondition::class]);
        Route::post('devices/{deviceId}/transfers', [DeviceTransferController::class, 'store'])
            ->middleware(['permission:device-transfers.create', RequireDeviceVersionPrecondition::class]);
        Route::get('devices/{deviceId}/transfers', [DeviceTransferController::class, 'index'])
            ->middleware('permission:device-transfers.view');

        Route::get('laboratories', [LaboratoryController::class, 'index'])
            ->middleware('permission:laboratories.view');
        Route::post('laboratories', [LaboratoryController::class, 'store'])
            ->middleware('permission:laboratories.create');
        Route::get('laboratories/{laboratoryId}', [LaboratoryController::class, 'show'])
            ->middleware('permission:laboratories.view');
        Route::patch('laboratories/{laboratoryId}', [LaboratoryController::class, 'update'])
            ->middleware('permission:laboratories.update');

        Route::get('laboratories/{laboratoryId}/layouts', [LayoutController::class, 'index'])
            ->middleware('permission:layouts.view');
        Route::post('laboratories/{laboratoryId}/layouts', [LayoutController::class, 'store'])
            ->middleware('permission:layouts.create');
        Route::get('layouts/{layoutId}', [LayoutController::class, 'show'])
            ->middleware('permission:layouts.view');
        Route::put('layouts/{layoutId}', [LayoutController::class, 'update'])
            ->middleware(['permission:layouts.update', RequireLayoutVersionPrecondition::class]);
        Route::post('layouts/{layoutId}/activate', [LayoutController::class, 'activate'])
            ->middleware(['permission:layouts.update', RequireLayoutVersionPrecondition::class]);
        Route::delete('layouts/{layoutId}', [LayoutController::class, 'destroy'])
            ->middleware(['permission:layouts.delete', RequireLayoutVersionPrecondition::class]);
        Route::get('layouts/{layoutId}/unplaced-devices', [LayoutController::class, 'unplacedDevices'])
            ->middleware(['permission:layouts.view', 'permission:devices.view']);

        Route::get('incidents/reporting-context/laboratories', [IncidentController::class, 'reportingLaboratories'])
            ->middleware('permission:incidents.create');
        Route::get('incidents/reporting-context/laboratories/{laboratoryId}/devices', [IncidentController::class, 'reportingDevices'])
            ->middleware('permission:incidents.create');
        Route::get('incidents/assignee-candidates', [IncidentController::class, 'assigneeCandidates'])
            ->middleware('permission:incidents.assign');
        Route::get('incidents/submissions/{submissionId}', [IncidentController::class, 'submission'])
            ->middleware('permission:incidents.view');
        Route::get('incidents', [IncidentController::class, 'index'])
            ->middleware('permission:incidents.view');
        Route::post('incidents', [IncidentController::class, 'store'])
            ->middleware('permission:incidents.create');
        Route::get('incidents/{incidentId}', [IncidentController::class, 'show'])
            ->middleware('permission:incidents.view');
        Route::patch('incidents/{incidentId}', [IncidentController::class, 'update'])
            ->middleware([
                'permission:incidents.view',
                'permission:incidents.update',
                'permission:incidents.assign',
                RequireIncidentVersionPrecondition::class,
            ]);
        Route::post('incidents/{incidentId}/assignments', [IncidentController::class, 'assign'])
            ->middleware([
                'permission:incidents.view',
                'permission:incidents.assign',
                RequireIncidentVersionPrecondition::class,
            ]);
        Route::post('incidents/{incidentId}/transitions', [IncidentController::class, 'transition'])
            ->middleware([
                'permission:incidents.view',
                RequireIncidentVersionPrecondition::class,
            ]);
        Route::get('incidents/{incidentId}/comments', [IncidentController::class, 'comments'])
            ->middleware('permission:incidents.view');
        Route::post('incidents/{incidentId}/comments', [IncidentController::class, 'comment'])
            ->middleware([
                'permission:incidents.view',
                'permission:incidents.comment',
                RequireIncidentVersionPrecondition::class,
            ]);
        Route::get('incidents/{incidentId}/events', [IncidentEventController::class, 'index'])
            ->middleware([
                'permission:incidents.view',
                'permission:incidents.view-history',
            ]);
    });
});
