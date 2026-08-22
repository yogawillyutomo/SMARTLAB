<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class SpaSessionLoginRequest extends FormRequest
{
    private const RECOGNIZED_FIELDS = ['email', 'password', 'remember'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:4096'],
            'remember' => ['sometimes', 'boolean:strict'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            foreach (array_diff(array_keys($this->all()), self::RECOGNIZED_FIELDS) as $field) {
                $validator->errors()->add((string) $field, "The {$field} field is prohibited.");
            }
        });
    }
}
