<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CreateLoanRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'borrowerReference', 'borrowerName', 'borrowerUnit', 'purpose',
        'requestedReturnAt', 'assetIds',
    ];

    private const PROHIBITED = [
        'id', 'schoolId', 'school_id', 'loanNumber', 'status', 'version',
        'quantity', 'itemName', 'conditionOut', 'conditionReturn',
        'approvedAt', 'handedOverAt', 'returnedAt', 'inspectedAt',
    ];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        foreach (['borrowerReference', 'borrowerName', 'borrowerUnit', 'purpose'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $this->merge([$field => $value === '' && in_array($field, ['borrowerReference', 'borrowerUnit'], true) ? null : $value]);
            }
        }
    }

    public function rules(): array
    {
        $rules = [
            'borrowerReference' => ['sometimes', 'nullable', 'string', 'max:255'],
            'borrowerName' => ['required', 'string', 'min:2', 'max:255'],
            'borrowerUnit' => ['sometimes', 'nullable', 'string', 'max:255'],
            'purpose' => ['required', 'string', 'min:3', 'max:2000'],
            'requestedReturnAt' => ['required', 'date', 'after:now'],
            'assetIds' => ['required', 'array', 'min:1', 'max:20'],
            'assetIds.*' => ['required', 'ulid', 'distinct'],
        ];

        foreach (self::PROHIBITED as $field) {
            $rules[$field] = ['prohibited'];
        }

        return $rules;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields(
            $validator,
            [...self::FIELDS, ...self::PROHIBITED],
        ));
    }
}
