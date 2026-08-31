<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ListIncidentAssigneeCandidatesRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['search', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->query('search'))) {
            $this->merge(['search' => trim((string) $this->query('search'))]);
        }
    }

    public function rules(): array
    {
        return [
            'search' => ['sometimes', 'string', 'min:2', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
