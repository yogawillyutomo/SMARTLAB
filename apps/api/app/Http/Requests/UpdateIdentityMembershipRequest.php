<?php

namespace App\Http\Requests;

use App\Domain\Identity\IdentityCatalog;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateIdentityMembershipRequest extends FormRequest
{
    use RejectsUnknownFields;

    private const FIELDS = [
        'name',
        'email',
        'nip',
        'nis',
        'phone',
        'userStatus',
        'membershipStatus',
        'roleKeys',
    ];

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

        foreach (['userStatus', 'membershipStatus'] as $field) {
            if (is_string($this->input($field))) {
                $normalized[$field] = mb_strtolower(trim((string) $this->input($field)));
            }
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
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'email' => ['sometimes', 'string', 'email:rfc', 'max:255'],
            'nip' => ['sometimes', 'nullable', 'string', 'max:64'],
            'nis' => ['sometimes', 'nullable', 'string', 'max:64'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'userStatus' => ['sometimes', 'string', Rule::in(IdentityCatalog::STATUSES)],
            'membershipStatus' => ['sometimes', 'string', Rule::in(IdentityCatalog::STATUSES)],
            'roleKeys' => ['sometimes', 'array', 'min:1', 'max:8'],
            'roleKeys.*' => ['required', 'string', 'distinct', Rule::in(IdentityCatalog::roleKeys())],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $this->rejectUnknownBodyFields($validator, self::FIELDS);

            if (array_intersect(array_keys($this->all()), self::FIELDS) === []) {
                $validator->errors()->add('request', 'At least one identity field is required.');
            }
        });
    }
}
