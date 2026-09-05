<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateScheduleExceptionRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['occurrenceId', 'resolution', 'replacementLaboratoryId', 'reason'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'occurrenceId' => ['required', 'string', 'min:1', 'max:128'],
            'resolution' => ['required', Rule::in(['cancel', 'relocate'])],
            'replacementLaboratoryId' => ['nullable', 'string', 'min:1', 'max:128'],
            'reason' => ['required', 'string', 'min:1', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            if ($validator->errors()->has('resolution')) {
                return;
            }

            $resolution = (string) $this->input('resolution');
            $replacement = $this->input('replacementLaboratoryId');

            if ($resolution === 'relocate' && (! is_string($replacement) || trim($replacement) === '')) {
                $validator->errors()->add('replacementLaboratoryId', 'Replacement Laboratory is required for relocation.');
            }

            if ($resolution === 'cancel' && $replacement !== null) {
                $validator->errors()->add('replacementLaboratoryId', 'Replacement Laboratory must be omitted for cancellation.');
            }
        });
    }
}
