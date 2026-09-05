<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CreateLaboratoryReservationRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'laboratoryId',
        'date',
        'startsAt',
        'endsAt',
        'activity',
        'participants',
        'deviceNeeds',
        'notes',
        'picName',
    ];

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
            'activity' => ['required', 'string', 'min:1', 'max:255'],
            'participants' => ['required', 'integer', 'min:1', 'max:1000'],
            'deviceNeeds' => ['nullable', 'string', 'max:1000'],
            'notes' => ['nullable', 'string', 'max:4000'],
            'picName' => ['required', 'string', 'min:1', 'max:255'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            if ($validator->errors()->has('startsAt') || $validator->errors()->has('endsAt')) {
                return;
            }

            if ((string) $this->input('startsAt') >= (string) $this->input('endsAt')) {
                $validator->errors()->add('endsAt', 'Reservation end time must be after the start time.');
            }
        });
    }
}
