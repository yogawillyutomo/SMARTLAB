<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class EndLaboratorySessionRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['endOutcome', 'closingCondition', 'operationalNotes'];

    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'endOutcome' => ['required', Rule::in(['completed', 'interrupted'])],
            'closingCondition' => ['nullable', 'string', 'max:4000'],
            'operationalNotes' => ['sometimes', 'nullable', 'string', 'max:4000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
