<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListOperationalCalendarEventsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['from','to','scope','laboratoryId','category','availabilityEffect','status','page','perPage'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'from' => ['required','date_format:Y-m-d'],
            'to' => ['required','date_format:Y-m-d','after_or_equal:from'],
            'scope' => ['sometimes',Rule::in(['school','laboratory'])],
            'laboratoryId' => ['sometimes','string','max:128'],
            'category' => ['sometimes',Rule::in(['effective_day','holiday','exam','school_event','maintenance','laboratory_closure','school_closure','workshop','competition','meeting','other'])],
            'availabilityEffect' => ['sometimes',Rule::in(['informational','blocked'])],
            'status' => ['sometimes',Rule::in(['active','cancelled'])],
            'page' => ['sometimes','integer','min:1'],
            'perPage' => ['sometimes','integer','min:1','max:500'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownQueryFields($validator, self::FIELDS);
            if ($validator->errors()->has('from') || $validator->errors()->has('to')) return;
            $from = CarbonImmutable::createFromFormat('!Y-m-d', (string) $this->input('from'));
            $to = CarbonImmutable::createFromFormat('!Y-m-d', (string) $this->input('to'));
            if ($from && $to && $from->diffInDays($to) > 365) {
                $validator->errors()->add('to', 'Calendar range may not exceed 366 days.');
            }
        });
    }
}
