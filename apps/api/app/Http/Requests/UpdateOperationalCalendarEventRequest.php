<?php

namespace App\Http\Requests;

class UpdateOperationalCalendarEventRequest extends CreateOperationalCalendarEventRequest
{
    public function rules(): array
    {
        return [
            'scope' => ['sometimes','in:school,laboratory'],
            'laboratoryId' => ['nullable','string','max:128'],
            'category' => ['sometimes','in:effective_day,holiday,exam,school_event,maintenance,laboratory_closure,school_closure,workshop,competition,meeting,other'],
            'availabilityEffect' => ['sometimes','in:informational,blocked'],
            'title' => ['sometimes','string','min:1','max:255'],
            'description' => ['nullable','string','max:4000'],
            'startsOn' => ['sometimes','date_format:Y-m-d'],
            'endsOn' => ['sometimes','date_format:Y-m-d'],
            'allDay' => ['sometimes','boolean'],
            'startsAt' => ['nullable','date_format:H:i'],
            'endsAt' => ['nullable','date_format:H:i'],
        ];
    }
}
