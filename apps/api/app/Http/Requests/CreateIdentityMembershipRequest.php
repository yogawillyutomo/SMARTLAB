<?php

namespace App\Http\Requests;

use App\Domain\Identity\IdentityCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CreateIdentityMembershipRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = ['name', 'email', 'password', 'nip', 'nis', 'phone', 'roleKeys'];

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $normalized = [];

        if (is_string($this->input('name'))) {
            $normalized['name'] = trim((string) $this->input('name'));
        }
        if (is_string($this->input('email'))) {
            $normalized['email'] = mb_strtolower(trim((string) $this->input('email')));
        }

        foreach (['nip', 'nis', 'phone'] as $field) {
            if (! $this->exists($field) || ! is_string($this->input($field))) {
                continue;
            }
            $value = trim((string) $this->input($field));
            $normalized[$field] = $value === '' ? null : $value;
        }

        if (is_array($this->input('roleKeys'))) {
            $normalized['roleKeys'] = array_map(
                fn (mixed $value): mixed => is_string($value) ? mb_strtolower(trim($value)) : $value,
                $this->input('roleKeys'),
            );
        }

        if ($normalized !== []) {
            $this->merge($normalized);
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255'],
            'password' => ['required', 'string', 'min:12', 'max:72'],
            'nip' => ['sometimes', 'nullable', 'string', 'max:64'],
            'nis' => ['sometimes', 'nullable', 'string', 'max:64'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'roleKeys' => ['required', 'array', 'min:1', 'max:8'],
            'roleKeys.*' => ['required', 'string', 'distinct', Rule::in(IdentityCatalog::roleKeys())],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(fn (Validator $validator) => $this->rejectUnknownBodyFields($validator, self::FIELDS));
    }
}
