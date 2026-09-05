<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CheckLaboratoryAvailabilityRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['laboratoryId', 'date', 'startsAt', 'endsAt'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'laboratoryId' => ['required', 'string', 'min:1', 'max:128'],
            'date' => ['required', 'date_format:Y-m-d'],
            'startsAt' => ['required', 'date_format:H:i'],
            'endsAt' => ['required', 'date_format:H:i'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownQueryFields($validator, self::FIELDS);

            if ($validator->errors()->has('startsAt') || $validator->errors()->has('endsAt')) {
                return;
            }

            if ((string) $this->input('startsAt') >= (string) $this->input('endsAt')) {
                $validator->errors()->add('endsAt', 'The availability end time must be after the start time.');
            }
        });
    }
}
