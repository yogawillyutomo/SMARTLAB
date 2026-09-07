<?php

use App\Http\Controllers\Api\V1\AcademicDirectoryMasterController;
use App\Http\Controllers\Api\V1\ActivityReportController;
use App\Http\Controllers\Api\V1\ActivityReportAttachmentController;
use App\Http\Controllers\Api\V1\AcademicPeriodMasterController;
use App\Http\Controllers\Api\V1\AssetController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\DeviceTransferController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\IdentityAdministrationController;
use App\Http\Controllers\Api\V1\IncidentController;
use App\Http\Controllers\Api\V1\InventoryController;
use App\Http\Controllers\Api\V1\LoanController;
use App\Http\Controllers\Api\V1\MaintenanceController;
use App\Http\Controllers\Api\V1\WorkOrderController;
use App\Http\Controllers\Api\V1\IncidentEventController;
use App\Http\Controllers\Api\V1\LaboratoryController;
use App\Http\Controllers\Api\V1\LayoutController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\ScheduleOccurrenceController;
use App\Http\Controllers\Api\V1\SessionIssueObservationController;
use App\Http\Controllers\Api\V1\ScheduleExceptionController;
use App\Http\Controllers\Api\V1\OperationalCalendarEventController;
use App\Http\Controllers\Api\V1\LaboratoryAvailabilityController;
use App\Http\Controllers\Api\V1\LaboratoryReservationController;
use App\Http\Controllers\Api\V1\LaboratorySessionController;
use App\Http\Controllers\Api\V1\PriorityEventController;
use App\Http\Controllers\Api\V1\SpaSessionAuthController;
use App\Http\Controllers\Api\V1\TimetablePublicationController;
use App\Http\Middleware\RequireAcademicMasterVersionPrecondition;
use App\Http\Middleware\RequireAssetVersionPrecondition;
use App\Http\Middleware\RequireActivityReportVersionPrecondition;
use App\Http\Middleware\RequireDeviceVersionPrecondition;
use App\Http\Middleware\RequireIncidentVersionPrecondition;
use App\Http\Middleware\RequireInventoryItemVersionPrecondition;
use App\Http\Middleware\RequireLoanVersionPrecondition;
use App\Http\Middleware\RequireMaintenanceExecutionVersionPrecondition;
use App\Http\Middleware\RequireMaintenancePlanVersionPrecondition;
use App\Http\Middleware\RequireWorkOrderVersionPrecondition;
use App\Http\Middleware\RequireLayoutVersionPrecondition;
use App\Http\Middleware\RequireScheduleExceptionVersionPrecondition;
use App\Http\Middleware\RequireReservationVersionPrecondition;
use App\Http\Middleware\RequirePriorityEventVersionPrecondition;
use App\Http\Middleware\RequireLaboratorySessionVersionPrecondition;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::get('health', HealthController::class);
    Route::post('auth/login', [SpaSessionAuthController::class, 'login']);
    Route::post('auth/logout', [SpaSessionAuthController::class, 'logout'])->middleware('auth:sanctum');
    Route::get('me', MeController::class)->middleware('auth:sanctum');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('identity/memberships', [IdentityAdministrationController::class, 'index'])->middleware('permission:users.view');
        Route::post('identity/memberships', [IdentityAdministrationController::class, 'store'])->middleware('permission:users.create');
        Route::get('identity/memberships/{membershipId}', [IdentityAdministrationController::class, 'show'])->middleware('permission:users.view');
        Route::patch('identity/memberships/{membershipId}', [IdentityAdministrationController::class, 'update'])->middleware('permission:users.update');
        Route::get('identity/roles', [IdentityAdministrationController::class, 'roles'])->middleware('permission:roles.view');

        Route::get('master-data/academic-units', [AcademicDirectoryMasterController::class, 'academicUnits'])->middleware('permission:master-data.view');
        Route::post('master-data/academic-units', [AcademicDirectoryMasterController::class, 'storeAcademicUnit'])->middleware('permission:master-data.create');
        Route::get('master-data/academic-units/{academicUnitId}', [AcademicDirectoryMasterController::class, 'showAcademicUnit'])->middleware('permission:master-data.view');
        Route::patch('master-data/academic-units/{academicUnitId}', [AcademicDirectoryMasterController::class, 'updateAcademicUnit'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/teachers', [AcademicDirectoryMasterController::class, 'teachers'])->middleware('permission:master-data.view');
        Route::post('master-data/teachers', [AcademicDirectoryMasterController::class, 'storeTeacher'])->middleware('permission:master-data.create');
        Route::get('master-data/teachers/{teacherId}', [AcademicDirectoryMasterController::class, 'showTeacher'])->middleware('permission:master-data.view');
        Route::patch('master-data/teachers/{teacherId}', [AcademicDirectoryMasterController::class, 'updateTeacher'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/classes', [AcademicDirectoryMasterController::class, 'academicClasses'])->middleware('permission:master-data.view');
        Route::post('master-data/classes', [AcademicDirectoryMasterController::class, 'storeAcademicClass'])->middleware('permission:master-data.create');
        Route::get('master-data/classes/{academicClassId}', [AcademicDirectoryMasterController::class, 'showAcademicClass'])->middleware('permission:master-data.view');
        Route::patch('master-data/classes/{academicClassId}', [AcademicDirectoryMasterController::class, 'updateAcademicClass'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/subjects', [AcademicDirectoryMasterController::class, 'subjects'])->middleware('permission:master-data.view');
        Route::post('master-data/subjects', [AcademicDirectoryMasterController::class, 'storeSubject'])->middleware('permission:master-data.create');
        Route::get('master-data/subjects/{subjectId}', [AcademicDirectoryMasterController::class, 'showSubject'])->middleware('permission:master-data.view');
        Route::patch('master-data/subjects/{subjectId}', [AcademicDirectoryMasterController::class, 'updateSubject'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);

        Route::get('master-data/academic-years', [AcademicPeriodMasterController::class, 'academicYears'])->middleware('permission:master-data.view');
        Route::post('master-data/academic-years', [AcademicPeriodMasterController::class, 'storeAcademicYear'])->middleware('permission:master-data.create');
        Route::get('master-data/academic-years/{academicYearId}', [AcademicPeriodMasterController::class, 'showAcademicYear'])->middleware('permission:master-data.view');
        Route::patch('master-data/academic-years/{academicYearId}', [AcademicPeriodMasterController::class, 'updateAcademicYear'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/semesters', [AcademicPeriodMasterController::class, 'semesters'])->middleware('permission:master-data.view');
        Route::post('master-data/semesters', [AcademicPeriodMasterController::class, 'storeSemester'])->middleware('permission:master-data.create');
        Route::get('master-data/semesters/{semesterId}', [AcademicPeriodMasterController::class, 'showSemester'])->middleware('permission:master-data.view');
        Route::patch('master-data/semesters/{semesterId}', [AcademicPeriodMasterController::class, 'updateSemester'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/lesson-period-sets', [AcademicPeriodMasterController::class, 'lessonPeriodSets'])->middleware('permission:master-data.view');
        Route::post('master-data/lesson-period-sets', [AcademicPeriodMasterController::class, 'storeLessonPeriodSet'])->middleware('permission:master-data.create');
        Route::get('master-data/lesson-period-sets/{lessonPeriodSetId}', [AcademicPeriodMasterController::class, 'showLessonPeriodSet'])->middleware('permission:master-data.view');
        Route::patch('master-data/lesson-period-sets/{lessonPeriodSetId}', [AcademicPeriodMasterController::class, 'updateLessonPeriodSet'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);
        Route::get('master-data/lesson-periods', [AcademicPeriodMasterController::class, 'lessonPeriods'])->middleware('permission:master-data.view');
        Route::post('master-data/lesson-periods', [AcademicPeriodMasterController::class, 'storeLessonPeriod'])->middleware('permission:master-data.create');
        Route::get('master-data/lesson-periods/{lessonPeriodId}', [AcademicPeriodMasterController::class, 'showLessonPeriod'])->middleware('permission:master-data.view');
        Route::patch('master-data/lesson-periods/{lessonPeriodId}', [AcademicPeriodMasterController::class, 'updateLessonPeriod'])->middleware(['permission:master-data.update', RequireAcademicMasterVersionPrecondition::class]);

        Route::get('laboratory-reservations', [LaboratoryReservationController::class, 'index'])->middleware('permission:bookings.view');
        Route::post('laboratory-reservations', [LaboratoryReservationController::class, 'store'])->middleware('permission:bookings.create');
        Route::get('laboratory-reservations/{reservationId}', [LaboratoryReservationController::class, 'show'])->middleware('permission:bookings.view');
        Route::post('laboratory-reservations/{reservationId}/approve', [LaboratoryReservationController::class, 'approve'])
            ->middleware(['permission:bookings.approve', RequireReservationVersionPrecondition::class]);
        Route::post('laboratory-reservations/{reservationId}/reject', [LaboratoryReservationController::class, 'reject'])
            ->middleware(['permission:bookings.approve', RequireReservationVersionPrecondition::class]);
        Route::post('laboratory-reservations/{reservationId}/cancel', [LaboratoryReservationController::class, 'cancel'])
            ->middleware(['permission:bookings.cancel', RequireReservationVersionPrecondition::class]);

        Route::get('priority-events', [PriorityEventController::class, 'index'])->middleware('permission:priority-events.view');
        Route::post('priority-events', [PriorityEventController::class, 'store'])->middleware('permission:priority-events.create');
        Route::get('priority-events/{priorityEventId}', [PriorityEventController::class, 'show'])->middleware('permission:priority-events.view');
        Route::post('priority-events/{priorityEventId}/approve', [PriorityEventController::class, 'approve'])
            ->middleware(['permission:priority-events.approve', RequirePriorityEventVersionPrecondition::class]);
        Route::post('priority-events/{priorityEventId}/reject', [PriorityEventController::class, 'reject'])
            ->middleware(['permission:priority-events.approve', RequirePriorityEventVersionPrecondition::class]);
        Route::post('priority-events/{priorityEventId}/cancel', [PriorityEventController::class, 'cancel'])
            ->middleware(['permission:priority-events.cancel', RequirePriorityEventVersionPrecondition::class]);

        Route::get('laboratory-session-sources', [LaboratorySessionController::class, 'sources'])->middleware('permission:sessions.view');
        Route::get('laboratory-sessions/{sessionId}/observations', [SessionIssueObservationController::class, 'index'])->middleware('permission:session-observations.view');
        Route::post('laboratory-sessions/{sessionId}/observations', [SessionIssueObservationController::class, 'store'])->middleware('permission:session-observations.create');
        Route::post('session-observations/{observationId}/promote-incident', [SessionIssueObservationController::class, 'promote'])
            ->middleware(['permission:session-observations.promote', 'permission:incidents.create']);
        Route::get('laboratory-sessions', [LaboratorySessionController::class, 'index'])->middleware('permission:sessions.view');
        Route::post('laboratory-sessions', [LaboratorySessionController::class, 'store'])->middleware('permission:sessions.prepare');
        Route::get('laboratory-sessions/{sessionId}', [LaboratorySessionController::class, 'show'])->middleware('permission:sessions.view');
        Route::post('laboratory-sessions/{sessionId}/start', [LaboratorySessionController::class, 'start'])
            ->middleware(['permission:sessions.start', RequireLaboratorySessionVersionPrecondition::class]);
        Route::post('laboratory-sessions/{sessionId}/end', [LaboratorySessionController::class, 'end'])
            ->middleware(['permission:sessions.end', RequireLaboratorySessionVersionPrecondition::class]);
        Route::post('laboratory-sessions/{sessionId}/cancel', [LaboratorySessionController::class, 'cancel'])
            ->middleware(['permission:sessions.cancel', RequireLaboratorySessionVersionPrecondition::class]);

        Route::get('activity-reports', [ActivityReportController::class, 'index'])->middleware('permission:activity-reports.view');
        Route::get('activity-reports/{reportId}/attachments', [ActivityReportAttachmentController::class, 'index'])->middleware('permission:activity-reports.view');
        Route::post('activity-reports/{reportId}/attachments', [ActivityReportAttachmentController::class, 'store'])
            ->middleware(['permission:activity-reports.edit', RequireActivityReportVersionPrecondition::class]);
        Route::get('activity-reports/{reportId}/attachments/{attachmentId}/download', [ActivityReportAttachmentController::class, 'download'])->middleware('permission:activity-reports.view');
        Route::post('activity-reports/backfill', [ActivityReportController::class, 'backfill'])->middleware('permission:activity-reports.create-backfill');
        Route::get('activity-reports/{reportId}', [ActivityReportController::class, 'show'])->middleware('permission:activity-reports.view');
        Route::patch('activity-reports/{reportId}', [ActivityReportController::class, 'update'])->middleware(['permission:activity-reports.edit', RequireActivityReportVersionPrecondition::class]);
        Route::post('activity-reports/{reportId}/sync-draft', [ActivityReportController::class, 'syncDraft'])->middleware('permission:activity-reports.edit');
        Route::post('activity-reports/{reportId}/submit', [ActivityReportController::class, 'submit'])->middleware(['permission:activity-reports.submit', RequireActivityReportVersionPrecondition::class]);
        Route::post('activity-reports/{reportId}/request-revision', [ActivityReportController::class, 'requestRevision'])->middleware(['permission:activity-reports.request-revision', RequireActivityReportVersionPrecondition::class]);
        Route::post('activity-reports/{reportId}/reopen', [ActivityReportController::class, 'reopen'])->middleware(['permission:activity-reports.edit', RequireActivityReportVersionPrecondition::class]);
        Route::post('activity-reports/{reportId}/verify', [ActivityReportController::class, 'verify'])->middleware(['permission:activity-reports.verify', RequireActivityReportVersionPrecondition::class]);

        Route::get('laboratory-availability', LaboratoryAvailabilityController::class)->middleware('permission:availability.view');

        Route::get('calendar-events', [OperationalCalendarEventController::class, 'index'])->middleware('permission:calendar.view');
        Route::post('calendar-events', [OperationalCalendarEventController::class, 'store'])->middleware('permission:calendar.create');
        Route::get('calendar-events/{calendarEventId}', [OperationalCalendarEventController::class, 'show'])->middleware('permission:calendar.view');
        Route::patch('calendar-events/{calendarEventId}', [OperationalCalendarEventController::class, 'update'])
            ->middleware(['permission:calendar.update', \App\Http\Middleware\RequireCalendarEventVersionPrecondition::class]);
        Route::post('calendar-events/{calendarEventId}/cancel', [OperationalCalendarEventController::class, 'cancel'])
            ->middleware(['permission:calendar.cancel', \App\Http\Middleware\RequireCalendarEventVersionPrecondition::class]);

        Route::get('schedule-exceptions', [ScheduleExceptionController::class, 'index'])->middleware('permission:schedule-exceptions.view');
        Route::post('schedule-exceptions', [ScheduleExceptionController::class, 'store'])->middleware('permission:schedule-exceptions.create');
        Route::get('schedule-exceptions/{scheduleExceptionId}', [ScheduleExceptionController::class, 'show'])->middleware('permission:schedule-exceptions.view');
        Route::post('schedule-exceptions/{scheduleExceptionId}/cancel', [ScheduleExceptionController::class, 'cancel'])
            ->middleware(['permission:schedule-exceptions.cancel', RequireScheduleExceptionVersionPrecondition::class]);

        Route::get('schedule-occurrences', [ScheduleOccurrenceController::class, 'index'])->middleware('permission:schedules.view');

        Route::get('timetable-publications', [TimetablePublicationController::class, 'index'])->middleware('permission:schedules.view');
        Route::post('timetable-publications', [TimetablePublicationController::class, 'store'])->middleware('permission:schedules.ingest');
        Route::get('timetable-publications/{publicationId}', [TimetablePublicationController::class, 'show'])->middleware('permission:schedules.view');
        Route::get('timetable-publications/{publicationId}/impact', [TimetablePublicationController::class, 'impact'])->middleware('permission:schedules.activate');
        Route::post('timetable-publications/{publicationId}/activate', [TimetablePublicationController::class, 'activate'])->middleware('permission:schedules.activate');

        Route::get('assets', [AssetController::class, 'index'])->middleware('permission:assets.view');
        Route::post('assets', [AssetController::class, 'store'])->middleware('permission:assets.create');
        Route::get('assets/{assetId}', [AssetController::class, 'show'])->middleware('permission:assets.view');
        Route::get('assets/{assetId}/operational-state', [AssetController::class, 'operationalState'])->middleware('permission:assets.view');
        Route::patch('assets/{assetId}', [AssetController::class, 'update'])->middleware(['permission:assets.update', RequireAssetVersionPrecondition::class]);
        Route::post('assets/{assetId}/device-link', [AssetController::class, 'linkDevice'])
            ->middleware(['permission:assets.link-device', 'permission:devices.view', RequireAssetVersionPrecondition::class]);
        Route::post('assets/{assetId}/device-unlink', [AssetController::class, 'unlinkDevice'])
            ->middleware(['permission:assets.link-device', RequireAssetVersionPrecondition::class]);
        Route::post('assets/{assetId}/retire', [AssetController::class, 'retire'])
            ->middleware(['permission:assets.retire', RequireAssetVersionPrecondition::class]);
        Route::post('assets/{assetId}/dispose', [AssetController::class, 'dispose'])
            ->middleware(['permission:assets.dispose', RequireAssetVersionPrecondition::class]);

        Route::get('devices', [DeviceController::class, 'index'])->middleware('permission:devices.view');
        Route::post('devices', [DeviceController::class, 'store'])->middleware('permission:devices.create');
        Route::get('devices/{deviceId}', [DeviceController::class, 'show'])->middleware('permission:devices.view');
        Route::patch('devices/{deviceId}', [DeviceController::class, 'update'])->middleware(['permission:devices.update', RequireDeviceVersionPrecondition::class]);
        Route::post('devices/{deviceId}/transfers', [DeviceTransferController::class, 'store'])->middleware(['permission:device-transfers.create', RequireDeviceVersionPrecondition::class]);
        Route::get('devices/{deviceId}/transfers', [DeviceTransferController::class, 'index'])->middleware('permission:device-transfers.view');

        Route::get('laboratories', [LaboratoryController::class, 'index'])->middleware('permission:laboratories.view');
        Route::post('laboratories', [LaboratoryController::class, 'store'])->middleware('permission:laboratories.create');
        Route::get('laboratories/{laboratoryId}', [LaboratoryController::class, 'show'])->middleware('permission:laboratories.view');
        Route::patch('laboratories/{laboratoryId}', [LaboratoryController::class, 'update'])->middleware('permission:laboratories.update');

        Route::get('laboratories/{laboratoryId}/layouts', [LayoutController::class, 'index'])->middleware('permission:layouts.view');
        Route::post('laboratories/{laboratoryId}/layouts', [LayoutController::class, 'store'])->middleware('permission:layouts.create');
        Route::get('layouts/{layoutId}', [LayoutController::class, 'show'])->middleware('permission:layouts.view');
        Route::put('layouts/{layoutId}', [LayoutController::class, 'update'])->middleware(['permission:layouts.update', RequireLayoutVersionPrecondition::class]);
        Route::post('layouts/{layoutId}/activate', [LayoutController::class, 'activate'])->middleware(['permission:layouts.update', RequireLayoutVersionPrecondition::class]);
        Route::delete('layouts/{layoutId}', [LayoutController::class, 'destroy'])->middleware(['permission:layouts.delete', RequireLayoutVersionPrecondition::class]);
        Route::get('layouts/{layoutId}/unplaced-devices', [LayoutController::class, 'unplacedDevices'])->middleware(['permission:layouts.view', 'permission:devices.view']);

        Route::get('incidents/reporting-context/laboratories', [IncidentController::class, 'reportingLaboratories'])->middleware('permission:incidents.create');
        Route::get('incidents/reporting-context/laboratories/{laboratoryId}/devices', [IncidentController::class, 'reportingDevices'])->middleware('permission:incidents.create');
        Route::get('incidents/assignee-candidates', [IncidentController::class, 'assigneeCandidates'])->middleware('permission:incidents.assign');
        Route::get('incidents/submissions/{submissionId}', [IncidentController::class, 'submission'])->middleware('permission:incidents.view');
        Route::get('loans', [LoanController::class, 'index'])->middleware('permission:loans.view');
        Route::post('loans', [LoanController::class, 'store'])->middleware('permission:loans.create');
        Route::get('loans/{loanId}', [LoanController::class, 'show'])->middleware('permission:loans.view');
        Route::post('loans/{loanId}/approve', [LoanController::class, 'approve'])
            ->middleware(['permission:loans.approve', RequireLoanVersionPrecondition::class]);
        Route::post('loans/{loanId}/reject', [LoanController::class, 'reject'])
            ->middleware(['permission:loans.approve', RequireLoanVersionPrecondition::class]);
        Route::post('loans/{loanId}/cancel', [LoanController::class, 'cancel'])
            ->middleware(['permission:loans.cancel', RequireLoanVersionPrecondition::class]);
        Route::post('loans/{loanId}/checkout', [LoanController::class, 'checkout'])
            ->middleware(['permission:loans.checkout', RequireLoanVersionPrecondition::class]);
        Route::post('loans/{loanId}/return', [LoanController::class, 'returnLoan'])
            ->middleware(['permission:loans.return', RequireLoanVersionPrecondition::class]);
        Route::post('loans/{loanId}/close', [LoanController::class, 'close'])
            ->middleware(['permission:loans.close', RequireLoanVersionPrecondition::class]);

        Route::get('maintenance-plans', [MaintenanceController::class, 'plans'])->middleware('permission:maintenance.view');
        Route::post('maintenance-plans', [MaintenanceController::class, 'storePlan'])->middleware(['permission:maintenance.create-plan', 'permission:assets.view']);
        Route::get('maintenance-plans/{planId}', [MaintenanceController::class, 'showPlan'])->middleware('permission:maintenance.view');
        Route::patch('maintenance-plans/{planId}', [MaintenanceController::class, 'updatePlan'])
            ->middleware(['permission:maintenance.update-plan', RequireMaintenancePlanVersionPrecondition::class]);
        Route::post('maintenance-plans/{planId}/activate', [MaintenanceController::class, 'activatePlan'])
            ->middleware(['permission:maintenance.update-plan', RequireMaintenancePlanVersionPrecondition::class]);
        Route::post('maintenance-plans/{planId}/deactivate', [MaintenanceController::class, 'deactivatePlan'])
            ->middleware(['permission:maintenance.update-plan', RequireMaintenancePlanVersionPrecondition::class]);
        Route::post('maintenance-plans/{planId}/executions', [MaintenanceController::class, 'schedule'])
            ->middleware(['permission:maintenance.schedule', RequireMaintenancePlanVersionPrecondition::class]);
        Route::get('maintenance-executions', [MaintenanceController::class, 'executions'])->middleware('permission:maintenance.view');
        Route::get('maintenance-executions/{executionId}', [MaintenanceController::class, 'showExecution'])->middleware('permission:maintenance.view');
        Route::post('maintenance-executions/{executionId}/start', [MaintenanceController::class, 'start'])
            ->middleware(['permission:maintenance.start', RequireMaintenanceExecutionVersionPrecondition::class]);
        Route::patch('maintenance-executions/{executionId}/checklist-progress', [MaintenanceController::class, 'updateChecklistProgress'])
            ->middleware(['permission:maintenance.complete', RequireMaintenanceExecutionVersionPrecondition::class]);
        Route::post('maintenance-executions/{executionId}/complete', [MaintenanceController::class, 'complete'])
            ->middleware(['permission:maintenance.complete', RequireMaintenanceExecutionVersionPrecondition::class]);
        Route::post('maintenance-executions/{executionId}/cancel', [MaintenanceController::class, 'cancel'])
            ->middleware(['permission:maintenance.cancel', RequireMaintenanceExecutionVersionPrecondition::class]);

        Route::get('work-orders', [WorkOrderController::class, 'index'])->middleware('permission:work-orders.view');
        Route::post('work-orders', [WorkOrderController::class, 'store'])
            ->middleware(['permission:work-orders.create', 'permission:assets.view', 'permission:laboratories.view']);
        Route::get('work-orders/{workOrderId}', [WorkOrderController::class, 'show'])->middleware('permission:work-orders.view');
        Route::patch('work-orders/{workOrderId}', [WorkOrderController::class, 'update'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::get('work-orders/{workOrderId}/history', [WorkOrderController::class, 'history'])->middleware('permission:work-orders.view');
        Route::post('work-orders/{workOrderId}/assign', [WorkOrderController::class, 'assign'])
            ->middleware(['permission:work-orders.assign', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/start', [WorkOrderController::class, 'start'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/hold', [WorkOrderController::class, 'hold'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/waiting-part', [WorkOrderController::class, 'waitingPart'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/resume', [WorkOrderController::class, 'resume'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/complete', [WorkOrderController::class, 'complete'])
            ->middleware(['permission:work-orders.update', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/rework', [WorkOrderController::class, 'rework'])
            ->middleware(['permission:work-orders.approve', RequireWorkOrderVersionPrecondition::class]);
        Route::post('work-orders/{workOrderId}/cancel', [WorkOrderController::class, 'cancel'])
            ->middleware(['permission:work-orders.view', RequireWorkOrderVersionPrecondition::class]);

        Route::get('stock-items', [InventoryController::class, 'index'])->middleware('permission:stock.view');
        Route::post('stock-items', [InventoryController::class, 'store'])->middleware('permission:stock.create');
        Route::get('stock-items/{itemId}', [InventoryController::class, 'show'])->middleware('permission:stock.view');
        Route::patch('stock-items/{itemId}', [InventoryController::class, 'update'])
            ->middleware(['permission:stock.update', RequireInventoryItemVersionPrecondition::class]);
        Route::get('stock-transactions', [InventoryController::class, 'transactions'])->middleware('permission:stock.view');
        Route::post('stock-transactions', [InventoryController::class, 'transact'])->middleware('permission:stock.transact');

        Route::get('incidents', [IncidentController::class, 'index'])->middleware('permission:incidents.view');
        Route::post('incidents', [IncidentController::class, 'store'])->middleware('permission:incidents.create');
        Route::get('incidents/{incidentId}', [IncidentController::class, 'show'])->middleware('permission:incidents.view');
        Route::patch('incidents/{incidentId}', [IncidentController::class, 'update'])->middleware(['permission:incidents.view', 'permission:incidents.update', 'permission:incidents.assign', RequireIncidentVersionPrecondition::class]);
        Route::post('incidents/{incidentId}/assignments', [IncidentController::class, 'assign'])->middleware(['permission:incidents.view', 'permission:incidents.assign', RequireIncidentVersionPrecondition::class]);
        Route::post('incidents/{incidentId}/transitions', [IncidentController::class, 'transition'])->middleware(['permission:incidents.view', RequireIncidentVersionPrecondition::class]);
        Route::get('incidents/{incidentId}/comments', [IncidentController::class, 'comments'])->middleware('permission:incidents.view');
        Route::post('incidents/{incidentId}/comments', [IncidentController::class, 'comment'])->middleware(['permission:incidents.view', 'permission:incidents.comment', RequireIncidentVersionPrecondition::class]);
        Route::get('incidents/{incidentId}/events', [IncidentEventController::class, 'index'])->middleware(['permission:incidents.view', 'permission:incidents.view-history']);
    });
});
