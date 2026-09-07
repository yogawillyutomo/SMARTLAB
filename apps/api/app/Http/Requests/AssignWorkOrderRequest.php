<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class AssignWorkOrderRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool { return true; }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('reason'))) {
            $value = trim((string) $this->input('reason'));
            $this->merge(['reason' => $value === '' ? null : $value]);
        }
    }

    public function rules(): array
    {
        return [
            'assigneeMembershipId' => ['required', 'ulid'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['assigneeMembershipId', 'reason']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }
}
