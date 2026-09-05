<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class PrepareLaboratorySessionRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['sourceType', 'sourceId', 'openingCondition', 'operationalNotes'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'sourceType' => ['required', Rule::in(['schedule_occurrence', 'laboratory_reservation', 'priority_event'])],
            'sourceId' => ['required', 'string', 'min:1', 'max:128'],
            'openingCondition' => ['nullable', 'string', 'max:4000'],
            'operationalNotes' => ['nullable', 'string', 'max:4000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
