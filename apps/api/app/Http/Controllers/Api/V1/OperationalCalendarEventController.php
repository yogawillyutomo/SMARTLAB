<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Calendar\OperationalCalendarMutationService;
use App\Application\Calendar\OperationalCalendarQueryService;
use App\Application\Identity\CurrentMembershipContext;
use App\Http\Controllers\Controller;
use App\Http\Middleware\RequireCalendarEventVersionPrecondition;
use App\Http\Requests\CreateOperationalCalendarEventRequest;
use App\Http\Requests\ListOperationalCalendarEventsRequest;
use App\Http\Requests\UpdateOperationalCalendarEventRequest;
use App\Http\Resources\OperationalCalendarEventResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OperationalCalendarEventController extends Controller
{
    public function index(ListOperationalCalendarEventsRequest $request, OperationalCalendarQueryService $service): JsonResponse
    {
        $p=$service->events($this->context($request),$request->validated());
        return response()->json(['data'=>OperationalCalendarEventResource::collection($p->items())->resolve($request),'meta'=>[
            'page'=>$p->currentPage(),'perPage'=>$p->perPage(),'total'=>$p->total(),'lastPage'=>$p->lastPage(),
        ]]);
    }

    public function store(CreateOperationalCalendarEventRequest $request, OperationalCalendarMutationService $service): JsonResponse
    {
        return $this->response($service->create($this->context($request),$this->actor($request),$request->validated()),$request,201);
    }

    public function show(Request $request,string $calendarEventId,OperationalCalendarQueryService $service): JsonResponse
    {
        return $this->response($service->event($this->context($request),$calendarEventId),$request);
    }

    public function update(UpdateOperationalCalendarEventRequest $request,string $calendarEventId,OperationalCalendarMutationService $service): JsonResponse
    {
        return $this->response($service->update($this->context($request),$this->actor($request),$calendarEventId,(int)$request->attributes->get(RequireCalendarEventVersionPrecondition::ATTRIBUTE),$request->validated()),$request);
    }

    public function cancel(Request $request,string $calendarEventId,OperationalCalendarMutationService $service): JsonResponse
    {
        return $this->response($service->cancel($this->context($request),$this->actor($request),$calendarEventId,(int)$request->attributes->get(RequireCalendarEventVersionPrecondition::ATTRIBUTE)),$request);
    }

    private function response($event,Request $request,int $status=200): JsonResponse
    {
        return (new OperationalCalendarEventResource($event))->response($request)->setStatusCode($status)->header('ETag','"'.$event->version.'"');
    }

    private function context(Request $request): CurrentMembershipContext { return $request->attributes->get(CurrentMembershipContext::class); }
    private function actor(Request $request): User { return $request->user(); }
}
