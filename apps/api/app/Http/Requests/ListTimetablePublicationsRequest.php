<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ListTimetablePublicationsRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['semesterId', 'status', 'sourcePublicationId', 'page', 'perPage'];

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'semesterId' => ['sometimes', 'string', 'max:128'],
            'status' => ['sometimes', 'string', Rule::in(['staged', 'validated', 'active', 'superseded', 'rejected'])],
            'sourcePublicationId' => ['sometimes', 'string', 'min:1', 'max:128'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'perPage' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownQueryFields($validator, self::FIELDS));
    }
}
