<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ListIncidentReportingDevicesRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['search'];

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
        return ['search' => ['required', 'string', 'min:2', 'max:100']];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
