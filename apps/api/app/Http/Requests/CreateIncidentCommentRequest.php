<?php

namespace App\Http\Requests;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use Normalizer;

class CreateIncidentCommentRequest extends FormRequest
{
    use RejectsUnknownFields;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (! is_string($this->input('text'))) {
            return;
        }

        $value = trim((string) $this->input('text'));
        $normalized = Normalizer::normalize($value, Normalizer::FORM_C);
        $this->merge(['text' => $normalized === false ? $value : $normalized]);
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'text' => ['required', 'string', 'min:1', 'max:2000'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, ['text']);
            $this->rejectUnknownQueryFields($validator, []);
        });
    }

    /** @return array{text: string} */
    public function businessPayload(): array
    {
        return ['text' => (string) $this->validated('text')];
    }
}
