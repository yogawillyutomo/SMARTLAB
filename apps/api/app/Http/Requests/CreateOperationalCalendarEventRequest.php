<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateOperationalCalendarEventRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['scope','laboratoryId','category','availabilityEffect','title','description','startsOn','endsOn','allDay','startsAt','endsAt'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'scope' => ['required', Rule::in(['school','laboratory'])],
            'laboratoryId' => ['nullable','string','max:128'],
            'category' => ['required', Rule::in(['effective_day','holiday','exam','school_event','maintenance','laboratory_closure','school_closure','workshop','competition','meeting','other'])],
            'availabilityEffect' => ['required', Rule::in(['informational','blocked'])],
            'title' => ['required','string','min:1','max:255'],
            'description' => ['nullable','string','max:4000'],
            'startsOn' => ['required','date_format:Y-m-d'],
            'endsOn' => ['required','date_format:Y-m-d','after_or_equal:startsOn'],
            'allDay' => ['required','boolean'],
            'startsAt' => ['nullable','date_format:H:i'],
            'endsAt' => ['nullable','date_format:H:i'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);
            $scope = $this->input('scope');
            $lab = $this->input('laboratoryId');
            if ($scope === 'laboratory' && (! is_string($lab) || trim($lab) === '')) {
                $validator->errors()->add('laboratoryId', 'Laboratory is required for laboratory scope.');
            }
            if ($scope === 'school' && $lab !== null && $lab !== '') {
                $validator->errors()->add('laboratoryId', 'Laboratory must be empty for school scope.');
            }
            $allDay = $this->boolean('allDay');
            if ($allDay) {
                foreach (['startsAt','endsAt'] as $field) {
                    if ($this->input($field) !== null && $this->input($field) !== '') {
                        $validator->errors()->add($field, 'Time fields must be empty for all-day events.');
                    }
                }
            } else {
                if ($this->input('startsOn') !== $this->input('endsOn')) {
                    $validator->errors()->add('endsOn', 'Partial-day events must start and end on the same date.');
                }
                foreach (['startsAt','endsAt'] as $field) {
                    if (! is_string($this->input($field)) || $this->input($field) === '') {
                        $validator->errors()->add($field, 'Time is required for partial-day events.');
                    }
                }
                if (is_string($this->input('startsAt')) && is_string($this->input('endsAt')) && $this->input('startsAt') >= $this->input('endsAt')) {
                    $validator->errors()->add('endsAt', 'End time must be after start time.');
                }
            }
        });
    }
}
