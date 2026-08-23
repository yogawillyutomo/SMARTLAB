<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class CreateLayoutRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['name', 'templateKey', 'rows', 'columns'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];
        foreach (['name', 'templateKey'] as $field) {
            if ($this->exists($field) && is_string($this->input($field))) {
                $value = trim((string) $this->input($field));
                $normalized[$field] = $field === 'templateKey' && $value === '' ? null : $value;
            }
        }
        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'templateKey' => ['sometimes', 'nullable', 'string', 'max:100'],
            'rows' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'columns' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
