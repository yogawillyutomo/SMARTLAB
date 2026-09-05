<?php

namespace App\Http\Requests;

use Illuminate\Validation\Validator;

class UpdateOperationalCalendarEventRequest extends CreateOperationalCalendarEventRequest
{
    private const UPDATE_FIELDS = ['scope','laboratoryId','category','availabilityEffect','title','description','startsOn','endsOn','allDay','startsAt','endsAt'];

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

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::UPDATE_FIELDS);
            if (array_intersect(array_keys($this->all()), self::UPDATE_FIELDS) === []) {
                $validator->errors()->add('request', 'At least one Calendar Event field is required.');
            }
        });
    }
}
