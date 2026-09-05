<?php

use App\Http\Controllers\Api\V1\AcademicDirectoryMasterController;
use App\Http\Controllers\Api\V1\ActivityReportController;
use App\Http\Controllers\Api\V1\AcademicPeriodMasterController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\DeviceTransferController;
use App\Http\Controllers\Api\V1\HealthController;
use App\Http\Controllers\Api\V1\IdentityAdministrationController;
use App\Http\Controllers\Api\V1\IncidentController;
use App\Http\Controllers\Api\V1\IncidentEventController;
use App\Http\Controllers\Api\V1\LaboratoryController;
use App\Http\Controllers\Api\V1\LayoutController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\ScheduleOccurrenceController;
use App\Http\Controllers\Api\V1\ScheduleExceptionController;
use App\Http\Controllers\Api\V1\OperationalCalendarEventController;
use App\Http\Controllers\Api\V1\LaboratoryAvailabilityController;
use App\Http\Controllers\Api\V1\LaboratoryReservationController;
use App\Http\Controllers\Api\V1\LaboratorySessionController;
use App\Http\Controllers\Api\V1\PriorityEventController;
use App\Http\Controllers\Api\V1\SpaSessionAuthController;
use App\Http\Controllers\Api\V1\TimetablePublicationController;
use App\Http\Middleware\RequireAcademicMasterVersionPrecondition;
use App\Http\Middleware\RequireActivityReportVersionPrecondition;
use App\Http\Middleware\RequireDeviceVersionPrecondition;
use App\Http\Middleware\RequireIncidentVersionPrecondition;
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
        Route::post('activity-reports/backfill', [ActivityReportController::class, 'backfill'])->middleware('permission:activity-reports.create-backfill');
        Route::get('activity-reports/{reportId}', [ActivityReportController::class, 'show'])->middleware('permission:activity-reports.view');
        Route::patch('activity-reports/{reportId}', [ActivityReportController::class, 'update'])->middleware(['permission:activity-reports.edit', RequireActivityReportVersionPrecondition::class]);
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
